import { DurableObject } from "cloudflare:workers";
import type { RealtimeEvent, RealtimeTopic } from "../core/realtime";
import type { RealtimePublisher, RealtimePublishResult } from "../ports/realtime";

export interface RealtimeHubRpc {
  publish(event: RealtimeEvent): Promise<number>;
}

export interface RealtimeHubStub extends RealtimeHubRpc {
  fetch(request: Request): Promise<Response>;
}

export interface RealtimeHubNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): RealtimeHubStub;
}

export interface RealtimeHubEnv {}

export type RealtimeHubClass = new (
  ctx: DurableObjectState,
  env: RealtimeHubEnv
) => {
  fetch(request: Request): Promise<Response>;
  publish(event: RealtimeEvent): Promise<number>;
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>;
  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>;
};

export class DurableObjectRealtimePublisher implements RealtimePublisher {
  private readonly namespace: RealtimeHubNamespace;

  constructor(namespace: RealtimeHubNamespace) {
    this.namespace = namespace;
  }

  async publish(event: RealtimeEvent): Promise<RealtimePublishResult> {
    const delivered = await Promise.all(event.topics.map((topic) => this.publishToTopic(topic, event)));
    return { delivered: delivered.reduce((sum, count) => sum + count, 0) };
  }

  private publishToTopic(topic: RealtimeTopic, event: RealtimeEvent): Promise<number> {
    const id = this.namespace.idFromName(topic);
    return this.namespace.get(id).publish(event);
  }
}

export function createRealtimeHubClass(): RealtimeHubClass {
  return class CloudFrappeRealtimeHub extends DurableObject<RealtimeHubEnv> {
    override async fetch(request: Request): Promise<Response> {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const topic = new URL(request.url).searchParams.get("topic") ?? "";
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.serializeAttachment({ topic, connectedAt: new Date().toISOString() });
      this.ctx.acceptWebSocket(server, [topic]);
      server.send(JSON.stringify({ type: "cf-frappe.realtime.connected", topic }));
      return new Response(null, { status: 101, webSocket: client });
    }

    async publish(event: RealtimeEvent): Promise<number> {
      const message = JSON.stringify({ type: "cf-frappe.realtime.event", event });
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
          delivered += 1;
        } catch {
          socket.close(1011, "Unable to deliver event");
        }
      }
      return delivered;
    }

    override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
      if (typeof message !== "string") {
        return;
      }
      try {
        const parsed = JSON.parse(message) as { readonly type?: unknown };
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Malformed realtime message" }));
      }
    }

    override webSocketClose(ws: WebSocket): void {
      ws.close();
    }
  };
}
