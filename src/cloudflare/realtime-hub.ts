import { DurableObject } from "cloudflare:workers";
import { isJsonValue } from "../core/json.js";
import {
  DOCUMENT_FIELD_EDIT_MESSAGE_TYPE,
  DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE,
  REALTIME_COLLABORATION_MESSAGE_TYPE,
  realtimeEventFromDocumentFieldEdit,
  realtimeEventFromDocumentSharedDraft,
  type RealtimeEvent,
  type RealtimeTopic
} from "../core/realtime.js";
import type { RealtimePublisher, RealtimePublishResult } from "../ports/realtime.js";

export interface RealtimeHubRpc {
  presence(): Promise<RealtimePresenceSnapshot>;
  publish(topic: RealtimeTopic, event: RealtimeEvent): Promise<number>;
  replay(request?: RealtimeReplayRequest): Promise<RealtimeReplaySnapshot>;
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

export interface RealtimeReplayRequest {
  readonly after?: number;
  readonly limit?: number;
}

export interface RealtimeReplayEntry {
  readonly cursor: number;
  readonly event: RealtimeEvent;
}

export interface RealtimeReplaySnapshot {
  readonly topic: RealtimeTopic;
  readonly events: readonly RealtimeReplayEntry[];
  readonly nextCursor: number | null;
}

export interface RealtimeHubOptions {
  readonly replayBatchLimit?: number;
  readonly replayRetentionLimit?: number;
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

interface RealtimeEventRow extends Record<string, SqlStorageValue> {
  readonly sequence: number;
  readonly topic: string;
  readonly event_json: string;
}

interface RealtimeMetaRow extends Record<string, SqlStorageValue> {
  readonly value: string;
}

export type RealtimeHubClass = new (
  ctx: DurableObjectState,
  env: RealtimeHubEnv
) => {
  fetch(request: Request): Promise<Response>;
  presence(): Promise<RealtimePresenceSnapshot>;
  publish(topic: RealtimeTopic, event: RealtimeEvent): Promise<number>;
  replay(request?: RealtimeReplayRequest): Promise<RealtimeReplaySnapshot>;
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
    return this.namespace.get(id).publish(topic, event);
  }
}

const defaultReplayBatchLimit = 100;
const defaultReplayRetentionLimit = 1000;

export function createRealtimeHubClass(options: RealtimeHubOptions = {}): RealtimeHubClass {
  const replayBatchLimit = boundedPositiveInteger(options.replayBatchLimit, defaultReplayBatchLimit);
  const replayRetentionLimit = boundedPositiveInteger(options.replayRetentionLimit, defaultReplayRetentionLimit);
  return class CloudFrappeRealtimeHub extends DurableObject<RealtimeHubEnv> {
    constructor(ctx: DurableObjectState, env: RealtimeHubEnv) {
      super(ctx, env);
      void ctx.blockConcurrencyWhile(async () => {
        migrateRealtimeStorage(ctx.storage.sql);
      });
    }

    override async fetch(request: Request): Promise<Response> {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const url = new URL(request.url);
      const topic = url.searchParams.get("topic") ?? "";
      if (!rememberReplayTopic(this.ctx.storage.sql, topic)) {
        return new Response("Realtime hub topic mismatch", { status: 409 });
      }
      const attachment = socketAttachment(url, topic);
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, [topic]);
      server.send(JSON.stringify({ type: "cf-frappe.realtime.connected", topic }));
      this.sendReplay(server, replayRequestFromUrl(url));
      this.broadcastPresence("join");
      return new Response(null, { status: 101, webSocket: client });
    }

    async presence(): Promise<RealtimePresenceSnapshot> {
      return presenceSnapshot(this.ctx.getWebSockets());
    }

    async replay(request: RealtimeReplayRequest = {}): Promise<RealtimeReplaySnapshot> {
      return replayEvents(this.ctx.storage.sql, request, replayBatchLimit);
    }

    async publish(topic: RealtimeTopic, event: RealtimeEvent): Promise<number> {
      const cursor = storeRealtimeEvent(this.ctx.storage.sql, topic, event, replayRetentionLimit);
      const message = JSON.stringify({ type: "cf-frappe.realtime.event", cursor, event });
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
        const parsed = parseRealtimeClientMessage(message);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed.type === DOCUMENT_FIELD_EDIT_MESSAGE_TYPE || parsed.type === DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE) {
          this.broadcastCollaboration(ws, parsed);
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

    private broadcastCollaboration(origin: WebSocket, parsed: unknown): void {
      const attachment = deserializeSocketAttachment(origin);
      if (!attachment) {
        origin.send(JSON.stringify({ type: "error", message: "Missing realtime identity" }));
        return;
      }
      const occurredAt = new Date().toISOString();
      const eventInput = {
        id: generatedCollaborationEventId(attachment.connectionId, occurredAt),
        topic: attachment.topic,
        connection: attachment,
        message: parsed,
        occurredAt
      };
      const event = realtimeEventFromDocumentFieldEdit(eventInput) ?? realtimeEventFromDocumentSharedDraft(eventInput);
      if (!event) {
        origin.send(JSON.stringify({ type: "error", message: "Invalid collaboration message" }));
        return;
      }
      const message = JSON.stringify({ type: REALTIME_COLLABORATION_MESSAGE_TYPE, event });
      const failedConnectionIds = new Set<string>();
      const failedSockets = new Set<WebSocket>();
      for (const socket of this.ctx.getWebSockets()) {
        if (socket === origin) {
          continue;
        }
        const socketAttachment = deserializeSocketAttachment(socket);
        if (!socketAttachment || socketAttachment.topic !== attachment.topic) {
          continue;
        }
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "Unable to deliver collaboration event");
          failedConnectionIds.add(socketAttachment.connectionId);
          failedSockets.add(socket);
        }
      }
      if (failedConnectionIds.size > 0) {
        this.broadcastPresence("leave", {
          excludingConnectionIds: failedConnectionIds,
          excludingSockets: failedSockets
        });
      }
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

    private sendReplay(socket: WebSocket, request: RealtimeReplayRequest | null): void {
      if (request === null) {
        return;
      }
      socket.send(JSON.stringify({
        type: "cf-frappe.realtime.replay",
        replay: replayEvents(this.ctx.storage.sql, request, replayBatchLimit)
      }));
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

function migrateRealtimeStorage(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS realtime_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS realtime_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_realtime_events_sequence ON realtime_events(sequence);
  `);
}

function storeRealtimeEvent(
  sql: SqlStorage,
  topic: RealtimeTopic,
  event: RealtimeEvent,
  retentionLimit: number
): number {
  if (!rememberReplayTopic(sql, topic)) {
    throw new Error("Realtime hub topic mismatch");
  }
  const row = sql.exec<{ sequence: number }>(
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
  ).one();
  pruneReplayEvents(sql, retentionLimit);
  return row.sequence;
}

function replayEvents(
  sql: SqlStorage,
  request: RealtimeReplayRequest,
  batchLimit: number
): RealtimeReplaySnapshot {
  const after = normalizeReplayCursor(request.after);
  const limit = Math.min(boundedPositiveInteger(request.limit, batchLimit), batchLimit);
  const topic = rememberedReplayTopic(sql);
  if (topic === undefined) {
    return { topic: "", events: [], nextCursor: null };
  }
  const rows = sql.exec<RealtimeEventRow>(
    `
      SELECT sequence, topic, event_json
      FROM realtime_events
      WHERE topic = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `,
    topic,
    after,
    limit
  ).toArray();
  const events = rows.flatMap(replayEntryFromRow);
  return {
    topic: rows[0]?.topic ?? topic ?? "",
    events,
    nextCursor: events.at(-1)?.cursor ?? null
  };
}

function replayEntryFromRow(row: RealtimeEventRow): readonly RealtimeReplayEntry[] {
  try {
    const event: unknown = JSON.parse(row.event_json);
    return isRealtimeEvent(event) ? [{ cursor: row.sequence, event }] : [];
  } catch {
    return [];
  }
}

function parseRealtimeClientMessage(message: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(message);
  if (isRecord(parsed)) {
    return parsed;
  }
  throw new Error("Malformed realtime message");
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string" &&
    typeof value.type === "string" &&
    Array.isArray(value.topics) &&
    value.topics.every((topic) => typeof topic === "string") &&
    typeof value.tenantId === "string" &&
    typeof value.occurredAt === "string" &&
    isJsonValue(value.payload);
}

function pruneReplayEvents(sql: SqlStorage, retentionLimit: number): void {
  sql.exec(
    `
      DELETE FROM realtime_events
      WHERE sequence NOT IN (
        SELECT sequence
        FROM realtime_events
        ORDER BY sequence DESC
        LIMIT ?
      )
    `,
    retentionLimit
  );
}

function rememberReplayTopic(sql: SqlStorage, topic: RealtimeTopic): boolean {
  const rememberedTopic = rememberedReplayTopic(sql);
  if (rememberedTopic !== undefined && rememberedTopic !== topic) {
    return false;
  }
  if (!topic || rememberedTopic === topic) {
    return true;
  }
  sql.exec(
    `
      INSERT INTO realtime_meta (key, value)
      VALUES ('topic', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    topic
  );
  return true;
}

function rememberedReplayTopic(sql: SqlStorage): RealtimeTopic | undefined {
  return sql.exec<RealtimeMetaRow>(
    "SELECT value FROM realtime_meta WHERE key = 'topic' LIMIT 1"
  ).toArray()[0]?.value;
}

function replayRequestFromUrl(url: URL): RealtimeReplayRequest | null {
  const after = optionalIntegerParam(url.searchParams.get("replayAfter"));
  const limit = optionalIntegerParam(url.searchParams.get("replayLimit"));
  if (after === undefined && limit === undefined) {
    return null;
  }
  return {
    ...(after === undefined ? {} : { after }),
    ...(limit === undefined ? {} : { limit })
  };
}

function optionalIntegerParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function normalizeReplayCursor(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? 0 : Math.trunc(value);
}

function boundedPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.trunc(value);
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

function generatedCollaborationEventId(connectionId: string, occurredAt: string): string {
  const randomUuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  return `collaboration:${connectionId}:${randomUuid ? randomUuid.call(globalThis.crypto) : occurredAt}`;
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
