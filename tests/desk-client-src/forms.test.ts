import { boot, resetRegistries } from "../../src/adapters/desk/client-src/boot";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  SHARED_DRAFT_MESSAGE_TYPE
} from "../../src/adapters/desk/client-src/constants";
import {
  currentFormBinding,
  formNamespaceExtension,
  formsHydration,
  formsNamespaceContribution,
  registerFormHandlers,
  registerFormsModule,
  resetFormsState,
  triggerFormEvent,
  type FormBinding,
  type Frm
} from "../../src/adapters/desk/client-src/forms";
import type { UnknownRecord } from "../../src/adapters/desk/client-src/seams";

const DEFAULT_CONTEXT: Record<string, string> = {
  "data-doctype": "Task",
  "data-document-name": "T-1",
  "data-document-status": "draft",
  "data-document-version": "3",
  "data-scope": "form"
};

function installRuntimeScript(attributes: Record<string, string>): void {
  const script = document.createElement("script");
  script.setAttribute("data-cf-frappe-runtime", "desk");
  Object.entries(attributes).forEach(([name, value]) => {
    script.setAttribute(name, value);
  });
  document.body.appendChild(script);
}

function installForm(fieldsHtml: string): HTMLFormElement {
  const container = document.createElement("div");
  container.innerHTML = `<form class="panel form document-form" method="post" action="/desk/Task/T-1">${fieldsHtml}</form>`;
  document.body.appendChild(container);
  return container.querySelector("form") as HTMLFormElement;
}

const DEFAULT_FIELDS = `
  <input type="hidden" name="expectedVersion" value="3" />
  <label class="field"><span>Title</span><input name="title" value="Hello" /></label>
  <label class="field"><span>Qty</span><input name="qty" data-cf-frappe-field-type="integer" value="2" /></label>
`;

function bindForm(fieldsHtml = DEFAULT_FIELDS, context: Record<string, string> = DEFAULT_CONTEXT): {
  binding: FormBinding;
  frm: Frm;
  form: HTMLFormElement;
} {
  installRuntimeScript(context);
  const form = installForm(fieldsHtml);
  const binding = currentFormBinding() as FormBinding;
  return { binding, frm: binding.frm, form };
}

function field(form: HTMLFormElement, name: string): HTMLInputElement {
  return form.querySelector(`[name="${name.replace(/([[\]\\.])/g, "\\$1")}"]`) as HTMLInputElement;
}

function dispatchSubmit(form: HTMLFormElement, submitter: Element | null = null): Event {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "submitter", { value: submitter });
  form.dispatchEvent(event);
  return event;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("client-src form binding", () => {
  beforeEach(() => {
    resetFormsState();
    document.body.innerHTML = "";
    (window as unknown as { cfFrappe?: unknown }).cfFrappe = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("currentFormBinding", () => {
    it("returns null outside a form scope, without a doctype, or without a form element", () => {
      installRuntimeScript({ "data-doctype": "Task", "data-scope": "list" });
      installForm(DEFAULT_FIELDS);
      expect(currentFormBinding()).toBeNull();

      document.body.innerHTML = "";
      installRuntimeScript({ "data-scope": "form" });
      installForm(DEFAULT_FIELDS);
      expect(currentFormBinding()).toBeNull();

      document.body.innerHTML = "";
      installRuntimeScript(DEFAULT_CONTEXT);
      expect(currentFormBinding()).toBeNull();
    });

    it("caches the binding per form element and rebinds when the form is replaced", () => {
      const { binding, form } = bindForm();
      expect(currentFormBinding()).toBe(binding);
      form.remove();
      const replacement = installForm(DEFAULT_FIELDS);
      const next = currentFormBinding() as FormBinding;
      expect(next).not.toBe(binding);
      expect(next.form).toBe(replacement);
    });

    it("reads context, base document and version from the page", () => {
      const { binding, frm } = bindForm();
      expect(frm.doctype).toBe("Task");
      expect(frm.docname).toBe("T-1");
      expect(frm.is_new()).toBe(false);
      expect(frm.is_dirty()).toBe(false);
      expect(binding.baseVersion).toBe(3);
      expect(binding.doc).toEqual({ title: "Hello", qty: 2 });
    });

    it("falls back to the expectedVersion input when the context has no version", () => {
      const context = { "data-doctype": "Task", "data-scope": "form" };
      const { binding } = bindForm(`<input type="hidden" name="expectedVersion" value="5" /><input name="title" value="A" />`, context);
      expect(binding.baseVersion).toBe(5);
    });

    it("expectedVersion falls back to 0 when missing or invalid", () => {
      const context = { "data-doctype": "Task", "data-scope": "form" };
      const { binding } = bindForm(`<input name="title" value="A" />`, context);
      expect(binding.baseVersion).toBe(0);

      resetFormsState();
      document.body.innerHTML = "";
      const invalid = bindForm(`<input type="hidden" name="expectedVersion" value="abc" /><input name="title" value="A" />`, context);
      expect(invalid.binding.baseVersion).toBe(0);

      resetFormsState();
      document.body.innerHTML = "";
      const negative = bindForm(`<input type="hidden" name="expectedVersion" value="-2" /><input name="title" value="A" />`, context);
      expect(negative.binding.baseVersion).toBe(0);
    });
  });

  describe("typed field coercion", () => {
    it("coerces checkbox, integer, number, boolean and json fields", () => {
      const { frm } = bindForm(`
        <input type="checkbox" name="done" checked />
        <input name="qty" data-cf-frappe-field-type="integer" value="7" />
        <input name="rate" data-cf-frappe-field-type="number" value="1.5" />
        <input name="flag" data-cf-frappe-field-type="boolean" value="on" />
        <input name="flag2" data-cf-frappe-field-type="boolean" value="true" />
        <input name="flag3" data-cf-frappe-field-type="boolean" value="off" />
        <input name="meta" data-cf-frappe-field-type="json" value='{"a":1}' />
        <input name="plain" value="text" />
      `);
      expect(frm.get_value("done")).toBe(true);
      expect(frm.get_value("qty")).toBe(7);
      expect(frm.get_value("rate")).toBe(1.5);
      expect(frm.get_value("flag")).toBe(true);
      expect(frm.get_value("flag2")).toBe(true);
      expect(frm.get_value("flag3")).toBe(false);
      expect(frm.get_value("meta")).toEqual({ a: 1 });
      expect(frm.get_value("plain")).toBe("text");
    });

    it("keeps raw strings for unparseable typed values and empty optional typed fields become undefined", () => {
      const { frm } = bindForm(`
        <input name="qty" data-cf-frappe-field-type="integer" value="4.5" />
        <input name="rate" data-cf-frappe-field-type="number" value="x" />
        <input name="meta" data-cf-frappe-field-type="json" value="{oops" />
        <input name="blank" data-cf-frappe-field-type="integer" value="" />
        <input name="blankReq" data-cf-frappe-field-type="integer" value="" required />
      `);
      expect(frm.get_value("qty")).toBe("4.5");
      expect(frm.get_value("rate")).toBe("x");
      expect(frm.get_value("meta")).toBe("{oops");
      expect(frm.get_value("blank")).toBeUndefined();
      expect(frm.get_value("blankReq")).toBe(0);
    });
  });

  describe("child table paths", () => {
    it("collects child rows and skips internal row-index fields", () => {
      const { binding, frm } = bindForm(`
        <input name="items[0].${CHILD_TABLE_ROW_INDEX_FIELD}" value="0" />
        <input name="items[0].qty" data-cf-frappe-field-type="integer" value="2" />
        <input name="items[1].qty" data-cf-frappe-field-type="integer" value="3" />
        <input name="${CHILD_TABLE_ROW_INDEX_FIELD}" value="9" />
      `);
      expect(binding.doc).toEqual({ items: [{ qty: 2 }, { qty: 3 }] });
      expect(frm.get_value("items[1].qty")).toBe(3);
      expect(frm.get_value("items[5].qty")).toBeUndefined();
      expect(frm.get_value("missing[0].x")).toBeUndefined();
    });

    it("writes child values back through set_value", async () => {
      const { form, frm } = bindForm(`<input name="items[0].qty" data-cf-frappe-field-type="integer" value="2" />`);
      await frm.set_value("items[0].qty", 10);
      expect(field(form, "items[0].qty").value).toBe("10");
      expect(frm.get_value("items[0].qty")).toBe(10);
    });
  });

  describe("frm value API", () => {
    it("set_value updates the DOM, marks dirty and fires the field handler", async () => {
      const handler = vi.fn();
      const { form, frm } = bindForm();
      registerFormHandlers("Task", { title: handler });
      const result = await frm.set_value("title", "Changed");
      expect(result).toBe("Changed");
      expect(field(form, "title").value).toBe("Changed");
      expect(frm.is_dirty()).toBe(true);
      expect(form.dataset.dirty).toBe("1");
      expect(handler).toHaveBeenCalledWith(frm);
    });

    it("clear_value blanks the field", async () => {
      const { form, frm } = bindForm();
      await frm.clear_value("title");
      expect(field(form, "title").value).toBe("");
    });

    it("set_value stringifies objects into json fields and booleans into checkboxes", async () => {
      const { form, frm } = bindForm(`
        <input name="meta" data-cf-frappe-field-type="json" value="{}" />
        <input type="checkbox" name="done" />
      `);
      await frm.set_value("meta", { b: 2 });
      expect(field(form, "meta").value).toBe('{"b":2}');
      await frm.set_value("done", true);
      expect(field(form, "done").checked).toBe(true);
    });

    it("get_field and refresh_field target the named control", () => {
      const { form, frm } = bindForm();
      expect(frm.get_field("title")).toBe(field(form, "title"));
      expect(frm.get_field("nope")).toBeNull();
      binding_setDoc(frm, "title", "FromDoc");
      frm.refresh_field("title");
      expect(field(form, "title").value).toBe("FromDoc");
    });

    function binding_setDoc(frm: Frm, name: string, value: unknown): void {
      frm.doc[name] = value;
    }
  });

  describe("field change listeners", () => {
    it("marks the form dirty and fires field handlers on change and input events", () => {
      const titleHandler = vi.fn();
      const { form, frm } = bindForm();
      registerFormHandlers("Task", { title: titleHandler });
      const input = field(form, "title");
      input.value = "Edited";
      input.dispatchEvent(new Event("input"));
      expect(frm.is_dirty()).toBe(true);
      expect(frm.get_value("title")).toBe("Edited");
      input.dispatchEvent(new Event("change"));
      expect(titleHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("set_df_property / toggles", () => {
    it("hides the field and its .field wrapper via hidden and display", () => {
      const { form, frm } = bindForm();
      const input = field(form, "title");
      const wrapper = input.closest(".field") as HTMLElement;
      frm.toggle_display("title", false);
      expect(input.hidden).toBe(true);
      expect(wrapper.hidden).toBe(true);
      frm.set_df_property("title", "display", true);
      expect(input.hidden).toBe(false);
      frm.set_df_property("title", "hidden", true);
      expect(input.hidden).toBe(true);
    });

    it("read_only locks the value and restores edits", () => {
      const { form, frm } = bindForm();
      const input = field(form, "title");
      frm.set_df_property("title", "read_only", true);
      expect(input.readOnly).toBe(true);
      expect(input.getAttribute("aria-readonly")).toBe("true");
      input.value = "Tampered";
      input.dispatchEvent(new Event("input"));
      expect(input.value).toBe("Hello");
      expect(frm.is_dirty()).toBe(false);
      input.dispatchEvent(new Event("change"));
      expect(frm.is_dirty()).toBe(false);

      frm.set_df_property("title", "readOnly", false);
      expect(input.readOnly).toBe(false);
      expect(input.getAttribute("aria-readonly")).toBeNull();
      input.value = "Edited";
      input.dispatchEvent(new Event("input"));
      expect(input.value).toBe("Edited");
      expect(frm.is_dirty()).toBe(true);
    });

    it("toggle_enable soft-disables and restores edits", () => {
      const { form, frm } = bindForm();
      const input = field(form, "qty");
      frm.toggle_enable("qty", false);
      expect(input.getAttribute("aria-disabled")).toBe("true");
      input.value = "99";
      input.dispatchEvent(new Event("change"));
      expect(input.value).toBe("2");
      frm.toggle_enable("qty", true);
      expect(input.getAttribute("aria-disabled")).toBeNull();
      input.value = "5";
      input.dispatchEvent(new Event("change"));
      expect(frm.get_value("qty")).toBe(5);
    });

    it("supports reqd/required and arbitrary properties", () => {
      const { form, frm } = bindForm();
      const input = field(form, "title");
      frm.set_df_property("title", "reqd", true);
      expect(input.required).toBe(true);
      frm.set_df_property("title", "required", false);
      expect(input.required).toBe(false);
      frm.set_df_property("title", "placeholder", "Type here");
      expect(input.placeholder).toBe("Type here");
    });
  });

  describe("handlers and events", () => {
    it("fires setup/onload/refresh when registering against the current doctype", () => {
      const setup = vi.fn();
      const onload = vi.fn();
      const refresh = vi.fn();
      const { frm } = bindForm();
      registerFormHandlers("Task", { setup, onload, refresh });
      expect(setup).toHaveBeenCalledWith(frm);
      expect(onload).toHaveBeenCalledWith(frm);
      expect(refresh).toHaveBeenCalledWith(frm);
    });

    it("does not fire handlers registered for another doctype", () => {
      const setup = vi.fn();
      bindForm();
      registerFormHandlers("Other", { setup });
      expect(setup).not.toHaveBeenCalled();
    });

    it("does nothing when registering without a bound form", () => {
      installRuntimeScript({ "data-scope": "list" });
      const setup = vi.fn();
      expect(() => registerFormHandlers("Task", { setup })).not.toThrow();
      expect(setup).not.toHaveBeenCalled();
    });

    it("aggregates handler results through trigger/refresh", () => {
      const { binding, frm } = bindForm();
      registerFormHandlers("Task", { custom: () => true, refresh: vi.fn() });
      registerFormHandlers("Task", { custom: () => false });
      expect(frm.trigger("custom")).toBe(false);
      expect(frm.refresh()).toBe(true);
      expect(triggerFormEvent(binding, "unknown-event")).toBe(true);
    });
  });

  describe("save validation", () => {
    it("prevents native submit when a validate handler fails", () => {
      const { form } = bindForm();
      registerFormHandlers("Task", { validate: () => false });
      const event = dispatchSubmit(form);
      expect(event.defaultPrevented).toBe(true);
    });

    it("allows native submit when validation passes", () => {
      const { form } = bindForm();
      registerFormHandlers("Task", { validate: () => true, before_save: () => true });
      const event = dispatchSubmit(form);
      expect(event.defaultPrevented).toBe(false);
    });

    it("skips validation for secondary formaction submitters", () => {
      const { form } = bindForm();
      registerFormHandlers("Task", { validate: () => false });
      const button = document.createElement("button");
      button.setAttribute("formaction", "/desk/Task/T-1/amend");
      const event = dispatchSubmit(form, button);
      expect(event.defaultPrevented).toBe(false);
    });

    it("skips validation while a programmatic save is in flight", () => {
      const { binding, form } = bindForm();
      registerFormHandlers("Task", { validate: () => false });
      binding.submitting = true;
      const event = dispatchSubmit(form);
      expect(event.defaultPrevented).toBe(false);
    });

    it("honors frm.validated = false and before_save = false", () => {
      const { form, frm } = bindForm();
      registerFormHandlers("Task", {
        validate: (currentFrm: Frm) => {
          currentFrm.validated = false;
        }
      });
      expect(frm.save()).toBe(false);

      resetFormsState();
      document.body.innerHTML = "";
      const next = bindForm();
      registerFormHandlers("Task", { before_save: () => false });
      expect(next.frm.save()).toBe(false);
    });

    it("frm.save() submits natively via requestSubmit and falls back to submit()", () => {
      const { form, frm } = bindForm();
      const requestSubmit = vi.fn();
      (form as unknown as UnknownRecord).requestSubmit = requestSubmit;
      expect(frm.save()).toBe(true);
      expect(requestSubmit).toHaveBeenCalledTimes(1);

      const submit = vi.fn();
      (form as unknown as UnknownRecord).requestSubmit = undefined;
      (form as unknown as UnknownRecord).submit = submit;
      expect(frm.save()).toBe(true);
      expect(submit).toHaveBeenCalledTimes(1);
    });
  });

  describe("merge save", () => {
    it("POSTs the local change plan and applies the returned snapshot", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            status: "applied",
            document: { version: 4, docstatus: "draft", data: { title: "New", qty: 2 } }
          }
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      const { binding, form, frm } = bindForm();
      await frm.set_value("title", "New");
      const result = (await frm.merge_save()) as UnknownRecord;
      expect(result.status).toBe("applied");
      const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/api/resource/Task/T-1/merge");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ baseVersion: 3, patch: { title: "New" } });
      expect(binding.baseVersion).toBe(4);
      expect(form.dataset.documentVersion).toBe("4");
      expect(form.dataset.remoteMergeState).toBe("clean");
      expect(form.dataset.dirty).toBeUndefined();
      expect(field(form, "expectedVersion").value).toBe("4");
      expect(field(form, "title").value).toBe("New");
      expect(frm.is_dirty()).toBe(false);
      expect(binding.submitting).toBe(false);
    });

    it("includes unsets for cleared typed fields and applies noop results", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          data: { status: "noop", document: { version: 3, docstatus: "draft", data: { title: "Hello" } } }
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      const { frm } = bindForm();
      await frm.set_value("qty", "");
      await frm.save({ merge: true });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ baseVersion: 3, patch: {}, unset: ["qty"] });
      expect(frm.is_dirty()).toBe(false);
    });

    it("records conflict plans without applying them", async () => {
      const remoteDocument = { version: 9, docstatus: "draft", data: { title: "Remote" } };
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          data: { status: "conflict", plan: { status: "conflict" }, document: remoteDocument }
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      const { binding, form, frm } = bindForm();
      await frm.set_value("title", "Local");
      await frm.merge_save();
      expect(form.dataset.remoteMergeState).toBe("conflict");
      expect(frm.remote_merge_plan).toEqual({ status: "conflict" });
      expect(binding.remoteSnapshot).toEqual(remoteDocument);
      expect(field(form, "title").value).toBe("Local");
      expect(binding.baseVersion).toBe(3);
      // subsequent merge plans use the cached remote snapshot
      const plan = frm.mergePlan();
      expect(plan.remoteVersion).toBe(9);
      expect(plan.status).toBe("conflict");
    });

    it("ignores snapshots without data and results without documents", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ data: { status: "applied", document: { version: 4 } } })
      );
      vi.stubGlobal("fetch", fetchMock);
      const { binding, frm } = bindForm();
      await frm.set_value("title", "X");
      await frm.merge_save();
      expect(binding.baseVersion).toBe(3);
      expect(frm.is_dirty()).toBe(true);
    });

    it("rejects for new documents and short-circuits while submitting or invalid", async () => {
      const { binding, frm } = bindForm(DEFAULT_FIELDS, {
        "data-doctype": "Task",
        "data-scope": "form"
      });
      await expect(frm.merge_save()).rejects.toThrow("Merge save requires an existing document");

      resetFormsState();
      document.body.innerHTML = "";
      const bound = bindForm();
      bound.binding.submitting = true;
      await expect(bound.frm.merge_save()).resolves.toBe(false);
      bound.binding.submitting = false;
      registerFormHandlers("Task", { validate: () => false });
      await expect(bound.frm.merge_save()).resolves.toBe(false);
      expect(binding).toBeTruthy();
    });
  });

  describe("merge plans", () => {
    it("defaults the remote snapshot to the base document", async () => {
      const { frm } = bindForm();
      await frm.set_value("title", "Local");
      const plan = frm.mergePlan();
      expect(plan.status).toBe("clean");
      expect(plan.patch).toEqual({ title: "Local" });
      expect(plan.baseVersion).toBe(3);
      expect(plan.remoteVersion).toBe(3);
    });

    it("accepts explicit remote snapshots and drafts", () => {
      const { frm } = bindForm();
      const plan = frm.mergePlan({ version: 8, data: { title: "Remote" } }, { title: "Draft", qty: 2 });
      expect(plan.status).toBe("conflict");
      expect(plan.remoteVersion).toBe(8);
      expect(plan.conflicts[0]!.field).toBe("title");
    });

    it("merges child tables as whole fields", async () => {
      const { frm } = bindForm(`
        <input name="items[0].${CHILD_TABLE_ROW_INDEX_FIELD}" value="0" />
        <input name="items[0].qty" data-cf-frappe-field-type="integer" value="2" />
      `);
      await frm.set_value("items[0].qty", 4);
      const plan = frm.mergePlan();
      expect(plan.localChangedFields).toEqual(["items"]);
      expect(plan.patch).toEqual({ items: [{ qty: 4 }] });
    });
  });

  describe("collaboration", () => {
    const COLLAB_CONTEXT: Record<string, string> = {
      ...DEFAULT_CONTEXT,
      "data-tenant-id": "acme",
      "data-realtime-route": "/api/realtime"
    };

    function installRealtime(subscription: UnknownRecord | (() => never)): ReturnType<typeof vi.fn> {
      const subscribe =
        typeof subscription === "function"
          ? vi.fn(subscription)
          : vi.fn(() => subscription);
      (window as unknown as { cfFrappe?: unknown }).cfFrappe = { realtime: { subscribe } };
      return subscribe;
    }

    it("subscribes to the document topic with tenant + realtime route", () => {
      const subscription = { sendFieldEdit: vi.fn(), sendSharedDraft: vi.fn() };
      const subscribe = installRealtime(subscription);
      const { binding } = bindForm(DEFAULT_FIELDS, COLLAB_CONTEXT);
      expect(subscribe).toHaveBeenCalledWith(
        "document:acme:Task:T-1",
        {},
        { tenantId: "acme", realtimeRoute: "/api/realtime" }
      );
      expect(binding.collaborationSubscription).toBe(subscription);
    });

    it("sends field edit intents on focus/change/blur and skips internal fields", () => {
      const sendFieldEdit = vi.fn();
      installRealtime({ sendFieldEdit });
      const { form } = bindForm(DEFAULT_FIELDS, COLLAB_CONTEXT);
      const title = field(form, "title");
      title.dispatchEvent(new Event("focus"));
      expect(sendFieldEdit).toHaveBeenLastCalledWith("title", { editing: true });
      title.value = "Live";
      title.dispatchEvent(new Event("input"));
      expect(sendFieldEdit).toHaveBeenLastCalledWith("title", { editing: true });
      title.dispatchEvent(new Event("change"));
      expect(sendFieldEdit).toHaveBeenLastCalledWith("title", { editing: true });
      title.dispatchEvent(new Event("blur"));
      expect(sendFieldEdit).toHaveBeenLastCalledWith("title", { editing: false });
      sendFieldEdit.mockClear();
      const version = field(form, "expectedVersion");
      version.dispatchEvent(new Event("focus"));
      expect(sendFieldEdit).not.toHaveBeenCalled();
    });

    it("degrades to no subscription when the realtime module is missing or throws", () => {
      const { binding, form } = bindForm(DEFAULT_FIELDS, COLLAB_CONTEXT);
      expect(binding.collaborationSubscription).toBeUndefined();
      expect(() => field(form, "title").dispatchEvent(new Event("focus"))).not.toThrow();

      resetFormsState();
      document.body.innerHTML = "";
      installRealtime(() => {
        throw new Error("socket unavailable");
      });
      const failed = bindForm(DEFAULT_FIELDS, COLLAB_CONTEXT);
      expect(failed.binding.collaborationSubscription).toBeUndefined();
    });

    it("skips collaboration entirely without tenant/route/document context", () => {
      const subscribe = installRealtime({ sendFieldEdit: vi.fn() });
      bindForm();
      expect(subscribe).not.toHaveBeenCalled();
    });
  });

  describe("share_draft", () => {
    const COLLAB_CONTEXT: Record<string, string> = {
      ...DEFAULT_CONTEXT,
      "data-tenant-id": "acme",
      "data-realtime-route": "/api/realtime"
    };

    it("returns a bare shared-draft message when nothing changed", () => {
      const { frm } = bindForm();
      expect(frm.share_draft()).toEqual({
        type: SHARED_DRAFT_MESSAGE_TYPE,
        baseVersion: 3,
        patch: {}
      });
    });

    it("returns the message when no subscription can deliver it", async () => {
      const { frm } = bindForm();
      await frm.set_value("title", "Draft");
      expect(frm.share_draft()).toEqual({
        type: SHARED_DRAFT_MESSAGE_TYPE,
        baseVersion: 3,
        patch: { title: "Draft" }
      });
    });

    it("delivers changed drafts through the collaboration subscription", async () => {
      const sendSharedDraft = vi.fn((input: unknown) => ({ delivered: input }));
      (window as unknown as { cfFrappe?: unknown }).cfFrappe = {
        realtime: { subscribe: vi.fn(() => ({ sendFieldEdit: vi.fn(), sendSharedDraft })) }
      };
      const { frm } = bindForm(DEFAULT_FIELDS, COLLAB_CONTEXT);
      await frm.set_value("title", "Draft");
      const result = frm.share_draft() as UnknownRecord;
      expect(sendSharedDraft).toHaveBeenCalledWith({ baseVersion: 3, patch: { title: "Draft" } });
      expect(result.delivered).toEqual({ baseVersion: 3, patch: { title: "Draft" } });
    });

    it("includes unsets and falls back when the subscription cannot send drafts", async () => {
      (window as unknown as { cfFrappe?: unknown }).cfFrappe = {
        realtime: { subscribe: vi.fn(() => ({ sendFieldEdit: vi.fn() })) }
      };
      const { frm } = bindForm(DEFAULT_FIELDS, COLLAB_CONTEXT);
      await frm.set_value("qty", "");
      expect(frm.share_draft()).toEqual({
        type: SHARED_DRAFT_MESSAGE_TYPE,
        baseVersion: 3,
        patch: {},
        unset: ["qty"]
      });
    });

    it("respects explicit inputs and prunes unset fields from the patch", () => {
      const { frm } = bindForm();
      expect(frm.share_draft({ patch: { a: 1, b: 2 }, unset: ["a"] })).toEqual({
        type: SHARED_DRAFT_MESSAGE_TYPE,
        patch: { b: 2 },
        unset: ["a"]
      });
      expect(frm.share_draft("nonsense")).toEqual({
        type: SHARED_DRAFT_MESSAGE_TYPE,
        baseVersion: 3,
        patch: {}
      });
    });
  });

  describe("conditional visibility DSL (data-cf-frappe-hidden-depends-on)", () => {
    const fieldOp = (name: string): UnknownRecord => ({ kind: "field", scope: "after", field: name });
    const lit = (value: unknown): UnknownRecord => ({ kind: "literal", value });
    const cmp = (operator: string, left: unknown, right: unknown): UnknownRecord => ({
      kind: "compare",
      operator,
      left,
      right
    });

    function hiddenFor(
      expression: unknown,
      sourceValue: string,
      options: { fieldType?: string; context?: Record<string, string>; rawAttribute?: string } = {}
    ): boolean {
      resetFormsState();
      document.body.innerHTML = "";
      installRuntimeScript(options.context ?? { "data-doctype": "Task", "data-scope": "form" });
      const typeAttr = options.fieldType ? ` data-cf-frappe-field-type="${options.fieldType}"` : "";
      const form = installForm(`
        <label class="field"><input name="status"${typeAttr} /></label>
        <label class="field"><input name="target" /></label>
      `);
      field(form, "status").value = sourceValue;
      const target = field(form, "target");
      target.setAttribute(
        "data-cf-frappe-hidden-depends-on",
        options.rawAttribute ?? JSON.stringify(expression)
      );
      currentFormBinding();
      return target.hidden;
    }

    const statusEq = (value: unknown): UnknownRecord => cmp("eq", fieldOp("status"), lit(value));

    it("evaluates eq/ne against form values", () => {
      expect(hiddenFor(statusEq("open"), "open")).toBe(true);
      expect(hiddenFor(statusEq("open"), "closed")).toBe(false);
      expect(hiddenFor(cmp("ne", fieldOp("status"), lit("open")), "closed")).toBe(true);
      expect(hiddenFor(cmp("ne", fieldOp("status"), lit("open")), "open")).toBe(false);
      expect(hiddenFor(cmp("ne", fieldOp("status"), lit("open")), "", { fieldType: "integer" })).toBe(false);
    });

    it("compares deep values structurally for eq", () => {
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit([1, 2])), "[1,2]", { fieldType: "json" })).toBe(true);
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit([1, 3])), "[1,2]", { fieldType: "json" })).toBe(false);
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit({ a: 1 })), '{"a":1}', { fieldType: "json" })).toBe(true);
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit({ a: 2 })), '{"a":1}', { fieldType: "json" })).toBe(false);
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit({ a: 1, b: 2 })), '{"a":1}', { fieldType: "json" })).toBe(false);
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit([1])), '{"0":1}', { fieldType: "json" })).toBe(false);
      expect(hiddenFor(cmp("eq", fieldOp("status"), lit(null)), "", { fieldType: "integer" })).toBe(false);
    });

    it("evaluates in/not_in/is operators", () => {
      expect(hiddenFor(cmp("in", fieldOp("status"), lit(["a", "b"])), "a")).toBe(true);
      expect(hiddenFor(cmp("in", fieldOp("status"), lit(["a", "b"])), "c")).toBe(false);
      expect(hiddenFor(cmp("in", fieldOp("status"), lit("a")), "a")).toBe(false);
      expect(hiddenFor(cmp("not_in", fieldOp("status"), lit(["a"])), "b")).toBe(true);
      expect(hiddenFor(cmp("not_in", fieldOp("status"), lit(["a"])), "a")).toBe(false);
      expect(hiddenFor(cmp("is", fieldOp("status"), lit("set")), "x")).toBe(true);
      expect(hiddenFor(cmp("is", fieldOp("status"), lit("set")), "", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("is", fieldOp("status"), lit("not set")), "", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("is", fieldOp("status"), lit("other")), "x")).toBe(false);
    });

    it("evaluates contains and like patterns case-insensitively", () => {
      expect(hiddenFor(cmp("contains", fieldOp("status"), lit("PEN")), "opened")).toBe(true);
      expect(hiddenFor(cmp("contains", fieldOp("status"), lit("zzz")), "opened")).toBe(false);
      expect(hiddenFor(cmp("contains", fieldOp("status"), lit(null)), "opened")).toBe(false);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("%pen%")), "OPENED")).toBe(true);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("o_en%")), "opened")).toBe(true);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("o_en")), "opened")).toBe(false);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("50\\%")), "50%")).toBe(true);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("50\\%")), "500")).toBe(false);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("x\\")), "x")).toBe(false);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit("a+b")), "a+b")).toBe(true);
      expect(hiddenFor(cmp("like", fieldOp("status"), lit(5)), "5")).toBe(false);
      expect(hiddenFor(cmp("not_like", fieldOp("status"), lit("%pen%")), "closed")).toBe(true);
      expect(hiddenFor(cmp("not_like", fieldOp("status"), lit("%pen%")), "opened")).toBe(false);
    });

    it("evaluates ordered comparisons numerically and lexically", () => {
      expect(hiddenFor(cmp("gt", fieldOp("status"), lit(3)), "5", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("gt", fieldOp("status"), lit(5)), "5", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("gte", fieldOp("status"), lit(5)), "5", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("lt", fieldOp("status"), lit(5)), "3", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("lte", fieldOp("status"), lit(3)), "3", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("gt", fieldOp("status"), lit("a")), "b")).toBe(true);
      expect(hiddenFor(cmp("gt", fieldOp("status"), lit("b")), "a")).toBe(false);
      expect(hiddenFor(cmp("gt", fieldOp("status"), lit(3)), "", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("gt", fieldOp("status"), lit({})), "5", { fieldType: "integer" })).toBe(false);
    });

    it("evaluates between/not_between ranges", () => {
      expect(hiddenFor(cmp("between", fieldOp("status"), lit([1, 5])), "3", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("between", fieldOp("status"), lit([1, 5])), "7", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("between", fieldOp("status"), lit([1])), "3", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("between", fieldOp("status"), lit([1, {}])), "3", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("between", fieldOp("status"), lit([1, 5])), "", { fieldType: "integer" })).toBe(false);
      expect(hiddenFor(cmp("not_between", fieldOp("status"), lit([1, 5])), "7", { fieldType: "integer" })).toBe(true);
      expect(hiddenFor(cmp("not_between", fieldOp("status"), lit([1, 5])), "3", { fieldType: "integer" })).toBe(false);
    });

    it("evaluates groups, negation and rejects malformed expressions", () => {
      const t = statusEq("open");
      const f = statusEq("closed");
      expect(hiddenFor({ kind: "group", match: "all", predicates: [t, t] }, "open")).toBe(true);
      expect(hiddenFor({ kind: "group", predicates: [t, f] }, "open")).toBe(false);
      expect(hiddenFor({ kind: "group", match: "any", predicates: [f, t] }, "open")).toBe(true);
      expect(hiddenFor({ kind: "group", match: "any" }, "open")).toBe(false);
      expect(hiddenFor({ kind: "not", predicate: f }, "open")).toBe(true);
      expect(hiddenFor({ kind: "unknown" }, "open")).toBe(false);
      expect(hiddenFor(5, "open")).toBe(false);
      expect(hiddenFor(cmp("unknown_op", fieldOp("status"), lit("open")), "open")).toBe(false);
      expect(hiddenFor(null, "open", { rawAttribute: "not-json{" })).toBe(false);
      expect(hiddenFor(null, "open", { rawAttribute: "null" })).toBe(false);
    });

    it("resolves operands: literals, missing kinds, foreign scopes and system fields", () => {
      expect(hiddenFor(cmp("eq", lit("x"), lit("x")), "anything")).toBe(true);
      expect(hiddenFor(cmp("eq", { kind: "mystery" }, lit("x")), "x")).toBe(false);
      expect(hiddenFor(cmp("eq", "not-an-object", lit("x")), "x")).toBe(false);
      expect(hiddenFor(cmp("eq", { kind: "field", scope: "before", field: "status" }, lit("x")), "x")).toBe(false);
      const context = {
        "data-doctype": "Task",
        "data-scope": "form",
        "data-document-name": "T-1",
        "data-document-status": "draft",
        "data-document-version": "3"
      };
      expect(hiddenFor(cmp("eq", fieldOp("system.name"), lit("T-1")), "", { context })).toBe(true);
      expect(hiddenFor(cmp("eq", fieldOp("system.docstatus"), lit("draft")), "", { context })).toBe(true);
      expect(hiddenFor(cmp("eq", fieldOp("system.version"), lit(3)), "", { context })).toBe(true);
    });

    it("re-evaluates visibility when values change", async () => {
      resetFormsState();
      document.body.innerHTML = "";
      installRuntimeScript({ "data-doctype": "Task", "data-scope": "form" });
      const form = installForm(`
        <label class="field"><input name="status" value="closed" /></label>
        <label class="field"><input name="target" /></label>
      `);
      const target = field(form, "target");
      target.setAttribute("data-cf-frappe-hidden-depends-on", JSON.stringify(statusEq("open")));
      const binding = currentFormBinding() as FormBinding;
      expect(target.hidden).toBe(false);
      await binding.frm.set_value("status", "open");
      expect(target.hidden).toBe(true);
      const status = field(form, "status");
      status.value = "closed";
      status.dispatchEvent(new Event("input"));
      expect(target.hidden).toBe(false);
    });
  });

  describe("namespace extension + boot wiring", () => {
    it("exposes current/on/trigger with and without a bound form", () => {
      installRuntimeScript({ "data-scope": "list" });
      expect(formNamespaceExtension.current()).toBeNull();
      expect(formNamespaceExtension.trigger("refresh")).toBeUndefined();

      document.body.innerHTML = "";
      const { frm } = bindForm();
      expect(formNamespaceExtension.current()).toBe(frm);
      const custom = vi.fn(() => false);
      formNamespaceExtension.on("Task", { custom });
      expect(formNamespaceExtension.trigger("custom")).toBe(false);
      expect(custom).toHaveBeenCalledWith(frm);
    });

    it("registerFormsModule wires the hydrator and cfFrappe.form through boot()", () => {
      installRuntimeScript(DEFAULT_CONTEXT);
      installForm(DEFAULT_FIELDS);
      resetRegistries();
      registerFormsModule();
      boot();
      const namespace = (window as unknown as { cfFrappe: UnknownRecord }).cfFrappe;
      const form = namespace.form as { current(): unknown; on: unknown; trigger: unknown };
      expect(form.current()).not.toBeNull();
      expect(typeof form.on).toBe("function");
      expect(typeof form.trigger).toBe("function");
      expect(formsHydration.name).toBe("form-binding");
      expect(formsNamespaceContribution).toBeTypeOf("function");
      resetRegistries();
    });
  });
});
