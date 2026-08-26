/**
 * The single place that turns a DocType field name into SQL that reads it out of
 * `data_json`.
 *
 * SQLite matches expression indexes **textually**. `data_json->>'$.status'` is
 * semantically identical to `json_extract(data_json, '$.status')` but will not
 * match an index built with the latter, and nothing fails loudly when they
 * diverge — the index simply stops being used. So index DDL
 * (`planD1ProjectionIndexes`) and query predicates (`d1ProjectionListQuery`)
 * must both come from here, and the D1 adapter must never hand-write `->` or
 * `->>`. `tests/adapters/d1-json-path.test.ts` enforces both halves.
 */

const DATA_COLUMN = "data_json";

/** A quoted SQL string literal, escaped the way SQLite expects. */
function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The quoted JSON path literal for a field, e.g. `'$.status'`. */
export function d1JsonPathLiteral(field: string): string {
  return sqlStringLiteral(`$.${field}`);
}

/** Reads a field out of `data_json`. The only accepted form. */
export function d1JsonExtract(field: string): string {
  return `json_extract(${DATA_COLUMN}, ${d1JsonPathLiteral(field)})`;
}

/** Reads a field's JSON type, used to tell a JSON null from a missing key. */
export function d1JsonType(field: string): string {
  return `json_type(${DATA_COLUMN}, ${d1JsonPathLiteral(field)})`;
}
