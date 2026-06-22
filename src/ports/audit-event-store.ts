import type { DocTypeName, DocumentEventPayload, DocumentName, DomainEvent, TenantId } from "../core/types.js";

export interface AuditEventQuery {
  readonly tenantId: TenantId;
  readonly doctype?: DocTypeName;
  readonly documentName?: DocumentName;
  readonly actorId?: string;
  readonly payloadKinds?: readonly DocumentEventPayload["kind"][];
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

export interface AuditDocumentEventQuery {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly documentName: DocumentName;
  readonly limit?: number;
}

export interface AuditEventStore {
  searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]>;
  readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]>;
}
