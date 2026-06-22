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
          async publish(_topic, event) {
            published.push(event);
            return 2;
          },
          async replay() {
            return { topic: "tenant:acme", events: [], nextCursor: null };
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

    await expect(hub.publish("tenant:acme", realtimeEvent(["tenant:acme"]))).resolves.toBe(2);

    expect(sent.map((item) => JSON.parse(item) as { type: string; cursor?: number })).toMatchObject([
      { type: "cf-frappe.realtime.event", cursor: 1 },
      { type: "cf-frappe.realtime.event", cursor: 1 }
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

  it("persists a bounded replay log by topic cursor", async () => {
    const Hub = createRealtimeHubClass({ replayRetentionLimit: 2, replayBatchLimit: 10 });
    const hub = new Hub(fakeState([]), {});
    const topic = "document:acme:Note:NOTE-1";
    const first = realtimeEvent([topic], "evt1");
    const second = realtimeEvent([topic], "evt2");
    const third = realtimeEvent([topic], "evt3");

    await hub.publish(topic, first);
    await hub.publish(topic, second);
    await hub.publish(topic, third);

    await expect(hub.replay()).resolves.toEqual({
      topic,
      events: [
        { cursor: 2, event: second },
        { cursor: 3, event: third }
      ],
      nextCursor: 3
    });
    await expect(hub.replay({ after: 2, limit: 1 })).resolves.toEqual({
      topic,
      events: [{ cursor: 3, event: third }],
      nextCursor: 3
    });
  });

  it("caps requested replay batches at the hub limit", async () => {
    const Hub = createRealtimeHubClass({ replayBatchLimit: 1 });
    const hub = new Hub(fakeState([]), {});
    const topic = "document:acme:Note:NOTE-1";
    const first = realtimeEvent([topic], "evt1");
    const second = realtimeEvent([topic], "evt2");

    await hub.publish(topic, first);
    await hub.publish(topic, second);

    await expect(hub.replay({ limit: 99 })).resolves.toEqual({
      topic,
      events: [{ cursor: 1, event: first }],
      nextCursor: 1
    });
  });

  it("rejects topic mismatches before persistence, fan-out, or socket acceptance", async () => {
    const sent: string[] = [];
    const sockets = [fakeSocket(sent)];
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState(sockets), {});
    const topic = "document:acme:Note:NOTE-1";
    const first = realtimeEvent([topic], "evt1");
    const mismatchedTopic = "document:acme:Note:NOTE-2";

    await hub.publish(topic, first);

    await expect(hub.publish(mismatchedTopic, realtimeEvent([mismatchedTopic], "evt2"))).rejects.toThrow(
      "Realtime hub topic mismatch"
    );
    expect(sent).toHaveLength(1);
    await expect(hub.replay()).resolves.toEqual({
      topic,
      events: [{ cursor: 1, event: first }],
      nextCursor: 1
    });

    const response = await hub.fetch(new Request(
      "https://app.example/api/realtime?topic=document%3Aacme%3ANote%3ANOTE-2",
      { headers: { upgrade: "websocket" } }
    ));

    expect(response.status).toBe(409);
    expect(sockets).toHaveLength(1);
  });

  it("filters replay rows to the remembered hub topic", async () => {
    const sql = fakeRealtimeSqlStorage();
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([], sql), {});
    const topic = "document:acme:Note:NOTE-1";
    const first = realtimeEvent([topic], "evt1");
    const mismatchedTopic = "document:acme:Note:NOTE-2";
    const mismatched = realtimeEvent([mismatchedTopic], "evt2");

    await hub.publish(topic, first);
    sql.exec(
      `
        INSERT INTO realtime_events (topic, event_id, event_type, occurred_at, event_json)
        VALUES (?, ?, ?, ?, ?)
        RETURNING sequence
      `,
      mismatchedTopic,
      mismatched.id,
      mismatched.type,
      mismatched.occurredAt,
      JSON.stringify(mismatched)
    );

    await expect(hub.replay()).resolves.toEqual({
      topic,
      events: [{ cursor: 1, event: first }],
      nextCursor: 1
    });
  });

  it("does not replay rows before a hub topic is remembered", async () => {
    const sql = fakeRealtimeSqlStorage();
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState([], sql), {});
    const topic = "document:acme:Note:NOTE-1";
    const event = realtimeEvent([topic], "evt1");

    sql.exec(
      `
        INSERT INTO realtime_events (topic, event_id, event_type, occurred_at, event_json)
        VALUES (?, ?, ?, ?, ?)
        RETURNING sequence
      `,
      topic,
      event.id,
      event.type,
      event.occurredAt,
      JSON.stringify(event)
    );

    await expect(hub.replay()).resolves.toEqual({
      topic: "",
      events: [],
      nextCursor: null
    });
  });

  it("sends requested replay batches during websocket connection", async () => {
    const accepted: WebSocket[] = [];
    const sent: string[] = [];
    const Hub = createRealtimeHubClass();
    const hub = new Hub(fakeState(accepted), {});
    const topic = "document:acme:Note:NOTE-1";
    const event = realtimeEvent([topic], "evt1");
    await hub.publish(topic, event);
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

    const response = await hub.fetch(new Request(
      "https://app.example/api/realtime?topic=document%3Aacme%3ANote%3ANOTE-1&tenantId=acme&userId=owner%40example.com&replayAfter=0&replayLimit=5",
      { headers: { upgrade: "websocket" } }
    ));

    expect(response.status).toBe(101);
    expect(sent.map((message) => (JSON.parse(message) as { readonly type?: string }).type)).toEqual([
      "cf-frappe.realtime.connected",
      "cf-frappe.realtime.replay",
      "cf-frappe.realtime.presence"
    ]);
    expect(JSON.parse(sent[1]!) as unknown).toEqual({
      type: "cf-frappe.realtime.replay",
      replay: {
        topic,
        events: [{ cursor: 1, event }],
        nextCursor: 1
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

    await expect(hub.publish(
      "document:acme:Note:NOTE-1",
      realtimeEvent(["document:acme:Note:NOTE-1"])
    )).resolves.toBe(1);

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

function realtimeEvent(topics: readonly string[], id = "evt1"): RealtimeEvent {
  return {
    id,
    type: "NoteCreated",
    topics,
    tenantId: "acme",
    occurredAt: now,
    payload: { ok: true }
  };
}

function fakeState(sockets: WebSocket[], sql = fakeRealtimeSqlStorage()): DurableObjectState {
  return {
    getWebSockets() {
      return sockets;
    },
    acceptWebSocket(socket: WebSocket) {
      sockets.push(socket);
    },
    blockConcurrencyWhile(callback: () => Promise<unknown>) {
      return callback();
    },
    storage: {
      sql
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

interface FakeRealtimeEventRow {
  readonly sequence: number;
  readonly topic: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly event_json: string;
}

function fakeRealtimeSqlStorage(): SqlStorage {
  const events: FakeRealtimeEventRow[] = [];
  const meta = new Map<string, string>();
  let sequence = 0;
  return {
    exec(query: string, ...bindings: unknown[]) {
      const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized.startsWith("create table") || normalized.startsWith("create index")) {
        return fakeCursor([]);
      }
      if (normalized.startsWith("insert into realtime_meta")) {
        meta.set("topic", String(bindings[0] ?? ""));
        return fakeCursor([]);
      }
      if (normalized.startsWith("select value from realtime_meta")) {
        const topic = meta.get("topic");
        return fakeCursor(topic === undefined ? [] : [{ value: topic }]);
      }
      if (normalized.startsWith("insert into realtime_events")) {
        const row = {
          sequence: ++sequence,
          topic: String(bindings[0] ?? ""),
          event_id: String(bindings[1] ?? ""),
          event_type: String(bindings[2] ?? ""),
          occurred_at: String(bindings[3] ?? ""),
          event_json: String(bindings[4] ?? "")
        };
        events.push(row);
        return fakeCursor([{ sequence: row.sequence }]);
      }
      if (normalized.startsWith("delete from realtime_events")) {
        const limit = Number(bindings[0] ?? 0);
        const retained = events.slice(Math.max(0, events.length - limit));
        events.splice(0, events.length, ...retained);
        return fakeCursor([]);
      }
      if (normalized.startsWith("select sequence, topic, event_json from realtime_events")) {
        const topicScoped = normalized.includes("where topic = ? and sequence > ?");
        const topic = topicScoped ? String(bindings[0] ?? "") : undefined;
        const after = Number(bindings[topicScoped ? 1 : 0] ?? 0);
        const limit = Number(bindings[topicScoped ? 2 : 1] ?? events.length);
        return fakeCursor(events
          .filter((row) => topic === undefined || row.topic === topic)
          .filter((row) => row.sequence > after)
          .slice(0, limit)
          .map((row) => ({
            sequence: row.sequence,
            topic: row.topic,
            event_json: row.event_json
          })));
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
    get databaseSize() {
      return events.length;
    }
  } as unknown as SqlStorage;
}

function fakeCursor<T extends Record<string, unknown>>(rows: T[]) {
  return {
    toArray() {
      return rows;
    },
    one() {
      if (rows.length !== 1) {
        throw new Error(`Expected one row, received ${rows.length}`);
      }
      return rows[0]!;
    },
    [Symbol.iterator]() {
      return rows[Symbol.iterator]();
    }
  };
}
