import { hydratorRegistry, resetRegistries } from "../../src/adapters/desk/client-src/boot";
import { hydratePresencePanels, registerPresencePanels } from "../../src/adapters/desk/client-src/presence";
import type { UnknownRecord } from "../../src/adapters/desk/client-src/seams";

/* ------------------------------ DOM fixtures ------------------------------- */

/** Mirrors PRESENCE_PANEL_BODY + the panel attributes rendered by views/inbox.tsx (constant markup). */
const PANEL_BODY = `
    <div class="presence-head">
      <h2 id="document-presence">Presence</h2>
      <p data-cf-frappe-presence-count>Checking active collaborators.</p>
    </div>
    <p class="presence-list" data-cf-frappe-presence-list>Checking active collaborators.</p>
    <p class="presence-list" data-cf-frappe-field-edits>No live field edits.</p>
    <p class="presence-list" data-cf-frappe-shared-draft>No shared draft proposals.</p>
    <p class="presence-list" data-cf-frappe-document-update>Viewing latest saved version.</p>
    <button type="button" data-cf-frappe-merge-save hidden>Merge saved changes</button>
    <button type="button" data-cf-frappe-apply-shared-draft hidden>Apply shared draft</button>
  `;

interface PanelAttributes {
  doctype?: string;
  documentName?: string;
  documentVersion?: string;
  tenantId?: string;
  realtimeRoute?: string;
}

function installPanel(attributes: PanelAttributes = {}): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "panel presence";
  panel.setAttribute("data-cf-frappe-presence", "document");
  if (attributes.doctype !== undefined) panel.setAttribute("data-doctype", attributes.doctype);
  if (attributes.documentName !== undefined) panel.setAttribute("data-document-name", attributes.documentName);
  if (attributes.documentVersion !== undefined)
    panel.setAttribute("data-document-version", attributes.documentVersion);
  if (attributes.tenantId !== undefined) panel.setAttribute("data-tenant-id", attributes.tenantId);
  if (attributes.realtimeRoute !== undefined) panel.setAttribute("data-realtime-route", attributes.realtimeRoute);
  panel.innerHTML = PANEL_BODY;
  document.body.appendChild(panel);
  return panel;
}

function panelText(panel: HTMLElement, selector: string): string | null {
  return panel.querySelector(selector)?.textContent ?? null;
}

function mergeButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelector("[data-cf-frappe-merge-save]") as HTMLButtonElement;
}

function applyButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelector("[data-cf-frappe-apply-shared-draft]") as HTMLButtonElement;
}

interface FieldSpec {
  name: string;
  value: string;
  type?: string;
  fieldType?: string;
  required?: boolean;
}

function installForm(fields: readonly FieldSpec[]): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "form";
  fields.forEach((spec) => {
    const input = document.createElement("input");
    input.type = spec.type ?? "text";
    input.name = spec.name;
    if (spec.type === "checkbox") {
      input.checked = spec.value === "on";
    } else {
      input.value = spec.value;
    }
    if (spec.fieldType !== undefined) {
      input.setAttribute("data-cf-frappe-field-type", spec.fieldType);
    }
    if (spec.required) {
      input.required = true;
    }
    form.appendChild(input);
  });
  document.body.appendChild(form);
  return form;
}

function fieldNamed(form: HTMLFormElement, name: string): HTMLInputElement {
  return form.querySelector(`[name="${name}"]`) as HTMLInputElement;
}

/* ------------------------------- form seam --------------------------------- */

interface FakeFrm {
  doc: unknown;
  doctype?: string;
  docname?: string;
  dirty: ReturnType<typeof vi.fn>;
  trigger: ReturnType<typeof vi.fn>;
  mergePlan: ReturnType<typeof vi.fn>;
  merge_save: ReturnType<typeof vi.fn>;
  remote_merge_plan?: unknown;
}

function makeFrm(overrides: Partial<FakeFrm> = {}): FakeFrm {
  return {
    doc: {},
    doctype: "Task",
    docname: "TASK-1",
    dirty: vi.fn(),
    trigger: vi.fn(),
    mergePlan: vi.fn(() => ({ status: "clean" })),
    merge_save: vi.fn(() => Promise.resolve({ status: "applied", document: { version: 5 } })),
    ...overrides
  };
}

function installFormNamespace(frm: unknown): void {
  (window as { cfFrappe?: unknown }).cfFrappe = { form: { current: () => frm } };
}

/* ---------------------------- realtime doubles ----------------------------- */

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static failNext = false;
  readonly url: string;
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string | URL) {
    if (FakeWebSocket.failNext) {
      FakeWebSocket.failNext = false;
      throw new Error("socket unavailable");
    }
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(): void {}
  close(): void {}

  emitMessage(payload: unknown): void {
    (this.listeners.message ?? []).forEach((listener) => listener({ data: JSON.stringify(payload) }));
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function stubPresenceFetch(connections: readonly unknown[] = []): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ data: { topic: "t", connections } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function installRuntimeScript(attributes: Record<string, string>): void {
  const script = document.createElement("script");
  script.setAttribute("data-cf-frappe-runtime", "desk");
  Object.entries(attributes).forEach(([name, value]) => {
    script.setAttribute(name, value);
  });
  document.body.appendChild(script);
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const PANEL_DEFAULTS: PanelAttributes = {
  doctype: "Task",
  documentName: "TASK-1",
  documentVersion: "3",
  tenantId: "acme",
  realtimeRoute: "/rt"
};

async function hydrateDefaultPanel(attributes: PanelAttributes = PANEL_DEFAULTS): Promise<HTMLElement> {
  const panel = installPanel(attributes);
  hydratePresencePanels();
  await flushPromises();
  return panel;
}

function documentEvent(version: number, data?: UnknownRecord): UnknownRecord {
  return {
    type: "cf-frappe.realtime.event",
    cursor: 9,
    event: {
      id: `event-${version}`,
      type: "TaskUpdated",
      payload: { snapshot: Object.assign({ version }, data === undefined ? {} : { data }) }
    }
  };
}

function sharedDraftFrame(payload: UnknownRecord): UnknownRecord {
  return {
    type: "cf-frappe.realtime.collaboration",
    event: { id: "c1", payload: Object.assign({ kind: "DocumentSharedDraftPatch" }, payload) }
  };
}

function fieldEditFrame(payload: UnknownRecord): UnknownRecord {
  return {
    type: "cf-frappe.realtime.collaboration",
    event: { id: "c2", payload: Object.assign({ kind: "DocumentFieldEditIntent" }, payload) }
  };
}

describe("client-src presence panels", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNext = false;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    stubPresenceFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as { cfFrappe?: unknown }).cfFrappe;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("hydration", () => {
    it("does nothing without presence panels", () => {
      expect(() => hydratePresencePanels()).not.toThrow();
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it("skips panels missing doctype/document/tenant context", async () => {
      const fetchMock = stubPresenceFetch();
      const panel = await hydrateDefaultPanel({ doctype: "Task", documentName: "TASK-1" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(panel.dataset.presenceState).toBeUndefined();
    });

    it("hydrates from permissioned snapshots and subscribes to the document topic", async () => {
      const fetchMock = stubPresenceFetch([
        { userId: "owner@example.com", connectionId: "c1" },
        { connectionId: "c2" },
        { userId: "owner@example.com", connectionId: "c3" },
        { userId: "" }
      ]);
      const panel = await hydrateDefaultPanel();
      expect(fetchMock).toHaveBeenCalledWith(
        "/rt/presence?topic=document%3Aacme%3ATask%3ATASK-1",
        expect.anything()
      );
      expect(panel.dataset.presenceState).toBe("ready");
      expect(panelText(panel, "[data-cf-frappe-presence-count]")).toBe("2 active collaborators");
      expect(panelText(panel, "[data-cf-frappe-presence-list]")).toBe("owner@example.com, c2");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Viewing latest saved version.");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe("No shared draft proposals.");
      expect(mergeButton(panel).hidden).toBe(true);
      expect(applyButton(panel).hidden).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0]?.url).toBe("ws://localhost:3000/rt?topic=document%3Aacme%3ATask%3ATASK-1");
    });

    it("falls back to the page context for panel identity", async () => {
      installRuntimeScript({
        "data-doctype": "Task",
        "data-document-name": "TASK-1",
        "data-tenant-id": "acme"
      });
      const fetchMock = stubPresenceFetch();
      const panel = await hydrateDefaultPanel({});
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/realtime/presence?topic=document%3Aacme%3ATask%3ATASK-1",
        expect.anything()
      );
      expect(panel.dataset.presenceState).toBe("ready");
    });

    it("renders a single collaborator and live presence updates", async () => {
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage({
        type: "cf-frappe.realtime.presence",
        presence: { connections: [{ userId: "owner@example.com", connectionId: "c1" }] }
      });
      expect(panel.dataset.presenceState).toBe("live");
      expect(panelText(panel, "[data-cf-frappe-presence-count]")).toBe("1 active collaborator");
      expect(panelText(panel, "[data-cf-frappe-presence-list]")).toBe("owner@example.com");
      FakeWebSocket.instances[0]?.emitMessage({ type: "cf-frappe.realtime.presence", presence: { connections: [] } });
      expect(panelText(panel, "[data-cf-frappe-presence-list]")).toBe(
        "No active collaborators are viewing this document."
      );
    });

    it("treats snapshots without a connections list as empty", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse({ data: {} })));
      const panel = await hydrateDefaultPanel();
      expect(panel.dataset.presenceState).toBe("ready");
      expect(panelText(panel, "[data-cf-frappe-presence-count]")).toBe("0 active collaborators");
      expect(panelText(panel, "[data-cf-frappe-presence-list]")).toBe(
        "No active collaborators are viewing this document."
      );
    });

    it("marks the panel errored when the snapshot fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "denied" } }, 403)));
      const panel = await hydrateDefaultPanel();
      expect(panel.dataset.presenceState).toBe("error");
      expect(panelText(panel, "[data-cf-frappe-presence-count]")).toBe("Presence unavailable");
      expect(panelText(panel, "[data-cf-frappe-presence-list]")).toBe("denied");
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it("uses the default error text when the failure has no message", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue({}));
      const panel = await hydrateDefaultPanel();
      expect(panelText(panel, "[data-cf-frappe-presence-list]")).toBe("Unable to load document presence.");
    });

    it("does not resubscribe or reattach on repeated hydration", async () => {
      const panel = await hydrateDefaultPanel();
      hydratePresencePanels();
      await flushPromises();
      expect(FakeWebSocket.instances).toHaveLength(1);
      installFormNamespace(makeFrm());
      installForm([{ name: "title", value: "Queued" }]);
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentState).toBe("merged");
    });

    it("keeps the panel hydrated when the socket cannot be opened", async () => {
      FakeWebSocket.failNext = true;
      const panel = await hydrateDefaultPanel();
      expect(panel.dataset.presenceState).toBe("ready");
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it("registers the presence hydrator at import time and after resets", () => {
      expect(hydratorRegistry.list().some((registration) => registration.name === "presence-panels")).toBe(true);
      resetRegistries();
      registerPresencePanels();
      expect(hydratorRegistry.list().map((registration) => registration.name)).toEqual(["presence-panels"]);
    });
  });

  describe("remote document events", () => {
    it("marks the panel stale and flags the matching form when the version advances", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4, { title: "Remote" }));
      expect(panel.dataset.documentState).toBe("stale");
      expect(panel.dataset.remoteVersion).toBe("4");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe(
        "Document updated to v4. Refresh to review latest changes."
      );
      expect(form.dataset.remoteUpdate).toBe("1");
      expect(frm.mergePlan).toHaveBeenCalledWith({ version: 4, data: { title: "Remote" } });
      expect(frm.remote_merge_plan).toEqual({ status: "clean" });
      expect(form.dataset.remoteMergeState).toBe("clean");
      expect(mergeButton(panel).hidden).toBe(false);
      expect(mergeButton(panel).disabled).toBe(false);
      expect(mergeButton(panel).textContent).toBe("Merge saved changes");
    });

    it("skips version-less snapshots and stale or older versions", async () => {
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(3));
      FakeWebSocket.instances[0]?.emitMessage({ type: "cf-frappe.realtime.event", event: { payload: {} } });
      expect(panel.dataset.documentState).toBeUndefined();
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Viewing latest saved version.");
    });

    it("ignores events when the panel has no local version", async () => {
      const panel = await hydrateDefaultPanel({
        doctype: "Task",
        documentName: "TASK-1",
        tenantId: "acme",
        realtimeRoute: "/rt"
      });
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(panel.dataset.documentState).toBeUndefined();
    });

    it("leaves the merge action hidden when no form matches", async () => {
      installFormNamespace(makeFrm({ docname: "OTHER-1" }));
      installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(panel.dataset.documentState).toBe("stale");
      expect(mergeButton(panel).hidden).toBe(true);
    });

    it("skips merge planning for snapshots without document data", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(form.dataset.remoteUpdate).toBe("1");
      expect(frm.mergePlan).not.toHaveBeenCalled();
      expect(form.dataset.remoteMergeState).toBeUndefined();
      expect(mergeButton(panel).hidden).toBe(false);
    });

    it("tolerates a missing cfFrappe.form seam", async () => {
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(panel.dataset.documentState).toBe("stale");
      expect(mergeButton(panel).hidden).toBe(true);
    });

    it("tolerates form seams returning no binding", async () => {
      installFormNamespace(null);
      installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(panel.dataset.documentState).toBe("stale");
      expect(mergeButton(panel).hidden).toBe(true);
    });

    it("tolerates a matching frm without a hydrated form element", async () => {
      installFormNamespace(makeFrm());
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(panel.dataset.documentState).toBe("stale");
      expect(mergeButton(panel).hidden).toBe(true);
    });

    it("survives panels rendered without action buttons", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      installForm([{ name: "title", value: "Queued" }]);
      const panel = installPanel(PANEL_DEFAULTS);
      panel.querySelector("[data-cf-frappe-merge-save]")?.remove();
      panel.querySelector("[data-cf-frappe-apply-shared-draft]")?.remove();
      hydratePresencePanels();
      await flushPromises();
      expect(panel.dataset.presenceState).toBe("ready");
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4));
      expect(panel.dataset.documentState).toBe("stale");
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: { title: "Shared" } })
      );
      expect(panel.dataset.sharedDraftState).toBe("available");
    });
  });

  describe("merge save", () => {
    async function stalePanel(frm: FakeFrm): Promise<HTMLElement> {
      installFormNamespace(frm);
      installForm([{ name: "title", value: "Queued" }, { name: "expectedVersion", value: "3", type: "hidden" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(4, { title: "Remote" }));
      return panel;
    }

    it("merge-saves through the form seam and reports the merged version", async () => {
      const frm = makeFrm();
      const panel = await stalePanel(frm);
      mergeButton(panel).click();
      expect(mergeButton(panel).disabled).toBe(true);
      expect(mergeButton(panel).textContent).toBe("Merging...");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Merging saved changes.");
      await flushPromises();
      expect(frm.merge_save).toHaveBeenCalledTimes(1);
      expect(panel.dataset.documentState).toBe("merged");
      expect(panel.dataset.documentVersion).toBe("5");
      expect(panel.dataset.remoteVersion).toBe("5");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Merged saved changes at v5.");
      expect(mergeButton(panel).hidden).toBe(true);
    });

    it("reports noop merges as already up to date, without a version when absent", async () => {
      const frm = makeFrm({ merge_save: vi.fn(() => Promise.resolve({ status: "noop", document: {} })) });
      const panel = await stalePanel(frm);
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentState).toBe("merged");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Already up to date.");
    });

    it("reports noop merges with a version and applied merges without one", async () => {
      const noopFrm = makeFrm({ merge_save: vi.fn(() => Promise.resolve({ status: "noop", document: { version: 7 } })) });
      const panel = await stalePanel(noopFrm);
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentVersion).toBe("7");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Already up to date at v7.");

      noopFrm.merge_save = vi.fn(() => Promise.resolve({ status: "applied" }));
      FakeWebSocket.instances[0]?.emitMessage(documentEvent(9));
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentVersion).toBe("7");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Merged saved changes.");
    });

    it("does not report validation-blocked merges as conflicts", async () => {
      const frm = makeFrm({ merge_save: vi.fn(() => Promise.resolve(false)) });
      const panel = await stalePanel(frm);
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentState).toBe("validation-blocked");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe(
        "Fix validation errors before merging saved changes."
      );
      expect(mergeButton(panel).hidden).toBe(false);
      expect(mergeButton(panel).disabled).toBe(false);
      expect(mergeButton(panel).textContent).toBe("Try merge again");
    });

    it("keeps drafts in place when the merge returns conflicts", async () => {
      const frm = makeFrm({ merge_save: vi.fn(() => Promise.resolve({ status: "conflict" })) });
      const panel = await stalePanel(frm);
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentState).toBe("conflict");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe(
        "Merge conflict. Review local changes before saving."
      );
      expect(mergeButton(panel).textContent).toBe("Try merge again");
    });

    it("surfaces merge errors with their message and a fallback", async () => {
      const frm = makeFrm({ merge_save: vi.fn(() => Promise.reject(new Error("boom"))) });
      const panel = await stalePanel(frm);
      mergeButton(panel).click();
      await flushPromises();
      expect(panel.dataset.documentState).toBe("merge-error");
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("boom");
      expect(mergeButton(panel).textContent).toBe("Try merge again");

      frm.merge_save = vi.fn(() => Promise.reject({}));
      mergeButton(panel).click();
      await flushPromises();
      expect(panelText(panel, "[data-cf-frappe-document-update]")).toBe("Unable to merge saved changes.");
    });

    it("ignores merge clicks when the current form does not match", async () => {
      const frm = makeFrm();
      const panel = await stalePanel(frm);
      frm.docname = "OTHER-1";
      mergeButton(panel).click();
      await flushPromises();
      expect(frm.merge_save).not.toHaveBeenCalled();
    });
  });

  describe("field edits", () => {
    it("renders, replaces and clears live field-edit activity", async () => {
      const panel = await hydrateDefaultPanel();
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(fieldEditFrame({ field: "title", connectionId: "c2", actorId: "reviewer@example.com" }));
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe("reviewer@example.com editing title");
      socket.emitMessage(fieldEditFrame({ field: "body", connectionId: "c1" }));
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe(
        "c1 editing body, reviewer@example.com editing title"
      );
      socket.emitMessage(fieldEditFrame({ field: "title", connectionId: "c2", editing: false }));
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe("c1 editing body");
      socket.emitMessage(fieldEditFrame({ field: "body", connectionId: "c1", editing: false }));
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe("No live field edits.");
    });

    it("ignores payloads without a field", async () => {
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(fieldEditFrame({ connectionId: "c1" }));
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe("No live field edits.");
    });

    it("prunes edits whose connections leave the presence roster", async () => {
      const panel = await hydrateDefaultPanel();
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(fieldEditFrame({ field: "title", connectionId: "c2" }));
      socket.emitMessage(fieldEditFrame({ field: "body" }));
      socket.emitMessage({
        type: "cf-frappe.realtime.presence",
        presence: { connections: [{ connectionId: "c2" }, {}] }
      });
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe("c2 editing title");
      socket.emitMessage({ type: "cf-frappe.realtime.presence", presence: { connections: [] } });
      expect(panelText(panel, "[data-cf-frappe-field-edits]")).toBe("No live field edits.");
    });
  });

  describe("shared drafts", () => {
    it("announces applicable shared drafts and enables apply for matching forms", async () => {
      installFormNamespace(makeFrm());
      installForm([
        { name: "title", value: "Queued" },
        { name: "expectedVersion", value: "3", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({
          doctype: "Task",
          name: "TASK-1",
          actorId: "reviewer@example.com",
          baseVersion: 3,
          patch: { title: "Shared title", body: "Shared body" },
          unset: ["notes"]
        })
      );
      expect(panel.dataset.sharedDraftState).toBe("available");
      expect(panel.dataset.sharedDraftBaseVersion).toBe("3");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "reviewer@example.com shared draft changes: title, body, notes."
      );
      expect(applyButton(panel).hidden).toBe(false);
      expect(applyButton(panel).textContent).toBe("Apply shared draft");
    });

    it("summarizes long field lists with a +N suffix", async () => {
      installFormNamespace(makeFrm());
      installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({
          doctype: "Task",
          name: "TASK-1",
          patch: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }
        })
      );
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "A collaborator shared draft changes: a, b, c, d, e +2 more."
      );
    });

    it("ignores drafts for other documents or with no fields", async () => {
      const panel = await hydrateDefaultPanel();
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(sharedDraftFrame({ doctype: "Task", name: "OTHER-1", patch: { title: "x" } }));
      socket.emitMessage(sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: {}, unset: ["", "  "] }));
      expect(panel.dataset.sharedDraftState).toBeUndefined();
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe("No shared draft proposals.");
    });

    it("shows drafts without an actionable form (no apply button)", async () => {
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", connectionId: "c9", patch: { title: "x" } })
      );
      expect(panel.dataset.sharedDraftState).toBe("available");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe("c9 shared draft changes: title.");
      expect(applyButton(panel).hidden).toBe(true);
    });

    it("marks version-mismatched drafts stale on arrival", async () => {
      installFormNamespace(makeFrm());
      installForm([
        { name: "title", value: "Queued" },
        { name: "expectedVersion", value: "3", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", baseVersion: 2, patch: { title: "Old" } })
      );
      expect(panel.dataset.sharedDraftState).toBe("stale");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "A collaborator shared draft changes for v2; current form is v3."
      );
      expect(applyButton(panel).hidden).toBe(true);
    });

    it("applies shared draft patches and unsets to the form, including child cells", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([
        { name: "title", value: "Queued" },
        { name: "notes", value: "Keep local" },
        { name: "items[0].qty", value: "1", fieldType: "integer" },
        { name: "expectedVersion", value: "3", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({
          doctype: "Task",
          name: "TASK-1",
          actorId: "reviewer@example.com",
          baseVersion: 3,
          patch: { title: "Shared title", "items[0].qty": 7, expectedVersion: 99 },
          unset: ["notes", "title"]
        })
      );
      applyButton(panel).click();
      expect(panel.dataset.sharedDraftState).toBe("applied");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "Applied shared draft from reviewer@example.com: title, items[0].qty, notes."
      );
      expect(applyButton(panel).hidden).toBe(true);
      expect(fieldNamed(form, "title").value).toBe("Shared title");
      expect(fieldNamed(form, "items[0].qty").value).toBe("7");
      expect(fieldNamed(form, "notes").value).toBe("");
      expect(fieldNamed(form, "expectedVersion").value).toBe("3");
      expect(frm.dirty).toHaveBeenCalledTimes(1);
      expect(frm.trigger.mock.calls.map((call) => call[0])).toEqual(["title", "items[0].qty", "notes"]);
      expect(frm.doc).toEqual({ title: "Shared title", items: [{ qty: 7 }] });
    });

    it("reports drafts with only internal fields as not applicable", async () => {
      installFormNamespace(makeFrm());
      installForm([
        { name: "title", value: "Queued" },
        { name: "expectedVersion", value: "3", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: { expectedVersion: 9 } })
      );
      applyButton(panel).click();
      expect(panel.dataset.sharedDraftState).toBe("noop");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe("No applicable shared draft changes.");
      expect(applyButton(panel).hidden).toBe(true);
    });

    it("refuses to apply drafts that became stale after arrival", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([
        { name: "title", value: "Queued" },
        { name: "expectedVersion", value: "3", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", baseVersion: 3, patch: { title: "Shared" } })
      );
      form.dataset.documentVersion = "5";
      applyButton(panel).click();
      expect(panel.dataset.sharedDraftState).toBe("stale");
      expect(applyButton(panel).hidden).toBe(true);
      expect(fieldNamed(form, "title").value).toBe("Queued");
      expect(frm.dirty).not.toHaveBeenCalled();
    });

    it("ignores apply clicks without a stored draft or matching form", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      applyButton(panel).click();
      expect(frm.dirty).not.toHaveBeenCalled();

      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: { title: "Shared" } })
      );
      frm.doctype = "Other";
      applyButton(panel).click();
      expect(frm.dirty).not.toHaveBeenCalled();
    });

    it("coerces typed controls when applying drafts (checkbox, json, boolean, number)", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([
        { name: "done", value: "on", type: "checkbox" },
        { name: "meta", value: "{}", fieldType: "json" },
        { name: "flag", value: "true", fieldType: "boolean" },
        { name: "score", value: "1.5", fieldType: "number" },
        { name: "broken", value: "{oops", fieldType: "json" },
        { name: "count", value: "x", fieldType: "integer" },
        { name: "blank", value: "", fieldType: "number", required: true },
        { name: "empty", value: "", fieldType: "number" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({
          doctype: "Task",
          name: "TASK-1",
          patch: { done: false, meta: { a: 1 }, flag: "off" },
          unset: ["score"]
        })
      );
      applyButton(panel).click();
      expect((fieldNamed(form, "done") as HTMLInputElement).checked).toBe(false);
      expect(fieldNamed(form, "meta").value).toBe('{"a":1}');
      expect(fieldNamed(form, "flag").value).toBe("off");
      expect(fieldNamed(form, "score").value).toBe("");
      expect(fieldNamed(form, "empty").value).toBe("");
      expect(frm.doc).toEqual({
        done: false,
        meta: { a: 1 },
        flag: "off",
        broken: "{oops",
        count: "x",
        blank: 0,
        empty: undefined
      });
      expect(panel.dataset.sharedDraftState).toBe("applied");
    });

    it("applies unset-only drafts, including child-table cells and unknown tables", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([
        { name: "items[0].qty", value: "2", fieldType: "integer" },
        { name: "items[0].__cf_frappe_row_index", value: "0", type: "hidden" },
        { name: "__cf_frappe_row_index", value: "0", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({
          doctype: "Task",
          name: "TASK-1",
          unset: ["items[0].qty", "items[9].qty", "ghosts[0].x", "", "items[0].__cf_frappe_row_index"]
        })
      );
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "A collaborator shared draft changes: items[0].qty, items[9].qty, ghosts[0].x, items[0].__cf_frappe_row_index."
      );
      applyButton(panel).click();
      expect(panel.dataset.sharedDraftState).toBe("applied");
      expect(fieldNamed(form, "items[0].qty").value).toBe("");
      expect(frm.doc).toEqual({ items: [{}], ghosts: [] });
      expect(frm.trigger.mock.calls.map((call) => call[0])).toEqual([
        "items[0].qty",
        "items[9].qty",
        "ghosts[0].x"
      ]);
    });

    it("skips empty patch keys and keeps non-numeric typed values as raw strings", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([
        { name: "title", value: "Queued" },
        { name: "nan", value: "x.", fieldType: "number" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: { "": "ignored", "  ": "ignored", title: "Shared" } })
      );
      applyButton(panel).click();
      expect(fieldNamed(form, "title").value).toBe("Shared");
      expect(frm.doc).toEqual({ title: "Shared", nan: "x." });
      expect(frm.trigger.mock.calls.map((call) => call[0])).toEqual(["title"]);
    });

    it("announces unset-only drafts when the payload patch is not an object", async () => {
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: "nope", unset: ["title"] })
      );
      expect(panel.dataset.sharedDraftState).toBe("available");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe("A collaborator shared draft changes: title.");
    });

    it("resolves the form base version from the page context when the form has no version control", async () => {
      installRuntimeScript({
        "data-doctype": "Task",
        "data-document-name": "TASK-1",
        "data-document-version": "3",
        "data-scope": "form",
        "data-tenant-id": "acme"
      });
      installFormNamespace(makeFrm());
      installForm([{ name: "title", value: "Queued" }]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", baseVersion: 2, patch: { title: "Old" } })
      );
      expect(panel.dataset.sharedDraftState).toBe("stale");
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "A collaborator shared draft changes for v2; current form is v3."
      );
    });

    it("treats malformed expectedVersion controls as version 0", async () => {
      installFormNamespace(makeFrm());
      installForm([
        { name: "title", value: "Queued" },
        { name: "expectedVersion", value: "abc", type: "hidden" }
      ]);
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", baseVersion: 4, patch: { title: "Old" } })
      );
      expect(panelText(panel, "[data-cf-frappe-shared-draft]")).toBe(
        "A collaborator shared draft changes for v4; current form is v0."
      );
    });

    it("ignores malformed data-document-version stamps in favor of the fallback chain", async () => {
      installFormNamespace(makeFrm());
      const form = installForm([
        { name: "title", value: "Queued" },
        { name: "expectedVersion", value: "3", type: "hidden" }
      ]);
      form.dataset.documentVersion = "not-a-number";
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", baseVersion: 3, patch: { title: "Shared" } })
      );
      applyButton(panel).click();
      expect(panel.dataset.sharedDraftState).toBe("applied");
      expect(fieldNamed(form, "title").value).toBe("Shared");
    });

    it("preserves locked-field bookkeeping when rewriting the form", async () => {
      const frm = makeFrm();
      installFormNamespace(frm);
      const form = installForm([
        { name: "title", value: "Queued" },
        { name: "locked", value: "keep" }
      ]);
      const lockedField = fieldNamed(form, "locked") as unknown as Record<string, unknown>;
      lockedField.__cfFrappeReadOnly = true;
      const panel = await hydrateDefaultPanel();
      FakeWebSocket.instances[0]?.emitMessage(
        sharedDraftFrame({ doctype: "Task", name: "TASK-1", patch: { locked: "remote" } })
      );
      applyButton(panel).click();
      expect(fieldNamed(form, "locked").value).toBe("remote");
      expect(lockedField.__cfFrappeLockedValue).toBe("remote");
      expect(panel.dataset.sharedDraftState).toBe("applied");
    });
  });
});
