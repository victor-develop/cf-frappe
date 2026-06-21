import { conflict } from "../../core/errors";
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
} from "../../core/types";
import type { DocumentCommit, DocumentStore } from "../../ports/document-store";
import type { ReadStreamOptions } from "../../ports/document-store";
import type { EventStore } from "../../ports/event-store";
import type { ProjectionStore } from "../../ports/projection-store";
import { matchesListFilters } from "./list-filters";

export class InMemoryDocumentStore implements DocumentStore, EventStore, ProjectionStore {
  private readonly streams = new Map<StreamName, DomainEvent[]>();
  private readonly documents = new Map<string, DocumentSnapshot>();

  async commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit> {
    const saved = await this.append(stream, expectedVersion, events);
    const snapshot = project(saved);
    await this.save(snapshot);
    return { events: saved, snapshot };
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
    const saved = events.map((event, index) => ({
      ...event,
      sequence: expectedVersion + index + 1
    }));
    this.streams.set(stream, [...current, ...saved]);
    return saved;
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const payloadKinds = options.payloadKinds === undefined ? undefined : new Set(options.payloadKinds);
    const events = [...(this.streams.get(stream) ?? [])]
      .filter((event) => options.maxSequence === undefined || event.sequence <= options.maxSequence)
      .filter((event) => payloadKinds === undefined || payloadKinds.has(event.payload.kind))
      .sort((left, right) => left.sequence - right.sequence);
    return options.limit === undefined ? events : events.slice(Math.max(0, events.length - options.limit));
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
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
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
