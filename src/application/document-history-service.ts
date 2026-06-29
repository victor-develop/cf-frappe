import type {
  Actor,
  DocStatus,
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  TenantId
} from "../core/types.js";
import {
  foldDocument,
  foldDocumentAssignments,
  foldDocumentFollowers,
  foldDocumentTags
} from "../core/events.js";
import { documentStream } from "../core/streams.js";
import type { EventStore } from "../ports/event-store.js";
import {
  documentTimelineEntries,
  documentTimelineBaselineEventCount,
  normalizeDocumentTimelineBaselineLimit,
  normalizeDocumentTimelineBeforeSequence,
  normalizeDocumentTimelineLimit,
  selectDocumentTimelinePage,
  type DocumentTimelineChange,
  type DocumentTimelineEntry
} from "./document-history-policy.js";
import type { QueryService } from "./query-service.js";

export type { DocumentTimelineChange, DocumentTimelineEntry } from "./document-history-policy.js";

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

export class DocumentHistoryService {
  private readonly events: Pick<EventStore, "readStream">;
  private readonly queries: Pick<QueryService, "getDocument">;
  private readonly maxDiffBaselineEvents: number;

  constructor(options: DocumentHistoryServiceOptions) {
    this.events = options.events;
    this.queries = options.queries;
    this.maxDiffBaselineEvents = normalizeDocumentTimelineBaselineLimit(options.maxDiffBaselineEvents);
  }

  async getTimeline(
    actor: Actor,
    doctypeName: string,
    name: string,
    options: GetDocumentTimelineOptions = {}
  ): Promise<DocumentTimeline> {
    const document = await this.queries.getDocument(actor, doctypeName, name, options.tenantId);
    const stream = documentStream(document.tenantId, document.doctype, document.name);
    const limit = normalizeDocumentTimelineLimit(options.limit);
    const beforeSequence = normalizeDocumentTimelineBeforeSequence(options.beforeSequence, document.version);
    const events = await this.events.readStream(stream, {
      maxSequence: beforeSequence,
      limit: limit + 1
    });
    const page = selectDocumentTimelinePage({ events, beforeSequence, limit });
    const baseline = await this.baselineBefore(stream, page.visibleEvents[0]?.sequence);
    return {
      tenantId: document.tenantId,
      doctype: document.doctype,
      name: document.name,
      version: document.version,
      docstatus: document.docstatus,
      limit,
      beforeSequence,
      ...(page.nextBeforeSequence === undefined ? {} : { nextBeforeSequence: page.nextBeforeSequence }),
      entries: documentTimelineEntries(page.visibleEvents, baseline)
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
    const baselineEventCount = documentTimelineBaselineEventCount(firstVisibleSequence, this.maxDiffBaselineEvents);
    if (baselineEventCount === undefined) {
      return null;
    }
    const events = await this.events.readStream(stream, { maxSequence: baselineEventCount });
    return foldDocument(events);
  }
}
