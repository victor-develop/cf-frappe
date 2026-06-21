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
    acceptWebSocket() {},
    blockConcurrencyWhile(callback: () => Promise<unknown>) {
      return callback();
    }
  } as unknown as DurableObjectState;
}

function fakeSocket(sent: string[]): WebSocket {
  return {
    send(message: string) {
      sent.push(message);
    },
    close() {}
  } as unknown as WebSocket;
}
