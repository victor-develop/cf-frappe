import type { AuditEventQuery } from "../../ports/audit-event-store.js";
import type { AuditDocumentEventQuery } from "../../ports/audit-event-store.js";
import { documentStream } from "../../core/streams.js";

export interface AuditEventD1Query {
  readonly sql: string;
  readonly params: readonly (number | string)[];
}

export function auditEventQuery(query: AuditEventQuery): AuditEventD1Query {
  const clauses = ["tenant_id = ?"];
  const params: (number | string)[] = [query.tenantId];
  if (query.doctype !== undefined) {
    clauses.push("doctype = ?");
    params.push(query.doctype);
  }
  if (query.documentName !== undefined) {
    clauses.push("document_name = ?");
    params.push(query.documentName);
  }
  if (query.actorId !== undefined) {
    clauses.push("actor_id = ?");
    params.push(query.actorId);
  }
  if (query.since !== undefined) {
    clauses.push("occurred_at >= ?");
    params.push(query.since);
  }
  if (query.until !== undefined) {
    clauses.push("occurred_at <= ?");
    params.push(query.until);
  }
  if (query.payloadKinds !== undefined) {
    if (query.payloadKinds.length === 0) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`json_extract(payload_json, '$.kind') IN (${query.payloadKinds.map(() => "?").join(", ")})`);
      params.push(...query.payloadKinds);
    }
  }
  if (query.limit !== undefined) {
    params.push(query.limit);
  }
  return {
    sql: `SELECT id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json
         FROM cf_frappe_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY occurred_at DESC, stream ASC, sequence DESC${query.limit !== undefined ? " LIMIT ?" : ""}`,
    params
  };
}

export function auditDocumentEventQuery(query: AuditDocumentEventQuery): AuditEventD1Query {
  const params: (number | string)[] = [documentStream(query.tenantId, query.doctype, query.documentName)];
  if (query.limit !== undefined) {
    params.push(query.limit);
  }
  return {
    sql: `SELECT id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json
         FROM cf_frappe_events
         WHERE stream = ?
         ORDER BY sequence ASC${query.limit !== undefined ? " LIMIT ?" : ""}`,
    params
  };
}
