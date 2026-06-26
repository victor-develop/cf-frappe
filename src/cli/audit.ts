import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type AuditRemoteAction = "deleted" | "events";

export type AuditHeaderOption = RemoteHeaderOption;

export interface AuditRemoteCommand {
  readonly kind: "audit";
  readonly action: AuditRemoteAction;
  readonly url: string;
  readonly headers: readonly AuditHeaderOption[];
  readonly tenant?: string;
  readonly doctype?: string;
  readonly name?: string;
  readonly actorId?: string;
  readonly eventKind?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

export type AuditRemoteIo = RemoteAdminIo;

export class AuditRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditRemoteError";
  }
}

interface AuditEventResponse {
  readonly tenantId?: string;
  readonly limit?: number;
  readonly filters?: Record<string, unknown>;
  readonly events?: readonly AuditEvent[];
}

interface DeletedDocumentAuditResponse {
  readonly tenantId?: string;
  readonly doctype?: string;
  readonly name?: string;
  readonly snapshot?: {
    readonly version?: number;
    readonly docstatus?: string;
    readonly data?: Record<string, unknown>;
  };
  readonly deletedAt?: string;
  readonly deletedBy?: string;
  readonly deleteEventId?: string;
  readonly events?: readonly AuditEvent[];
}

interface AuditEvent {
  readonly id?: string;
  readonly sequence?: number;
  readonly doctype?: string;
  readonly documentName?: string;
  readonly actorId?: string;
  readonly occurredAt?: string;
  readonly payload?: Record<string, unknown> & {
    readonly kind?: string;
  };
  readonly metadata?: Record<string, unknown>;
}

export async function runRemoteAuditCommand(command: AuditRemoteCommand, io: AuditRemoteIo = {}): Promise<string> {
  if (command.action === "events") {
    const query = auditEventQuery(command);
    const data = await requestRemoteAuditEvents(command, io, {
      method: "GET",
      path: "/api/audit/events",
      ...(query === undefined ? {} : { query })
    });
    return formatAuditEvents(command.url, data);
  }
  const query = tenantQuery(command);
  const data = await requestRemoteDeletedAudit(command, io, {
    method: "GET",
    path: `/api/audit/deleted/${encodeURIComponent(requiredDoctype(command))}/${encodeURIComponent(requiredName(command))}`,
    ...(query === undefined ? {} : { query })
  });
  return formatDeletedAudit(command.url, data);
}

function requestRemoteAuditEvents(
  command: AuditRemoteCommand,
  io: AuditRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<AuditEventResponse> {
  return requestRemoteAdmin<AuditEventResponse, AuditRemoteError>(command, io, request, {
    error: AuditRemoteError,
    fetchLabel: "remote audit commands",
    resourceLabel: "Remote audit",
    urlLabel: "Remote audit"
  });
}

function requestRemoteDeletedAudit(
  command: AuditRemoteCommand,
  io: AuditRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<DeletedDocumentAuditResponse> {
  return requestRemoteAdmin<DeletedDocumentAuditResponse, AuditRemoteError>(command, io, request, {
    error: AuditRemoteError,
    fetchLabel: "remote audit commands",
    resourceLabel: "Remote deleted audit",
    urlLabel: "Remote audit"
  });
}

function auditEventQuery(command: AuditRemoteCommand): URLSearchParams | undefined {
  const params = new URLSearchParams();
  setQueryParam(params, "tenant", command.tenant);
  setQueryParam(params, "doctype", command.doctype);
  setQueryParam(params, "name", command.name);
  setQueryParam(params, "actor_id", command.actorId);
  setQueryParam(params, "kind", command.eventKind);
  setQueryParam(params, "since", command.since);
  setQueryParam(params, "until", command.until);
  if (command.limit !== undefined) {
    params.set("limit", String(command.limit));
  }
  return params.size === 0 ? undefined : params;
}

function tenantQuery(command: AuditRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function setQueryParam(params: URLSearchParams, name: string, value: string | undefined): void {
  if (value !== undefined) {
    params.set(name, value);
  }
}

function formatAuditEvents(baseUrl: string, state: AuditEventResponse): string {
  const events = state.events ?? [];
  return [
    `Audit events at ${baseUrl}`,
    `Tenant: ${state.tenantId ?? "(unknown)"} Limit: ${String(state.limit ?? events.length)} Total: ${String(events.length)}`,
    ...filterLines(state.filters ?? {}),
    ...eventLines(events),
    ""
  ].join("\n");
}

function formatDeletedAudit(baseUrl: string, state: DeletedDocumentAuditResponse): string {
  const events = state.events ?? [];
  const snapshot = state.snapshot;
  return [
    `Deleted document audit at ${baseUrl}`,
    `Document: ${state.doctype ?? "(unknown)"}/${state.name ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"}`,
    `Deleted: ${state.deletedAt ?? "(unknown)"} by ${state.deletedBy ?? "(unknown)"} event ${state.deleteEventId ?? "(unknown)"}`,
    `Snapshot: version ${String(snapshot?.version ?? 0)} status ${snapshot?.docstatus ?? "(unknown)"}`,
    `Snapshot data: ${formatJson(snapshot?.data ?? {})}`,
    `Events: ${String(events.length)}`,
    ...eventLines(events),
    ""
  ].join("\n");
}

function filterLines(filters: Record<string, unknown>): readonly string[] {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return [];
  }
  return [`Filters: ${entries.map(([name, value]) => `${name}=${String(value)}`).join(" ")}`];
}

function eventLines(events: readonly AuditEvent[]): readonly string[] {
  if (events.length === 0) {
    return ["- (none)"];
  }
  return events.flatMap(eventLinesForEvent);
}

function eventLinesForEvent(event: AuditEvent): readonly string[] {
  const sequence = event.sequence === undefined ? "?" : String(event.sequence);
  const kind = event.payload?.kind ?? "(unknown)";
  const document = `${event.doctype ?? "(unknown)"}/${event.documentName ?? "(unknown)"}`;
  return [
    `- #${sequence} ${event.id ?? "(unknown)"} ${kind} ${document} by ${event.actorId ?? "(unknown)"} at ${event.occurredAt ?? "(unknown)"}`,
    `  payload: ${formatJson(event.payload ?? {})}`,
    ...metadataLine(event.metadata)
  ];
}

function metadataLine(metadata: Record<string, unknown> | undefined): readonly string[] {
  if (metadata === undefined || Object.keys(metadata).length === 0) {
    return [];
  }
  return [`  metadata: ${formatJson(metadata)}`];
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function requiredDoctype(command: AuditRemoteCommand): string {
  if (command.doctype === undefined) {
    throw new AuditRemoteError("Audit deleted requires --doctype");
  }
  return command.doctype;
}

function requiredName(command: AuditRemoteCommand): string {
  if (command.name === undefined) {
    throw new AuditRemoteError("Audit deleted requires --name");
  }
  return command.name;
}
