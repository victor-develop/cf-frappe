import { collectNamespaceExtensions, resetRegistries } from "../../src/adapters/desk/client-src/boot";
import {
  collaborationMessageApi,
  realtimeFieldEditMessage,
  realtimeNamespaceExtension,
  realtimePresence,
  realtimePresenceDocument,
  realtimePresenceUrl,
  realtimeRouteFromOptions,
  realtimeSendFieldEdit,
  realtimeSendSharedDraft,
  realtimeSharedDraftMessage,
  realtimeSubscribe,
  realtimeUrl,
  registerRealtimeNamespace,
  type RealtimeSubscription
} from "../../src/adapters/desk/client-src/realtime";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readonly protocols: unknown;
  readonly sent: string[] = [];
  readonly closed: Array<{ code: number | undefined; reason: string | undefined }> = [];
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string | URL, protocols?: unknown) {
    this.url = String(url);
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  emit(type: string, event: unknown): void {
    (this.listeners[type] ?? []).forEach((listener) => listener(event));
  }

  emitMessage(data: unknown): void {
    this.emit("message", { data });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function installRuntimeScript(attributes: Record<string, string>): void {
  const script = document.createElement("script");
  script.setAttribute("data-cf-frappe-runtime", "desk");
  Object.entries(attributes).forEach(([name, value]) => {
    script.setAttribute(name, value);
  });
  document.body.appendChild(script);
}

describe("client-src realtime", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("route + URL builders", () => {
    it("defaults to /api/realtime and switches ws/wss with the page protocol", () => {
      expect(realtimeUrl("document:acme:Task:TASK-1").toString()).toBe(
        "ws://localhost:3000/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1"
      );
    });

    it("appends replay parameters only when provided", () => {
      expect(realtimeUrl("t", { tenantId: "acme", replayAfter: 12, replayLimit: 25 }).toString()).toBe(
        "ws://localhost:3000/api/realtime?topic=t&replayAfter=12&replayLimit=25"
      );
      expect(realtimeUrl("t", { tenantId: "acme", replayAfter: 0 }).toString()).toBe(
        "ws://localhost:3000/api/realtime?topic=t&replayAfter=0"
      );
      expect(realtimeUrl("t", { replayAfter: null, replayLimit: null }).toString()).toBe(
        "ws://localhost:3000/api/realtime?topic=t"
      );
    });

    it("normalizes explicit realtime routes", () => {
      expect(realtimeRouteFromOptions({ realtimeRoute: "/rt" })).toBe("/rt");
      expect(realtimeRouteFromOptions({ realtimeRoute: "rt/" })).toBe("/rt");
      expect(realtimeRouteFromOptions({ realtimeRoute: "/" })).toBe("/");
    });

    it("falls back to the page-context realtime route", () => {
      installRuntimeScript({ "data-realtime-route": "/context-rt" });
      expect(realtimeRouteFromOptions()).toBe("/context-rt");
      expect(realtimeUrl("t").toString()).toBe("ws://localhost:3000/context-rt?topic=t");
    });

    it("builds presence URLs, collapsing the root route", () => {
      expect(realtimePresenceUrl("document:acme:Task:TASK-1")).toBe(
        "/api/realtime/presence?topic=document%3Aacme%3ATask%3ATASK-1"
      );
      expect(realtimePresenceUrl("t", { realtimeRoute: "/rt" })).toBe("/rt/presence?topic=t");
      expect(realtimePresenceUrl("t", { realtimeRoute: "/" })).toBe("/presence?topic=t");
    });
  });

  describe("presence snapshots", () => {
    it("fetches and unwraps presence snapshots", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ data: { topic: "document:acme:Task:TASK-1", connections: [] } }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(realtimePresence("document:acme:Task:TASK-1")).resolves.toEqual({
        topic: "document:acme:Task:TASK-1",
        connections: []
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/realtime/presence?topic=document%3Aacme%3ATask%3ATASK-1",
        expect.anything()
      );
    });

    it("builds the canonical document topic for presence fetches", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }));
      vi.stubGlobal("fetch", fetchMock);
      await realtimePresenceDocument("Task Type", "TASK:1", { tenantId: "acme:west", realtimeRoute: "/rt" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/rt/presence?topic=document%3Aacme%253Awest%3ATask%2520Type%3ATASK%253A1",
        expect.anything()
      );
    });
  });

  describe("subscribe + dispatch", () => {
    it("opens a socket with protocols and exposes the subscription surface", () => {
      const subscription = realtimeSubscribe(
        "document:acme:Task:TASK-1",
        {},
        { tenantId: "acme", protocols: ["cf-frappe.realtime.v1"] }
      );
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      expect(subscription.topic).toBe("document:acme:Task:TASK-1");
      expect(subscription.url).toBe("ws://localhost:3000/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1");
      expect(socket.protocols).toEqual(["cf-frappe.realtime.v1"]);

      expect(subscription.send({ hello: 1 })).toEqual({ hello: 1 });
      expect(subscription.send("plain")).toBe("plain");
      expect(socket.sent).toEqual(['{"hello":1}', "plain"]);

      subscription.close(4000, "done");
      expect(socket.closed).toEqual([{ code: 4000, reason: "done" }]);
    });

    it("falls back to on<type> assignment for sockets without addEventListener", () => {
      class BareSocket {
        onmessage: unknown;
        onopen: unknown;
        onclose: unknown;
        onerror: unknown;
        readonly sent: string[] = [];
        send(data: string): void {
          this.sent.push(data);
        }
        close(): void {}
      }
      vi.stubGlobal("WebSocket", BareSocket);
      const connected = vi.fn();
      const subscription = realtimeSubscribe("t", { connected });
      const socket = subscription.socket as unknown as BareSocket;
      expect(typeof socket.onmessage).toBe("function");
      (socket.onmessage as (event: unknown) => void)({
        data: JSON.stringify({ type: "cf-frappe.realtime.connected" })
      });
      expect(connected).toHaveBeenCalledWith({ type: "cf-frappe.realtime.connected" }, subscription);
    });

    it("forwards socket lifecycle events to the handlers", () => {
      const seen: string[] = [];
      const subscription = realtimeSubscribe("t", {
        open: (_event: unknown, sub: RealtimeSubscription) => seen.push(`open:${sub.topic}`),
        close: () => seen.push("close"),
        error: () => seen.push("error")
      });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emit("open", {});
      socket.emit("close", {});
      socket.emit("error", {});
      expect(seen).toEqual([`open:${subscription.topic}`, "close", "error"]);
    });

    it("dispatches parsed messages, events and redacted notifications", () => {
      const seen: string[] = [];
      realtimeSubscribe("t", {
        message: (parsed: unknown) => seen.push(`message:${JSON.stringify(parsed)}`),
        connected: (message: { topic?: string }) => seen.push(`connected:${String(message.topic)}`),
        event: (event: { id?: string }) => seen.push(`event:${String(event.id)}`),
        notification: (payload: { kind?: string }) => seen.push(`notification:${String(payload.kind)}`)
      });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(JSON.stringify({ type: "cf-frappe.realtime.connected", topic: "t" }));
      socket.emitMessage(
        JSON.stringify({
          type: "cf-frappe.realtime.event",
          event: { id: "e1", payload: { kind: "DocumentUserNotification" } }
        })
      );
      socket.emitMessage(JSON.stringify({ type: "cf-frappe.realtime.event", event: { id: "e2", payload: {} } }));
      socket.emitMessage(JSON.stringify(42));
      socket.emitMessage(JSON.stringify({ type: "unknown" }));
      expect(seen).toEqual([
        'message:{"type":"cf-frappe.realtime.connected","topic":"t"}',
        "connected:t",
        'message:{"type":"cf-frappe.realtime.event","event":{"id":"e1","payload":{"kind":"DocumentUserNotification"}}}',
        "event:e1",
        "notification:DocumentUserNotification",
        'message:{"type":"cf-frappe.realtime.event","event":{"id":"e2","payload":{}}}',
        "event:e2",
        "message:42",
        'message:{"type":"unknown"}'
      ]);
    });

    it("passes non-string frames through without JSON parsing", () => {
      const message = vi.fn();
      realtimeSubscribe("t", { message });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      const frame = { type: "cf-frappe.realtime.connected" };
      socket.emitMessage(frame);
      expect(message).toHaveBeenCalledWith(frame, { data: frame }, expect.anything());
    });

    it("routes malformed frames to the malformed handler", () => {
      const malformed = vi.fn();
      const message = vi.fn();
      realtimeSubscribe("t", { malformed, message });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage("{nope");
      expect(malformed).toHaveBeenCalledTimes(1);
      expect(malformed.mock.calls[0]?.[1]).toBe("{nope");
      expect(message).not.toHaveBeenCalled();
    });

    it("dispatches collaboration field-edit and shared-draft payloads", () => {
      const seen: string[] = [];
      realtimeSubscribe("t", {
        collaboration: (event: { id?: string }) => seen.push(`collaboration:${String(event.id)}`),
        fieldEdit: (payload: { field?: string }) => seen.push(`fieldEdit:${String(payload.field)}`),
        sharedDraft: (payload: { kind?: string }) => seen.push(`sharedDraft:${String(payload.kind)}`)
      });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(
        JSON.stringify({
          type: "cf-frappe.realtime.collaboration",
          event: { id: "c1", payload: { kind: "DocumentFieldEditIntent", field: "title" } }
        })
      );
      socket.emitMessage(
        JSON.stringify({
          type: "cf-frappe.realtime.collaboration",
          event: { id: "c2", payload: { kind: "DocumentSharedDraftPatch" } }
        })
      );
      socket.emitMessage(
        JSON.stringify({ type: "cf-frappe.realtime.collaboration", event: { id: "c3", payload: { kind: "Other" } } })
      );
      expect(seen).toEqual([
        "collaboration:c1",
        "fieldEdit:title",
        "collaboration:c2",
        "sharedDraft:DocumentSharedDraftPatch",
        "collaboration:c3"
      ]);
    });

    it("replays buffered events through the event dispatch pipeline", () => {
      const seen: Array<{ cursor?: unknown; id?: unknown }> = [];
      const replay = vi.fn();
      realtimeSubscribe("t", {
        replay,
        event: (event: { id?: unknown }, message: { cursor?: unknown }) =>
          seen.push({ cursor: message.cursor, id: event.id })
      });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(
        JSON.stringify({
          type: "cf-frappe.realtime.replay",
          replay: {
            events: [{ cursor: 7, event: { id: "e7" } }, { cursor: 8 }, null, { cursor: 9, event: { id: "e9" } }]
          }
        })
      );
      socket.emitMessage(JSON.stringify({ type: "cf-frappe.realtime.replay", replay: { events: "nope" } }));
      expect(replay).toHaveBeenCalledTimes(2);
      expect(seen).toEqual([
        { cursor: 7, id: "e7" },
        { cursor: 9, id: "e9" }
      ]);
    });

    it("forwards presence frames", () => {
      const presence = vi.fn();
      realtimeSubscribe("t", { presence });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      socket.emitMessage(JSON.stringify({ type: "cf-frappe.realtime.presence", presence: { connections: [] } }));
      expect(presence).toHaveBeenCalledWith(
        { connections: [] },
        { type: "cf-frappe.realtime.presence", presence: { connections: [] } },
        expect.anything()
      );
    });

    it("ignores non-function handlers", () => {
      realtimeSubscribe("t", { message: "not-a-function" });
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      expect(() => socket.emitMessage(JSON.stringify({ type: "unknown" }))).not.toThrow();
    });
  });

  describe("collaboration message builders", () => {
    it("builds field-edit messages from objects, primitives and undefined", () => {
      expect(realtimeFieldEditMessage(" title ", { editing: false, value: "x" })).toEqual({
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: false,
        value: "x"
      });
      expect(realtimeFieldEditMessage("title")).toEqual({
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true
      });
      expect(realtimeFieldEditMessage("title", "raw")).toEqual({
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true,
        value: "raw"
      });
      expect(realtimeFieldEditMessage(undefined)).toMatchObject({ field: "" });
    });

    it("builds shared-draft messages with validated baseVersion, patch and unset", () => {
      expect(realtimeSharedDraftMessage({ baseVersion: 3, patch: { a: 1 }, unset: ["b"] })).toEqual({
        type: "cf-frappe.collaboration.shared_draft",
        baseVersion: 3,
        patch: { a: 1 },
        unset: ["b"]
      });
      expect(realtimeSharedDraftMessage({ baseVersion: -1, patch: "nope", unset: "nope" })).toEqual({
        type: "cf-frappe.collaboration.shared_draft"
      });
      expect(realtimeSharedDraftMessage({ baseVersion: 1.5 })).toEqual({
        type: "cf-frappe.collaboration.shared_draft"
      });
      expect(realtimeSharedDraftMessage()).toEqual({ type: "cf-frappe.collaboration.shared_draft" });
    });

    it("sends field edits and shared drafts over a socket and via subscriptions", () => {
      const sent: string[] = [];
      const socket = { send: (data: string) => sent.push(data) };
      realtimeSendFieldEdit(socket, "title", { editing: true });
      realtimeSendSharedDraft(socket, { baseVersion: 2, patch: { a: 1 } });
      expect(sent.map((frame) => JSON.parse(frame))).toEqual([
        { type: "cf-frappe.collaboration.field_edit", field: "title", editing: true },
        { type: "cf-frappe.collaboration.shared_draft", baseVersion: 2, patch: { a: 1 } }
      ]);
    });

    it("collaborationMessageApi delegates to subscriptions and falls back to plain messages", () => {
      const subscription = realtimeSubscribe("t");
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;
      collaborationMessageApi.sendFieldEdit(subscription, "title");
      collaborationMessageApi.sendSharedDraft(subscription, { patch: { a: 1 } });
      expect(socket.sent).toHaveLength(2);

      expect(collaborationMessageApi.sendFieldEdit(null, "title")).toEqual({
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true
      });
      expect(collaborationMessageApi.sendSharedDraft(undefined, { patch: { a: 1 } })).toEqual({
        type: "cf-frappe.collaboration.shared_draft",
        patch: { a: 1 }
      });
      expect(collaborationMessageApi.fieldEditMessage).toBe(realtimeFieldEditMessage);
      expect(collaborationMessageApi.sharedDraftMessage).toBe(realtimeSharedDraftMessage);
    });
  });

  describe("namespace extension", () => {
    it("registers the realtime group at import time", () => {
      expect(collectNamespaceExtensions().realtime).toBeDefined();
    });

    it("re-registers after a registry reset via the exported register function", () => {
      resetRegistries();
      expect(collectNamespaceExtensions().realtime).toBeUndefined();
      registerRealtimeNamespace();
      expect(collectNamespaceExtensions().realtime).toBeDefined();
    });

    it("exposes canonical encoded WebSocket URLs", () => {
      const realtime = realtimeNamespaceExtension();
      expect(realtime.url("document:acme:Task:TASK-1")).toBe(
        "ws://localhost:3000/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1"
      );
      expect(realtime.documentUrl("Task Type", "TASK:1", { tenantId: "acme:west" })).toBe(
        "ws://localhost:3000/api/realtime?topic=document%3Aacme%253Awest%3ATask%2520Type%3ATASK%253A1"
      );
      expect(realtime.doctypeUrl("Task Type", { tenantId: "acme:west" })).toBe(
        "ws://localhost:3000/api/realtime?topic=doctype%3Aacme%253Awest%3ATask%2520Type"
      );
      expect(realtime.tenantUrl({ tenantId: "acme:west" })).toBe(
        "ws://localhost:3000/api/realtime?topic=tenant%3Aacme%253Awest"
      );
      expect(realtime.userUrl("owner@example.com", { tenantId: "acme:west" })).toBe(
        "ws://localhost:3000/api/realtime?topic=user%3Aacme%253Awest%3Aowner%2540example.com"
      );
      expect(realtime.presenceUrl("document:acme:Task:TASK-1", { realtimeRoute: "/rt" })).toBe(
        "/rt/presence?topic=document%3Aacme%3ATask%3ATASK-1"
      );
    });

    it("opens raw sockets for the connect helpers", () => {
      const realtime = realtimeNamespaceExtension();
      realtime.connect("topic-a");
      realtime.doctype("Task", { tenantId: "acme" });
      realtime.document("Task", "TASK-1", { tenantId: "acme" });
      realtime.tenant({ tenantId: "acme" });
      realtime.user("u1", { tenantId: "acme" });
      expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
        "ws://localhost:3000/api/realtime?topic=topic-a",
        "ws://localhost:3000/api/realtime?topic=doctype%3Aacme%3ATask",
        "ws://localhost:3000/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1",
        "ws://localhost:3000/api/realtime?topic=tenant%3Aacme",
        "ws://localhost:3000/api/realtime?topic=user%3Aacme%3Au1"
      ]);
    });

    it("subscribes with canonical topics for every subscribe helper", () => {
      const realtime = realtimeNamespaceExtension();
      const topics = [
        (realtime.subscribe("raw-topic") as RealtimeSubscription).topic,
        (realtime.subscribeDoctype("Task", {}, { tenantId: "acme" }) as RealtimeSubscription).topic,
        (realtime.subscribeDocument("Task", "TASK-1", {}, { tenantId: "acme" }) as RealtimeSubscription).topic,
        (realtime.subscribeTenant({}, { tenantId: "acme" }) as RealtimeSubscription).topic,
        (realtime.subscribeUser("u1", {}, { tenantId: "acme" }) as RealtimeSubscription).topic
      ];
      expect(topics).toEqual([
        "raw-topic",
        "doctype:acme:Task",
        "document:acme:Task:TASK-1",
        "tenant:acme",
        "user:acme:u1"
      ]);
    });

    it("fetches presence snapshots for every presence helper", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ data: {} }));
      vi.stubGlobal("fetch", fetchMock);
      const realtime = realtimeNamespaceExtension();
      await realtime.presence("raw-topic");
      await realtime.presenceDoctype("Task", { tenantId: "acme" });
      await realtime.presenceDocument("Task", "TASK-1", { tenantId: "acme" });
      await realtime.presenceTenant({ tenantId: "acme" });
      await realtime.presenceUser("owner@example.com", { tenantId: "acme" });
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        "/api/realtime/presence?topic=raw-topic",
        "/api/realtime/presence?topic=doctype%3Aacme%3ATask",
        "/api/realtime/presence?topic=document%3Aacme%3ATask%3ATASK-1",
        "/api/realtime/presence?topic=tenant%3Aacme",
        "/api/realtime/presence?topic=user%3Aacme%3Aowner%2540example.com"
      ]);
    });
  });
});
