import type { AuditEventQuery } from "../../ports/audit-event-store.js";
import type { AuditDocumentEventQuery } from "../../ports/audit-event-store.js";
import { documentStream } from "../../core/streams.js";
import { D1_EVENTS_TABLE } from "./tables.js";

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
         FROM ${D1_EVENTS_TABLE}
         WHERE ${clauses.join(" AND ")}
         ORDER BY occurred_at DESC, stream ASC, sequence DESC${query.limit !== undefined ? " LIMIT ?" : ""}`,
    params
  };
}

export function auditDocumentEventQuery(query: AuditDocumentEventQuery): AuditEventD1Query {
  // Without an explicit stream this reads the document's own stream and nothing
  // else, so an event elsewhere cannot claim its history. With one, the match is
  // by column *within that stream* — which is what the
  // `(tenant_id, doctype, document_name)` index serves.
  const params: (number | string)[] =
    query.stream === undefined
      ? [documentStream(query.tenantId, query.doctype, query.documentName)]
      : [query.tenantId, query.doctype, query.documentName, query.stream];
  const where =
    query.stream === undefined
      ? "stream = ?"
      : "tenant_id = ? AND doctype = ? AND document_name = ? AND stream = ?";
  if (query.limit !== undefined) {
    params.push(query.limit);
  }
  return {
    sql: `SELECT id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json
         FROM ${D1_EVENTS_TABLE}
         WHERE ${where}
         ORDER BY sequence ASC${query.limit !== undefined ? " LIMIT ?" : ""}`,
    params
  };
}
