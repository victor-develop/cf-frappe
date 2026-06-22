import type { DocTypeName, DocumentEventPayload, DocumentName, DomainEvent, TenantId } from "../core/types";

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

export interface AuditEventStore {
  searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]>;
}
