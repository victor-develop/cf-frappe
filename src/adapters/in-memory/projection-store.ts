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
import { compareListDocuments, matchesDocumentPredicate } from "./list-filters.js";

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
      .filter((document) => matchesDocumentPredicate(document, query.predicate))
      .sort((left, right) => compareListDocuments(left, right, query.orderBy ?? "updatedAt", query.order ?? "desc"));
    return {
      data: all.slice(offset, offset + limit).map(cloneDocumentSnapshot),
      limit,
      offset,
      // This store has the count for free, but it reports 0 under `skipTotal`
      // anyway: a caller that reads a total it asked not to be computed should
      // break the same way on both adapters rather than only on D1.
      total: query.skipTotal === true ? 0 : all.length
    };
  }

  clear(): void {
    this.documents.clear();
  }
}

function key(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): string {
  return `${tenantId}:${doctype}:${name}`;
}
