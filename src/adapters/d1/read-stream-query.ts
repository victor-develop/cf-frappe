import type { ReadStreamOptions } from "../../ports/document-store.js";

export interface EventStreamQuery {
  readonly sql: string;
  readonly params: readonly (number | string)[];
  readonly reverseResults: boolean;
}

export function eventStreamQuery(options: ReadStreamOptions): EventStreamQuery {
  const clauses = ["stream = ?"];
  const params: (number | string)[] = [];
  if (options.maxSequence !== undefined) {
    clauses.push("sequence <= ?");
    params.push(options.maxSequence);
  }
  if (options.payloadKinds !== undefined) {
    if (options.payloadKinds.length === 0) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`json_extract(payload_json, '$.kind') IN (${options.payloadKinds.map(() => "?").join(", ")})`);
      params.push(...options.payloadKinds);
    }
  }
  const reverseResults = options.limit !== undefined;
  if (options.limit !== undefined) {
    params.push(options.limit);
  }
  return {
    sql: `SELECT id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json
         FROM cf_frappe_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY sequence ${reverseResults ? "DESC" : "ASC"}${options.limit !== undefined ? " LIMIT ?" : ""}`,
    params,
    reverseResults
  };
}
