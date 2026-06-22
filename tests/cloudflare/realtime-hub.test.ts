import {
  createRealtimeHubClass,
  DurableObjectRealtimePublisher,
  type RealtimeEvent,
  type RealtimeHubNamespace
} from "../../src";
import { now } from "../helpers";

describe("DurableObjectRealtimePublisher", () => {
  it("routes events to one Durable Object per topic and sums deliveries", async () => {
    const names: string[] = [];
    const published: RealtimeEvent[] = [];
    const publisher = new DurableObjectRealtimePublisher({
      idFromName(name) {
        names.push(name);
        return name as unknown as DurableObjectId;
      },
      get() {
        return {
          async fetch() {
            return new Response(null, { status: 101 });
          },
          async presence() {
            return { topic: "tenant:acme", connections: [] };
          },
          async publish(event) {
            published.push(event);
            return 2;
          }
        };
      }
    } satisfies RealtimeHubNamespace);
    const event = realtimeEvent(["tenant:acme", "doctype:acme:Note"]);

    await expect(publisher.publish(event)).resolves.toEqual({ delivered: 4 });
    expect(names).toEqual(["tenant:acme", "doctype:acme:Note"]);
    expect(published).toEqual([event, event]);
  });
});

describe("RealtimeHub Durable Object", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("broadcasts realtime events to active sockets", async () => {
    const sent: string[] = [];
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([fakeSocket(sent), fakeSocket(sent)]), {});

    await expect(hub.publish(realtimeEvent(["tenant:acme"]))).resolves.toBe(2);

    expect(sent.map((item) => (JSON.parse(item) as { type: string }).type)).toEqual([
      "cf-frappe.realtime.event",
      "cf-frappe.realtime.event"
    ]);
  });

  it("responds to ping messages without touching storage", async () => {
    const sent: string[] = [];
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([]), {});
    const socket = fakeSocket(sent);

    await hub.webSocketMessage(socket, JSON.stringify({ type: "ping" }));

    expect(sent).toEqual([JSON.stringify({ type: "pong" })]);
  });

  it("accepts websocket connections with server-owned presence identity", async () => {
    const accepted: WebSocket[] = [];
    const sent: string[] = [];
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState(accepted), {});
    const request = new Request(
      "https://app.example/api/realtime?topic=document%3Aacme%3ANote%3ANOTE-1&tenantId=acme&userId=owner%40example.com&connectionId=client-conn",
      { headers: { upgrade: "websocket" } }
    );
    vi.stubGlobal("crypto", { randomUUID: () => "server-conn" });
    vi.stubGlobal("Response", class FakeWebSocketResponse {
      readonly status: number;

      constructor(
        _body: BodyInit | null,
        init?: ResponseInit & { readonly webSocket?: WebSocket }
      ) {
        this.status = init?.status ?? 200;
      }
    });
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {
      return [fakeSocket([]), fakeSocket(sent)];
    });

    const response = await hub.fetch(request);

    expect(response.status).toBe(101);
    expect(accepted).toHaveLength(1);
    expect(fakeAttachment(accepted[0]!)).toMatchObject({
      topic: "document:acme:Note:NOTE-1",
      connectionId: "server-conn",
      tenantId: "acme",
      userId: "owner@example.com"
    });
    expect(sent.map((message) => (JSON.parse(message) as { readonly type?: string }).type)).toEqual([
      "cf-frappe.realtime.connected",
      "cf-frappe.realtime.presence"
    ]);
    expect(JSON.parse(sent[1]!) as unknown).toMatchObject({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "join",
        topic: "document:acme:Note:NOTE-1",
        connections: [
          {
            connectionId: "server-conn",
            tenantId: "acme",
            userId: "owner@example.com"
          }
        ]
      }
    });
  });

  it("reports topic presence from websocket attachments", async () => {
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([
      fakeSocket([], {
        topic: "document:acme:Note:NOTE-1",
        connectionId: "conn-2",
        connectedAt: "2026-06-23T00:00:02.000Z",
        tenantId: "acme",
        userId: "two@example.com"
      }),
      fakeSocket([], {
        topic: "document:acme:Note:NOTE-1",
        connectionId: "conn-1",
        connectedAt: "2026-06-23T00:00:01.000Z",
        tenantId: "acme",
        userId: "one@example.com"
      })
    ]), {});

    await expect(hub.presence()).resolves.toEqual({
      topic: "document:acme:Note:NOTE-1",
      connections: [
        {
          connectionId: "conn-1",
          connectedAt: "2026-06-23T00:00:01.000Z",
          tenantId: "acme",
          userId: "one@example.com"
        },
        {
          connectionId: "conn-2",
          connectedAt: "2026-06-23T00:00:02.000Z",
          tenantId: "acme",
          userId: "two@example.com"
        }
      ]
    });
  });

  it("hydrates legacy websocket attachments into presence snapshots", async () => {
    const socket = fakeSocket([], {
      topic: "document:acme:Note:NOTE-1",
      connectedAt: "2026-06-23T00:00:01.000Z"
    });
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([socket]), {});
    vi.stubGlobal("crypto", { randomUUID: () => "legacy-conn" });

    await expect(hub.presence()).resolves.toEqual({
      topic: "document:acme:Note:NOTE-1",
      connections: [
        {
          connectionId: "legacy-conn",
          connectedAt: "2026-06-23T00:00:01.000Z"
        }
      ]
    });
    expect(fakeAttachment(socket)).toEqual({
      topic: "document:acme:Note:NOTE-1",
      connectionId: "legacy-conn",
      connectedAt: "2026-06-23T00:00:01.000Z"
    });
  });

  it("broadcasts presence leaves without echoing to the closing socket", async () => {
    const leavingSent: string[] = [];
    const remainingSent: string[] = [];
    const leaving = fakeSocket(leavingSent, {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-1",
      connectedAt: "2026-06-23T00:00:01.000Z",
      tenantId: "acme",
      userId: "one@example.com"
    });
    const remaining = fakeSocket(remainingSent, {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-2",
      connectedAt: "2026-06-23T00:00:02.000Z",
      tenantId: "acme",
      userId: "two@example.com"
    });
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([leaving, remaining]), {});

    await hub.webSocketClose(leaving, 1000, "done", true);

    expect(leavingSent).toEqual([]);
    expect(remainingSent).toHaveLength(1);
    expect(JSON.parse(remainingSent[0]!) as unknown).toEqual({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "leave",
        topic: "document:acme:Note:NOTE-1",
        connections: [
          {
            connectionId: "conn-2",
            connectedAt: "2026-06-23T00:00:02.000Z",
            tenantId: "acme",
            userId: "two@example.com"
          }
        ]
      }
    });
  });

  it("rebroadcasts corrected presence when presence delivery closes a socket", async () => {
    const healthySent: string[] = [];
    const leaving = fakeSocket([], {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-1",
      connectedAt: "2026-06-23T00:00:01.000Z",
      tenantId: "acme",
      userId: "leaving@example.com"
    });
    const healthy = fakeSocket(healthySent, {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-2",
      connectedAt: "2026-06-23T00:00:02.000Z",
      tenantId: "acme",
      userId: "healthy@example.com"
    });
    const failing = fakeSocket([], {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-3",
      connectedAt: "2026-06-23T00:00:03.000Z",
      tenantId: "acme",
      userId: "failing@example.com"
    }, { throwOnSend: true });
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([healthy, failing, leaving]), {});

    await hub.webSocketClose(leaving, 1000, "done", true);

    expect(healthySent).toHaveLength(2);
    expect(JSON.parse(healthySent[0]!) as unknown).toMatchObject({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "leave",
        connections: [
          { connectionId: "conn-2" },
          { connectionId: "conn-3" }
        ]
      }
    });
    expect(JSON.parse(healthySent[1]!) as unknown).toMatchObject({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "leave",
        connections: [
          { connectionId: "conn-2" }
        ]
      }
    });
  });

  it("broadcasts corrected presence when event delivery closes a socket", async () => {
    const healthySent: string[] = [];
    const healthy = fakeSocket(healthySent, {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-1",
      connectedAt: "2026-06-23T00:00:01.000Z",
      tenantId: "acme",
      userId: "healthy@example.com"
    });
    const failing = fakeSocket([], {
      topic: "document:acme:Note:NOTE-1",
      connectionId: "conn-2",
      connectedAt: "2026-06-23T00:00:02.000Z",
      tenantId: "acme",
      userId: "failing@example.com"
    }, { throwOnSend: true });
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([healthy, failing]), {});

    await expect(hub.publish(realtimeEvent(["document:acme:Note:NOTE-1"]))).resolves.toBe(1);

    expect(healthySent.map((message) => (JSON.parse(message) as { readonly type?: string }).type)).toEqual([
      "cf-frappe.realtime.event",
      "cf-frappe.realtime.presence"
    ]);
    expect(JSON.parse(healthySent[1]!) as unknown).toMatchObject({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "leave",
        connections: [
          { connectionId: "conn-1" }
        ]
      }
    });
  });
});

function realtimeEvent(topics: readonly string[]): RealtimeEvent {
  return {
    id: "evt1",
    type: "NoteCreated",
    topics,
    tenantId: "acme",
    occurredAt: now,
    payload: { ok: true }
  };
}

function fakeState(sockets: WebSocket[]): DurableObjectState {
  return {
    getWebSockets() {
      return sockets;
    },
    acceptWebSocket(socket: WebSocket) {
      sockets.push(socket);
    },
    blockConcurrencyWhile(callback: () => Promise<unknown>) {
      return callback();
    }
  } as unknown as DurableObjectState;
}

function fakeSocket(
  sent: string[],
  attachment?: unknown,
  options: { readonly throwOnSend?: boolean } = {}
): WebSocket {
  let serializedAttachment = attachment;
  return {
    serializeAttachment(value: unknown) {
      serializedAttachment = value;
    },
    deserializeAttachment() {
      return serializedAttachment;
    },
    send(message: string) {
      if (options.throwOnSend) {
        throw new Error("Unable to send");
      }
      sent.push(message);
    },
    close() {}
  } as unknown as WebSocket;
}

function fakeAttachment(socket: WebSocket): unknown {
  return (socket as { readonly deserializeAttachment: () => unknown }).deserializeAttachment();
}
