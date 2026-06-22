import { DurableObject } from "cloudflare:workers";
import type { RealtimeEvent, RealtimeTopic } from "../core/realtime";
import type { RealtimePublisher, RealtimePublishResult } from "../ports/realtime";

export interface RealtimeHubRpc {
  presence(): Promise<RealtimePresenceSnapshot>;
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

export interface RealtimePresenceConnection {
  readonly connectionId: string;
  readonly connectedAt: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

export interface RealtimePresenceSnapshot {
  readonly topic: RealtimeTopic;
  readonly connections: readonly RealtimePresenceConnection[];
}

interface RealtimeSocketAttachment extends RealtimePresenceConnection {
  readonly topic: RealtimeTopic;
}

type RealtimeIdentityFields = Readonly<Partial<Pick<RealtimePresenceConnection, "tenantId" | "userId">>>;

interface PresenceBroadcastOptions {
  readonly excludingConnectionIds?: Iterable<string>;
  readonly excludingSockets?: Iterable<WebSocket>;
}

interface PresenceBroadcastFailures {
  readonly connectionIds: Set<string>;
  readonly sockets: Set<WebSocket>;
}

export type RealtimeHubClass = new (
  ctx: DurableObjectState,
  env: RealtimeHubEnv
) => {
  fetch(request: Request): Promise<Response>;
  presence(): Promise<RealtimePresenceSnapshot>;
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
      const url = new URL(request.url);
      const topic = url.searchParams.get("topic") ?? "";
      const attachment = socketAttachment(url, topic);
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, [topic]);
      server.send(JSON.stringify({ type: "cf-frappe.realtime.connected", topic }));
      this.broadcastPresence("join");
      return new Response(null, { status: 101, webSocket: client });
    }

    async presence(): Promise<RealtimePresenceSnapshot> {
      return presenceSnapshot(this.ctx.getWebSockets());
    }

    async publish(event: RealtimeEvent): Promise<number> {
      const message = JSON.stringify({ type: "cf-frappe.realtime.event", event });
      let delivered = 0;
      const failedConnectionIds = new Set<string>();
      const failedSockets = new Set<WebSocket>();
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
          delivered += 1;
        } catch {
          const attachment = deserializeSocketAttachment(socket);
          socket.close(1011, "Unable to deliver event");
          if (attachment) {
            failedConnectionIds.add(attachment.connectionId);
          }
          failedSockets.add(socket);
        }
      }
      if (failedConnectionIds.size > 0) {
        this.broadcastPresence("leave", {
          excludingConnectionIds: failedConnectionIds,
          excludingSockets: failedSockets
        });
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
      const attachment = deserializeSocketAttachment(ws);
      ws.close();
      this.broadcastPresence("leave", {
        excludingConnectionIds: attachment ? [attachment.connectionId] : [],
        excludingSockets: [ws]
      });
    }

    private broadcastPresence(action: "join" | "leave", options: PresenceBroadcastOptions = {}): void {
      const excludingConnectionIds = new Set(options.excludingConnectionIds ?? []);
      const excludingSockets = new Set(options.excludingSockets ?? []);
      const failures = this.sendPresence(action, excludingConnectionIds, excludingSockets);
      if (failures.connectionIds.size === 0 && failures.sockets.size === 0) {
        return;
      }
      for (const connectionId of failures.connectionIds) {
        excludingConnectionIds.add(connectionId);
      }
      for (const socket of failures.sockets) {
        excludingSockets.add(socket);
      }
      this.sendPresence("leave", excludingConnectionIds, excludingSockets);
    }

    private sendPresence(
      action: "join" | "leave",
      excludingConnectionIds: ReadonlySet<string>,
      excludingSockets: ReadonlySet<WebSocket>
    ): PresenceBroadcastFailures {
      const sockets = this.ctx.getWebSockets();
      const snapshot = presenceSnapshot(sockets, excludingConnectionIds);
      const message = JSON.stringify({
        type: "cf-frappe.realtime.presence",
        presence: {
          action,
          ...snapshot
        }
      });
      const failures: PresenceBroadcastFailures = {
        connectionIds: new Set<string>(),
        sockets: new Set<WebSocket>()
      };
      for (const socket of sockets) {
        if (excludingSockets.has(socket)) {
          continue;
        }
        const attachment = deserializeSocketAttachment(socket);
        if (attachment && excludingConnectionIds.has(attachment.connectionId)) {
          continue;
        }
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "Unable to deliver presence");
          failures.sockets.add(socket);
          if (attachment) {
            failures.connectionIds.add(attachment.connectionId);
          }
        }
      }
      return failures;
    }
  };
}

function socketAttachment(url: URL, topic: RealtimeTopic): RealtimeSocketAttachment {
  const connectedAt = new Date().toISOString();
  const tenantId = stringField(url.searchParams.get("tenantId"));
  const userId = stringField(url.searchParams.get("userId"));
  return {
    topic,
    connectionId: generatedConnectionId(connectedAt),
    connectedAt,
    ...identityFields(tenantId, userId)
  };
}

function identityFields(
  tenantId: string | undefined,
  userId: string | undefined
): RealtimeIdentityFields {
  return {
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(userId === undefined ? {} : { userId })
  };
}

function presenceSnapshot(
  sockets: readonly WebSocket[],
  excludingConnectionIds: ReadonlySet<string> = new Set()
): RealtimePresenceSnapshot {
  const connections = sockets
    .map(deserializeSocketAttachment)
    .filter((attachment): attachment is RealtimeSocketAttachment => attachment !== null)
    .filter((attachment) => !excludingConnectionIds.has(attachment.connectionId))
    .sort((left, right) => left.connectedAt.localeCompare(right.connectedAt) || left.connectionId.localeCompare(right.connectionId));
  return {
    topic: connections[0]?.topic ?? "",
    connections: connections.map(({ connectionId, connectedAt, tenantId, userId }) => ({
      connectionId,
      connectedAt,
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(userId === undefined ? {} : { userId })
    }))
  };
}

function deserializeSocketAttachment(socket: WebSocket): RealtimeSocketAttachment | null {
  const attachment = (socket as { deserializeAttachment?: () => unknown }).deserializeAttachment?.();
  if (!isRecord(attachment)) {
    return null;
  }
  const topic = stringField(attachment.topic);
  const connectedAt = stringField(attachment.connectedAt);
  if (!topic || !connectedAt) {
    return null;
  }
  const legacyAttachment = stringField(attachment.connectionId) === undefined;
  const connectionId = stringField(attachment.connectionId) ?? generatedConnectionId(connectedAt);
  const tenantId = stringField(attachment.tenantId);
  const userId = stringField(attachment.userId);
  const hydratedAttachment = {
    topic,
    connectionId,
    connectedAt,
    ...identityFields(tenantId, userId)
  };
  if (legacyAttachment) {
    serializeSocketAttachment(socket, hydratedAttachment);
  }
  return hydratedAttachment;
}

function generatedConnectionId(connectedAt: string): string {
  const randomUuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  return randomUuid ? randomUuid.call(globalThis.crypto) : `connection:${connectedAt}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function serializeSocketAttachment(socket: WebSocket, attachment: RealtimeSocketAttachment): void {
  (socket as { readonly serializeAttachment?: (value: unknown) => void }).serializeAttachment?.(attachment);
}
