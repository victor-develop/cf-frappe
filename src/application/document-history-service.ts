import type {
  Actor,
  DocStatus,
  DocTypeName,
  DocumentData,
  DocumentEventPayload,
  DocumentName,
  DomainEvent,
  TenantId
} from "../core/types";
import { badRequest } from "../core/errors";
import { documentStream } from "../core/streams";
import type { EventStore } from "../ports/event-store";
import type { QueryService } from "./query-service";

const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;

export interface DocumentHistoryServiceOptions {
  readonly events: Pick<EventStore, "readStream">;
  readonly queries: Pick<QueryService, "getDocument">;
}

export interface GetDocumentTimelineOptions {
  readonly tenantId?: TenantId;
  readonly limit?: number;
  readonly beforeSequence?: number;
}

export interface DocumentTimeline {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly limit: number;
  readonly beforeSequence: number;
  readonly nextBeforeSequence?: number;
  readonly entries: readonly DocumentTimelineEntry[];
}

export interface DocumentTimelineEntry {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: string;
  readonly kind: DocumentEventPayload["kind"];
  readonly actorId: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly payload: DocumentEventPayload;
  readonly metadata: DocumentData;
}

export class DocumentHistoryService {
  private readonly events: Pick<EventStore, "readStream">;
  private readonly queries: Pick<QueryService, "getDocument">;

  constructor(options: DocumentHistoryServiceOptions) {
    this.events = options.events;
    this.queries = options.queries;
  }

  async getTimeline(
    actor: Actor,
    doctypeName: string,
    name: string,
    options: GetDocumentTimelineOptions = {}
  ): Promise<DocumentTimeline> {
    const document = await this.queries.getDocument(actor, doctypeName, name, options.tenantId);
    const stream = documentStream(document.tenantId, document.doctype, document.name);
    const limit = normalizeLimit(options.limit);
    const beforeSequence = normalizeBeforeSequence(options.beforeSequence, document.version);
    const events = await this.events.readStream(stream, {
      maxSequence: beforeSequence,
      limit: limit + 1
    });
    const authorizedEvents = events
      .filter((event) => event.sequence <= beforeSequence)
      .sort(bySequence);
    const hasMore = authorizedEvents.length > limit;
    const overflow = hasMore ? authorizedEvents[authorizedEvents.length - limit - 1] : undefined;
    const visibleEvents = hasMore ? authorizedEvents.slice(authorizedEvents.length - limit) : authorizedEvents;
    return {
      tenantId: document.tenantId,
      doctype: document.doctype,
      name: document.name,
      version: document.version,
      docstatus: document.docstatus,
      limit,
      beforeSequence,
      ...(overflow ? { nextBeforeSequence: overflow.sequence } : {}),
      entries: visibleEvents.map(toTimelineEntry)
    };
  }
}

function toTimelineEntry(event: DomainEvent): DocumentTimelineEntry {
  return {
    eventId: event.id,
    sequence: event.sequence,
    type: event.type,
    kind: event.payload.kind,
    actorId: event.actorId,
    occurredAt: event.occurredAt,
    summary: summarize(event.payload),
    payload: event.payload,
    metadata: event.metadata
  };
}

function summarize(payload: DocumentEventPayload): string {
  switch (payload.kind) {
    case "DocumentCreated":
      return "Created document";
    case "DocumentUpdated":
      return updatedSummary(payload.patch);
    case "DocumentDeleted":
      return "Deleted document";
    case "DocumentSubmitted":
      return "Submitted document";
    case "DocumentCancelled":
      return "Cancelled document";
    case "WorkflowTransitioned":
      return workflowSummary(payload);
    case "DomainCommandApplied":
      return `Applied ${payload.command}`;
  }
}

function updatedSummary(patch: DocumentData): string {
  const fields = Object.keys(patch);
  return fields.length > 0 ? `Updated ${fields.join(", ")}` : "Updated document";
}

function workflowSummary(payload: Extract<DocumentEventPayload, { readonly kind: "WorkflowTransitioned" }>): string {
  const fields = Object.keys(payload.patch);
  const fieldList = fields.length > 0 ? fields.join(", ") : "workflow";
  return `${pastTense(payload.action)} ${fieldList} from ${payload.from} to ${payload.to}`;
}

function pastTense(action: string): string {
  if (action.endsWith("e")) {
    return `${capitalize(action)}d`;
  }
  return `${capitalize(action)}ed`;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function bySequence(left: DomainEvent, right: DomainEvent): number {
  return left.sequence - right.sequence;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Timeline limit must be a positive integer");
  }
  return Math.min(limit, MAX_TIMELINE_LIMIT);
}

function normalizeBeforeSequence(beforeSequence: number | undefined, authorizedVersion: number): number {
  if (beforeSequence === undefined) {
    return authorizedVersion;
  }
  if (!Number.isInteger(beforeSequence) || beforeSequence < 1) {
    throw badRequest("Timeline beforeSequence must be a positive integer");
  }
  return Math.min(beforeSequence, authorizedVersion);
}
