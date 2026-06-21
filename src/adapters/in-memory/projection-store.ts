import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types";
import type { ProjectionStore } from "../../ports/projection-store";

export class InMemoryProjectionStore implements ProjectionStore {
  private readonly documents = new Map<string, DocumentSnapshot>();

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
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      data: all.slice(offset, offset + limit),
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
