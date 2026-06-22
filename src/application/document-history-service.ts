import type {
  Actor,
  DocStatus,
  DocTypeName,
  DocumentData,
  DocumentEventPayload,
  DocumentName,
  DocumentSnapshot,
  DomainEvent,
  JsonValue,
  TenantId
} from "../core/types";
import {
  foldDocument,
  foldDocumentAssignments,
  foldDocumentFollowers,
  foldDocumentFrom,
  foldDocumentTags
} from "../core/events";
import { badRequest } from "../core/errors";
import { documentStream } from "../core/streams";
import type { EventStore } from "../ports/event-store";
import type { QueryService } from "./query-service";

const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;
const DEFAULT_DIFF_BASELINE_EVENT_LIMIT = 1_000;

export interface DocumentHistoryServiceOptions {
  readonly events: Pick<EventStore, "readStream">;
  readonly queries: Pick<QueryService, "getDocument">;
  readonly maxDiffBaselineEvents?: number;
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

export interface DocumentAssignments {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly assignees: readonly string[];
}

export interface DocumentTags {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly tags: readonly string[];
}

export interface DocumentFollowers {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly followers: readonly string[];
}

export interface DocumentTimelineEntry {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: string;
  readonly kind: DocumentEventPayload["kind"];
  readonly actorId: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly changes: readonly DocumentTimelineChange[];
  readonly payload: DocumentEventPayload;
  readonly metadata: DocumentData;
}

export interface DocumentTimelineChange {
  readonly field: string;
  readonly oldValue?: JsonValue;
  readonly newValue?: JsonValue;
}

export class DocumentHistoryService {
  private readonly events: Pick<EventStore, "readStream">;
  private readonly queries: Pick<QueryService, "getDocument">;
  private readonly maxDiffBaselineEvents: number;

  constructor(options: DocumentHistoryServiceOptions) {
    this.events = options.events;
    this.queries = options.queries;
    this.maxDiffBaselineEvents = normalizeMaxDiffBaselineEvents(options.maxDiffBaselineEvents);
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
    const baseline = await this.baselineBefore(stream, visibleEvents[0]?.sequence);
    return {
      tenantId: document.tenantId,
      doctype: document.doctype,
      name: document.name,
      version: document.version,
      docstatus: document.docstatus,
      limit,
      beforeSequence,
      ...(overflow ? { nextBeforeSequence: overflow.sequence } : {}),
      entries: toTimelineEntries(visibleEvents, baseline)
    };
  }

  async getAssignments(
    actor: Actor,
    doctypeName: string,
    name: string,
    options: Pick<GetDocumentTimelineOptions, "tenantId"> = {}
  ): Promise<DocumentAssignments> {
    const document = await this.queries.getDocument(actor, doctypeName, name, options.tenantId);
    const stream = documentStream(document.tenantId, document.doctype, document.name);
    const events = await this.events.readStream(stream, {
      maxSequence: document.version,
      payloadKinds: ["DocumentAssigned", "DocumentUnassigned"]
    });
    return {
      tenantId: document.tenantId,
      doctype: document.doctype,
      name: document.name,
      version: document.version,
      docstatus: document.docstatus,
      assignees: foldDocumentAssignments(events.filter((event) => event.sequence <= document.version))
    };
  }

  async getTags(
    actor: Actor,
    doctypeName: string,
    name: string,
    options: Pick<GetDocumentTimelineOptions, "tenantId"> = {}
  ): Promise<DocumentTags> {
    const document = await this.queries.getDocument(actor, doctypeName, name, options.tenantId);
    const stream = documentStream(document.tenantId, document.doctype, document.name);
    const events = await this.events.readStream(stream, {
      maxSequence: document.version,
      payloadKinds: ["DocumentTagged", "DocumentUntagged"]
    });
    return {
      tenantId: document.tenantId,
      doctype: document.doctype,
      name: document.name,
      version: document.version,
      docstatus: document.docstatus,
      tags: foldDocumentTags(events.filter((event) => event.sequence <= document.version))
    };
  }

  async getFollowers(
    actor: Actor,
    doctypeName: string,
    name: string,
    options: Pick<GetDocumentTimelineOptions, "tenantId"> = {}
  ): Promise<DocumentFollowers> {
    const document = await this.queries.getDocument(actor, doctypeName, name, options.tenantId);
    const stream = documentStream(document.tenantId, document.doctype, document.name);
    const events = await this.events.readStream(stream, {
      maxSequence: document.version,
      payloadKinds: ["DocumentFollowed", "DocumentUnfollowed"]
    });
    return {
      tenantId: document.tenantId,
      doctype: document.doctype,
      name: document.name,
      version: document.version,
      docstatus: document.docstatus,
      followers: foldDocumentFollowers(events.filter((event) => event.sequence <= document.version))
    };
  }

  private async baselineBefore(stream: string, firstVisibleSequence: number | undefined): Promise<DocumentSnapshot | null> {
    if (firstVisibleSequence === undefined || firstVisibleSequence <= 1) {
      return null;
    }
    const baselineEventCount = firstVisibleSequence - 1;
    if (baselineEventCount > this.maxDiffBaselineEvents) {
      throw badRequest(
        `Timeline diff baseline needs ${baselineEventCount} prior events, exceeding the configured limit of ${this.maxDiffBaselineEvents}`
      );
    }
    const events = await this.events.readStream(stream, { maxSequence: firstVisibleSequence - 1 });
    return foldDocument(events);
  }
}

function toTimelineEntries(
  events: readonly DomainEvent[],
  initialSnapshot: DocumentSnapshot | null
): readonly DocumentTimelineEntry[] {
  let before = initialSnapshot;
  const entries: DocumentTimelineEntry[] = [];
  for (const event of events) {
    const after = foldDocumentFrom(before, [event]);
    entries.push({
      eventId: event.id,
      sequence: event.sequence,
      type: event.type,
      kind: event.payload.kind,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      summary: summarize(event.payload),
      changes: diffEvent(event, before, after),
      payload: event.payload,
      metadata: event.metadata
    });
    before = after;
  }
  return entries;
}

function diffEvent(
  event: DomainEvent,
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null
): readonly DocumentTimelineChange[] {
  switch (event.payload.kind) {
    case "DocumentCreated": {
      const data = event.payload.data;
      return [
        change("docstatus", undefined, event.payload.docstatus),
        ...Object.keys(data)
          .sort()
          .map((field) => change(field, undefined, data[field]))
      ];
    }
    case "DocumentUpdated":
      return diffPatch(event.payload.patch, before, after);
    case "WorkflowTransitioned":
    case "DomainCommandApplied":
      return diffPatch(event.payload.patch, before, after);
    case "DocumentDeleted":
    case "DocumentSubmitted":
    case "DocumentCancelled":
      return diffDocstatus(before, after);
    case "DocumentCommentAdded":
    case "DocumentActivityRecorded":
    case "DocumentAssigned":
    case "DocumentUnassigned":
    case "DocumentTagged":
    case "DocumentUntagged":
    case "DocumentFollowed":
    case "DocumentUnfollowed":
    case "SavedListFilterSaved":
    case "SavedListFilterDeleted":
    case "SavedReportSaved":
    case "SavedReportDeleted":
    case "UserPermissionAllowed":
    case "UserPermissionRevoked":
      return [];
  }
}

function diffPatch(
  patch: DocumentData,
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null
): readonly DocumentTimelineChange[] {
  return Object.keys(patch)
    .sort()
    .map((field) => change(field, before?.data[field], after?.data[field]))
    .filter((item) => !jsonEquals(item.oldValue, item.newValue));
}

function diffDocstatus(
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null
): readonly DocumentTimelineChange[] {
  const item = change("docstatus", before?.docstatus, after?.docstatus);
  return jsonEquals(item.oldValue, item.newValue) ? [] : [item];
}

function change(field: string, oldValue: JsonValue | undefined, newValue: JsonValue | undefined): DocumentTimelineChange {
  return {
    field,
    ...(oldValue !== undefined ? { oldValue } : {}),
    ...(newValue !== undefined ? { newValue } : {})
  };
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
    case "DocumentCommentAdded":
      return `Commented: ${summarizeText(payload.text)}`;
    case "DocumentActivityRecorded":
      return `${capitalize(payload.activityType)}: ${summarizeText(payload.subject)}`;
    case "DocumentAssigned":
      return `Assigned ${payload.assigneeId}`;
    case "DocumentUnassigned":
      return `Unassigned ${payload.assigneeId}`;
    case "DocumentTagged":
      return `Tagged ${payload.tag}`;
    case "DocumentUntagged":
      return `Untagged ${payload.tag}`;
    case "DocumentFollowed":
      return `Followed by ${payload.followerId}`;
    case "DocumentUnfollowed":
      return `Unfollowed by ${payload.followerId}`;
    case "SavedListFilterSaved":
      return `Saved list filter ${payload.label}`;
    case "SavedListFilterDeleted":
      return "Deleted list filter";
    case "SavedReportSaved":
      return `Saved report ${payload.label}`;
    case "SavedReportDeleted":
      return "Deleted report";
    case "UserPermissionAllowed":
      return `Allowed ${payload.userId} to access ${payload.targetDoctype}/${payload.targetName}`;
    case "UserPermissionRevoked":
      return `Revoked ${payload.userId} access to ${payload.targetDoctype}/${payload.targetName}`;
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

function summarizeText(text: string): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
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

function normalizeMaxDiffBaselineEvents(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DIFF_BASELINE_EVENT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw badRequest("Timeline diff baseline event limit must be a non-negative integer");
  }
  return value;
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
