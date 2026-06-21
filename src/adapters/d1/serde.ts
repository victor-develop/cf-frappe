import type { DocumentData, DocumentSnapshot, DomainEvent } from "../../core/types";

export interface EventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly stream: string;
  readonly sequence: number;
  readonly type: DomainEvent["type"];
  readonly doctype: string;
  readonly document_name: string;
  readonly actor_id: string;
  readonly occurred_at: string;
  readonly payload_json: string;
  readonly metadata_json: string;
}

export interface DocumentRow {
  readonly tenant_id: string;
  readonly doctype: string;
  readonly name: string;
  readonly version: number;
  readonly docstatus: DocumentSnapshot["docstatus"];
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export function eventFromRow(row: EventRow): DomainEvent {
  const payload = JSON.parse(row.payload_json) as DomainEvent["payload"];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stream: row.stream,
    sequence: row.sequence,
    type: row.type,
    doctype: row.doctype,
    documentName: row.document_name,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    payload,
    metadata: JSON.parse(row.metadata_json) as DocumentData
  };
}

export function documentFromRow(row: DocumentRow): DocumentSnapshot {
  return {
    tenantId: row.tenant_id,
    doctype: row.doctype,
    name: row.name,
    version: row.version,
    docstatus: row.docstatus,
    data: JSON.parse(row.data_json) as DocumentData,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
