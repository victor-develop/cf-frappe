import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../core/types";

export interface ProjectionStore {
  get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null>;
  save(snapshot: DocumentSnapshot): Promise<void>;
  list(query: ListDocumentsQuery): Promise<ListDocumentsResult>;
}
