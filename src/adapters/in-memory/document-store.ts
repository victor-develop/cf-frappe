import { conflict } from "../../core/errors.js";
import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  DomainEvent,
  ListDocumentsQuery,
  ListDocumentsResult,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../../core/types.js";
import type {
  DocumentCommit,
  DocumentCommitBatchEntry,
  DocumentCommitBatchProjection,
  DocumentStore
} from "../../ports/document-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type { EventStore } from "../../ports/event-store.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import { cloneDomainEvent, sequenceEvents } from "../../core/domain-events.js";
import { readInMemoryAuditDocumentEvents, searchInMemoryAuditEvents } from "./audit-events.js";
import { compareListDocuments, matchesListFilterExpression, matchesListFilters } from "./list-filters.js";

export class InMemoryDocumentStore implements DocumentStore, EventStore, ProjectionStore, AuditEventStore {
  private readonly streams = new Map<StreamName, DomainEvent[]>();
  private readonly documents = new Map<string, DocumentSnapshot>();

  async commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit> {
    return this.commitBatch([{ stream, expectedVersion, events }], (saved) => ({ snapshot: project(saved) }));
  }

  async commitBatch(
    entries: readonly DocumentCommitBatchEntry[],
    project: (events: readonly DomainEvent[]) => DocumentCommitBatchProjection
  ): Promise<DocumentCommit> {
    for (const entry of entries) {
      const current = this.streams.get(entry.stream) ?? [];
      if (current.length !== entry.expectedVersion) {
        throw conflict(`Expected stream '${entry.stream}' at version ${entry.expectedVersion}, found ${current.length}`);
      }
    }
    const saved = entries.flatMap((entry) => sequenceEvents(entry.expectedVersion, entry.events));
    const projection = project(saved);
    for (const entry of entries) {
      const current = this.streams.get(entry.stream) ?? [];
      const savedForStream = saved.filter((event) => event.stream === entry.stream);
      this.streams.set(entry.stream, [...current, ...savedForStream.map(cloneDomainEvent)]);
    }
    for (const snapshot of [projection.snapshot, ...(projection.auxiliarySnapshots ?? [])]) {
      await this.save(snapshot);
    }
    return { events: saved, snapshot: projection.snapshot };
  }

  async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    const current = this.streams.get(stream) ?? [];
    if (current.length !== expectedVersion) {
      throw conflict(`Expected stream '${stream}' at version ${expectedVersion}, found ${current.length}`);
    }
    const saved = sequenceEvents(expectedVersion, events);
    this.streams.set(stream, [...current, ...saved.map(cloneDomainEvent)]);
    return saved;
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const payloadKinds = options.payloadKinds === undefined ? undefined : new Set(options.payloadKinds);
    const events = [...(this.streams.get(stream) ?? [])]
      .filter((event) => options.maxSequence === undefined || event.sequence <= options.maxSequence)
      .filter((event) => payloadKinds === undefined || payloadKinds.has(event.payload.kind))
      .sort((left, right) => left.sequence - right.sequence);
    const page = options.limit === undefined ? events : events.slice(Math.max(0, events.length - options.limit));
    return page.map(cloneDomainEvent);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    return searchInMemoryAuditEvents(this.streams.values(), query).map(cloneDomainEvent);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return readInMemoryAuditDocumentEvents(this.streams, query).map(cloneDomainEvent);
  }

  async get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null> {
    return this.documents.get(key(tenantId, doctype, name)) ?? null;
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    this.documents.set(key(snapshot.tenantId, snapshot.doctype, snapshot.name), snapshot);
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const all = [...this.documents.values()]
      .filter((document) => document.tenantId === query.tenantId && document.doctype === query.doctype)
      .filter((document) => matchesListFilters(document, query.filters))
      .filter((document) =>
        query.filterExpression === undefined ? true : matchesListFilterExpression(document, query.filterExpression)
      )
      .sort((left, right) => compareListDocuments(left, right, query.orderBy ?? "updatedAt", query.order ?? "desc"));
    return {
      data: all.slice(offset, offset + limit),
      limit,
      offset,
      total: all.length
    };
  }

  clear(): void {
    this.streams.clear();
    this.documents.clear();
  }
}

function key(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): string {
  return `${tenantId}:${doctype}:${name}`;
}
