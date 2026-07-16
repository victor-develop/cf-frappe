import type {
  Actor,
  DocStatus,
  DocTypeDefinition,
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  TenantId
} from "../core/types.js";
import { DEFAULT_TENANT_ID } from "../core/types.js";
import { foldDocument, foldDocumentAssignments } from "../core/events.js";
import { documentStream } from "../core/streams.js";
import type { EventStore } from "../ports/event-store.js";
import {
  documentHistoryAssignmentsResult,
  documentHistoryFollowersResult,
  documentHistoryTagsResult,
  documentTimelineEntries,
  documentTimelineBaselineEventCount,
  normalizeDocumentTimelineBaselineLimit,
  normalizeDocumentTimelineBeforeSequence,
  normalizeDocumentTimelineLimit,
  selectDocumentTimelinePage,
  type DocumentAssignments,
  type DocumentFollowers,
  type DocumentTags,
  type DocumentTimelineChange,
  type DocumentTimelineEntry
} from "./document-history-policy.js";
import {
  assignedDocumentMatchesAssignee,
  compareAssignedDocumentSummaries,
  normalizeAssignedDocumentsAssignee,
  normalizeAssignedDocumentsDoctype,
  normalizeAssignedDocumentsLimit,
  type AssignedDocumentSummary,
  type AssignedDocumentsResult
} from "./assigned-documents-policy.js";
import { labelForLinkedDocument } from "./document-query-policy.js";
import type { QueryService } from "./query-service.js";

export type {
  AssignedDocumentSummary,
  AssignedDocumentsResult
} from "./assigned-documents-policy.js";

export type {
  DocumentAssignments,
  DocumentFollowers,
  DocumentTags,
  DocumentTimelineChange,
  DocumentTimelineEntry
} from "./document-history-policy.js";

export interface DocumentHistoryServiceOptions {
  readonly events: Pick<EventStore, "readStream">;
  readonly queries: DocumentHistoryQueries;
  readonly maxDiffBaselineEvents?: number;
}

type DocumentHistoryQueries = Pick<QueryService, "getDocument" | "getEffectiveMeta" | "listDocuments" | "listEffectiveDoctypes">;

export interface GetDocumentTimelineOptions {
  readonly tenantId?: TenantId;
  readonly limit?: number;
  readonly beforeSequence?: number;
}

export interface ListAssignedDocumentsOptions {
  readonly tenantId?: TenantId;
  readonly assignee?: string;
  readonly doctype?: string;
  readonly limit?: number;
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

export class DocumentHistoryService {
  private readonly events: Pick<EventStore, "readStream">;
  private readonly queries: DocumentHistoryQueries;
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
    return documentHistoryAssignmentsResult(document, events);
  }

  async listAssignedDocuments(
    actor: Actor,
    options: ListAssignedDocumentsOptions = {}
  ): Promise<AssignedDocumentsResult> {
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const assignee = normalizeAssignedDocumentsAssignee(options.assignee, actor.id);
    const doctypeFilter = normalizeAssignedDocumentsDoctype(options.doctype);
    const limit = normalizeAssignedDocumentsLimit(options.limit);
    const doctypes = await this.assignedDocumentDoctypes(actor, tenantId, doctypeFilter);
    const data: AssignedDocumentSummary[] = [];
    for (const doctype of doctypes) {
      await this.collectAssignedDocuments(actor, doctype, tenantId, assignee, data);
    }
    const sorted = data.sort(compareAssignedDocumentSummaries);
    return {
      tenantId,
      assignee,
      limit,
      total: sorted.length,
      data: sorted.slice(0, limit),
      filters: {
        ...(doctypeFilter === undefined ? {} : { doctype: doctypeFilter })
      }
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
    return documentHistoryTagsResult(document, events);
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
    return documentHistoryFollowersResult(document, events);
  }

  private async baselineBefore(stream: string, firstVisibleSequence: number | undefined): Promise<DocumentSnapshot | null> {
    const baselineEventCount = documentTimelineBaselineEventCount(firstVisibleSequence, this.maxDiffBaselineEvents);
    if (baselineEventCount === undefined) {
      return null;
    }
    const events = await this.events.readStream(stream, { maxSequence: baselineEventCount });
    return foldDocument(events);
  }

  private async assignedDocumentDoctypes(
    actor: Actor,
    tenantId: TenantId,
    doctypeName: string | undefined
  ): Promise<readonly DocTypeDefinition[]> {
    if (doctypeName !== undefined) {
      return [await this.queries.getEffectiveMeta(actor, doctypeName, tenantId)];
    }
    return this.queries.listEffectiveDoctypes(actor, tenantId);
  }

  private async collectAssignedDocuments(
    actor: Actor,
    doctype: DocTypeDefinition,
    tenantId: TenantId,
    assignee: string,
    results: AssignedDocumentSummary[]
  ): Promise<void> {
    const pageSize = 100;
    for (let offset = 0; ;) {
      const page = await this.queries.listDocuments(actor, doctype.name, {
        tenantId,
        filters: [],
        orderBy: "updatedAt",
        order: "desc",
        limit: pageSize,
        maxLimit: pageSize,
        offset
      });
      for (const document of page.data) {
        if (document.docstatus === "deleted") {
          continue;
        }
        const assignees = await this.currentAssignees(document);
        if (!assignedDocumentMatchesAssignee(assignees, assignee)) {
          continue;
        }
        results.push(assignedDocumentSummary(doctype, document, assignees));
      }
      offset += page.limit;
      if (offset >= page.total) {
        return;
      }
    }
  }

  private async currentAssignees(document: DocumentSnapshot): Promise<readonly string[]> {
    const events = await this.events.readStream(documentStream(document.tenantId, document.doctype, document.name), {
      maxSequence: document.version,
      payloadKinds: ["DocumentAssigned", "DocumentUnassigned"]
    });
    return foldDocumentAssignments(events);
  }
}

function assignedDocumentSummary(
  doctype: DocTypeDefinition,
  document: DocumentSnapshot,
  assignees: readonly string[]
): AssignedDocumentSummary {
  return {
    tenantId: document.tenantId,
    doctype: document.doctype,
    name: document.name,
    label: labelForLinkedDocument(document, doctype),
    route: `/desk/${encodeURIComponent(document.doctype)}/${encodeURIComponent(document.name)}`,
    version: document.version,
    docstatus: document.docstatus,
    updatedAt: document.updatedAt,
    assignees
  };
}
