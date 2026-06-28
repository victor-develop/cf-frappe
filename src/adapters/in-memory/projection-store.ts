import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import { compareListDocuments, matchesListFilterExpression, matchesListFilters } from "./list-filters.js";

export class InMemoryProjectionStore implements ProjectionStore {
  private readonly documents = new Map<string, DocumentSnapshot>();

  async get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null> {
    const snapshot = this.documents.get(key(tenantId, doctype, name));
    return snapshot ? cloneDocumentSnapshot(snapshot) : null;
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    this.documents.set(key(snapshot.tenantId, snapshot.doctype, snapshot.name), cloneDocumentSnapshot(snapshot));
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
      data: all.slice(offset, offset + limit).map(cloneDocumentSnapshot),
      limit,
      offset,
      total: all.length
    };
  }

  clear(): void {
    this.documents.clear();
  }
}

function key(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): string {
  return `${tenantId}:${doctype}:${name}`;
}
