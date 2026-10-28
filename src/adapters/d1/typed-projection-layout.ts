import type { DocTypeDefinition, FieldDefinition, FieldType } from "../../core/types.js";
import { FrameworkError } from "../../core/errors.js";
import { d1JsonExtract, d1JsonType } from "./json-path.js";
import { fnv1a32, sqlSlug } from "./sql-names.js";
import { D1_TYPED_PROJECTION_TABLE_PREFIX } from "./tables.js";

/**
 * Typed per-DocType projection tables (issue #15): the physical layout one
 * DocType's metadata turns into.
 *
 * The shared projection table keeps every business field inside one
 * `data_json` blob, so every filter, sort and aggregate parses JSON per row and
 * no column has a type. A typed table keeps the same rows, but promotes the
 * DocType's *hot* fields to real columns:
 *
 * - **Hot is declared, once.** Every field named in `doctype.indexes` is hot by
 *   definition — an index on it is only possible as a real column — and
 *   `doctype.promotedFields` adds the fields that are filtered or sorted on
 *   without an index. Naming an indexed field there too is refused rather than
 *   tolerated, so there is no second list that can drift from the first.
 * - **Cold fields stay in `data_json`.** D1 allows 100 columns per table, so
 *   "one column per field" is not available; the overflow column is the rest.
 *   `data_json` actually keeps the whole document, hot fields included, and that
 *   is deliberate: the promoted columns are `GENERATED ALWAYS AS
 *   (json_extract(data_json, ...)) STORED`, so SQLite computes them once at
 *   write from the very expression the shared table queries with. A promoted
 *   column therefore cannot disagree with the document it came from, a read
 *   returns `data_json` byte for byte, and parity with the blob projection holds
 *   by construction instead of by a reassembly step that would have to restore
 *   key order.
 * - **Typed by CHECK, not by affinity.** The columns carry no declared type.
 *   A declared `INTEGER`/`TEXT` gives the column an affinity, and affinity
 *   changes comparisons: an `INTEGER` column matches `= '5'` against a stored
 *   `5`, a bare `json_extract` does not. That would make a promoted field answer
 *   a filter differently from an unpromoted one, which the query compiler must
 *   never do. The type is enforced instead by a `CHECK (json_type(...) IN ...)`
 *   that admits exactly what `validateDocumentData` admits for the field type
 *   (a value of that type, or the "missing" forms null and `''`), and rejects
 *   the rest — a write that would put a number in a text column fails with
 *   `CHECK constraint failed` rather than being coerced.
 *
 * The table name ends in a digest of the layout: the promoted columns, their
 * types, and the index declarations. A layout change is therefore a new table,
 * filled by a rebuild from the event stream (#11) and compared row by row
 * against the blob projection before it is read from — never an in-place
 * `ALTER`. See docs/typed-projection-tables.md.
 */

/** D1's hard limit on columns in one table. */
export const D1_MAX_COLUMNS_PER_TABLE = 100;

/**
 * Default ceiling on a typed projection table's total column count.
 *
 * Ten under D1's 100, so that the field someone has to promote during an
 * incident still fits without first raising a limit. Pass `maxColumns` to use
 * the headroom deliberately; nothing can go past {@link D1_MAX_COLUMNS_PER_TABLE}.
 */
export const D1_TYPED_PROJECTION_COLUMN_BUDGET = 90;

/** The non-promoted columns every typed projection table carries. */
export const D1_TYPED_PROJECTION_SYSTEM_COLUMNS = [
  "tenant_id",
  "name",
  "version",
  "docstatus",
  "data_json",
  "created_at",
  "updated_at"
] as const;

export interface D1TypedProjectionColumn {
  /** The DocType field this column promotes. */
  readonly field: string;
  readonly fieldType: FieldType;
  /** `f_<field slug>`: never collides with a system column. */
  readonly column: string;
}

export interface D1TypedProjectionIndex {
  readonly name: string;
  readonly fields: readonly string[];
}

export interface D1TypedProjectionLayout {
  readonly doctype: string;
  readonly table: string;
  /** Eight hex digits over the promoted columns, their types and the indexes. */
  readonly digest: string;
  /** Promoted columns, ordered by field name so field order does not move the digest. */
  readonly columns: readonly D1TypedProjectionColumn[];
  readonly indexes: readonly D1TypedProjectionIndex[];
  /** System columns plus promoted columns. */
  readonly columnCount: number;
}

export interface D1TypedProjectionLayoutOptions {
  /**
   * Ceiling on total columns, defaulting to {@link D1_TYPED_PROJECTION_COLUMN_BUDGET}.
   * May not exceed {@link D1_MAX_COLUMNS_PER_TABLE}.
   */
  readonly maxColumns?: number;
}

/** Plans the typed projection table for one DocType. Throws on any invalid declaration. */
export function planD1TypedProjectionLayout(
  doctype: DocTypeDefinition,
  options: D1TypedProjectionLayoutOptions = {}
): D1TypedProjectionLayout {
  const maxColumns = typedProjectionColumnCeiling(options.maxColumns);
  const declared = new Map(doctype.fields.map((field) => [field.name, field]));
  const promoted = new Map<string, FieldDefinition>();
  for (const fields of doctype.indexes ?? []) {
    // The same rules `planD1Migrations` applies to the shared table's indexes,
    // repeated here because the runtime plans layouts without it.
    if (fields.length === 0) {
      throw new FrameworkError(
        "MIGRATION_INDEX_INVALID",
        `D1 index on DocType '${doctype.name}' must include at least one field`,
        { status: 400 }
      );
    }
    if (new Set(fields).size !== fields.length) {
      throw new FrameworkError(
        "MIGRATION_INDEX_DUPLICATE",
        `D1 index on DocType '${doctype.name}' repeats a field: ${fields.join(", ")}`,
        { status: 409 }
      );
    }
    for (const field of fields) {
      promoted.set(field, promotableField(doctype, declared, field, "indexes"));
    }
  }
  const explicit = new Set<string>();
  for (const field of doctype.promotedFields ?? []) {
    if (explicit.has(field)) {
      throw invalidLayout(`DocType '${doctype.name}' lists promoted field '${field}' more than once`);
    }
    if (promoted.has(field)) {
      throw invalidLayout(
        `DocType '${doctype.name}' lists '${field}' in promotedFields, but it is already promoted ` +
          "because an index declares it. List each hot field once: indexes promote their fields."
      );
    }
    explicit.add(field);
    promoted.set(field, promotableField(doctype, declared, field, "promotedFields"));
  }

  const columns = [...promoted.values()]
    .sort((left, right) => compareBinary(left.name, right.name))
    .map((field) => ({ field: field.name, fieldType: field.type, column: `f_${sqlSlug(field.name)}` }));
  assertDistinctColumns(doctype, columns);

  const columnCount = D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length + columns.length;
  if (columnCount > maxColumns) {
    throw new FrameworkError(
      "MIGRATION_TYPED_PROJECTION_COLUMN_LIMIT",
      `Typed projection for DocType '${doctype.name}' needs ${columnCount} columns ` +
        `(${D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length} system + ${columns.length} promoted), over the ceiling of ` +
        `${maxColumns}; D1 allows ${D1_MAX_COLUMNS_PER_TABLE} per table. Promoted: ` +
        `${columns.map((column) => column.field).join(", ")}. Promote fewer fields — a cold field still ` +
        "filters correctly from data_json — or raise maxColumns deliberately.",
      { status: 409 }
    );
  }

  const digest = fnv1a32(JSON.stringify({
    doctype: doctype.name,
    columns: columns.map((column) => [column.field, column.fieldType]),
    indexes: doctype.indexes ?? []
  }));
  const table = `${D1_TYPED_PROJECTION_TABLE_PREFIX}${sqlSlug(doctype.name)}_${digest}`;
  const indexNames = new Set<string>();
  const indexes = (doctype.indexes ?? []).map((fields) => {
    const name = `idx_${table}_${fields.map(sqlSlug).join("_")}_${fnv1a32(JSON.stringify(fields))}`;
    if (indexNames.has(name)) {
      throw new FrameworkError(
        "MIGRATION_INDEX_DUPLICATE",
        `Typed projection index '${name}' is planned more than once for DocType '${doctype.name}'`,
        { status: 409 }
      );
    }
    indexNames.add(name);
    return { name, fields: [...fields] };
  });
  return Object.freeze({ doctype: doctype.name, table, digest, columns, indexes, columnCount });
}

/** The column a field is promoted to, or `undefined` when it lives in `data_json`. */
export function d1TypedProjectionColumn(layout: D1TypedProjectionLayout, field: string): string | undefined {
  return layout.columns.find((column) => column.field === field)?.column;
}

/** `CREATE TABLE` and `CREATE INDEX` statements for one layout. */
export function d1TypedProjectionDdl(layout: D1TypedProjectionLayout): readonly { readonly name: string; readonly sql: string }[] {
  const promoted = layout.columns.map((column) =>
    `${column.column} AS (${d1JsonExtract(column.field)}) STORED ` +
    `CHECK (${typedColumnCheck(column)})`
  );
  const createTable =
    `CREATE TABLE IF NOT EXISTS ${layout.table} (` +
    [
      "tenant_id TEXT NOT NULL",
      "name TEXT NOT NULL",
      "version INTEGER NOT NULL",
      "docstatus TEXT NOT NULL",
      "data_json TEXT NOT NULL",
      "created_at TEXT NOT NULL",
      "updated_at TEXT NOT NULL",
      ...promoted,
      "PRIMARY KEY (tenant_id, name)"
    ].join(", ") +
    ");";
  return [
    { name: `create_${layout.table}`, sql: createTable },
    {
      // The default list order. The shared table's `idx_cf_frappe_documents_list`
      // carries `doctype` too; one table per DocType makes that column redundant.
      name: `index_${layout.table}_list`,
      sql: `CREATE INDEX IF NOT EXISTS idx_${layout.table}_list ON ${layout.table}(tenant_id, updated_at);`
    },
    ...layout.indexes.map((index) => ({
      name: `index_${index.name}`,
      sql:
        `CREATE INDEX IF NOT EXISTS ${index.name} ON ${layout.table} ` +
        `(tenant_id, ${index.fields.map((field) => d1TypedProjectionColumn(layout, field)!).join(", ")}, updated_at);`
    }))
  ];
}

/**
 * The promoted field whose CHECK a D1 error message reports, if it names one.
 *
 * SQLite reports a failed column CHECK by quoting its expression, which is
 * internal (table, column and JSON path). This maps it back to the field, so a
 * caller can be told which field was refused without seeing the schema. The
 * longest match wins, so one field's expression appearing inside another's
 * cannot misattribute it.
 */
export function d1TypedProjectionRejectedField(layout: D1TypedProjectionLayout, message: string): string | undefined {
  let found: { readonly field: string; readonly length: number } | undefined;
  for (const column of layout.columns) {
    const check = typedColumnCheck(column);
    if (message.includes(check) && (found === undefined || check.length > found.length)) {
      found = { field: column.field, length: check.length };
    }
  }
  return found?.field;
}

/**
 * What `validateDocumentData` lets a field of this type hold, as a CHECK.
 *
 * It asks `json_type` of the stored document rather than `typeof` of the
 * column, because the column cannot tell every case apart: `json_extract`
 * returns a JSON object or array as *text*, so `typeof` would pass `{"y":2026}`
 * as a valid date, and returns JSON `true` as the integer 1, so it could not
 * tell a boolean from a number. A CHECK may read any column of its row, and
 * this one costs a parse at write only.
 *
 * Every type admits a missing key and JSON null, and `''`, because validation
 * treats all three as "missing" and skips the type rule for them — a cleared
 * integer field legitimately holds `""`.
 */
function typedColumnCheck(column: D1TypedProjectionColumn): string {
  const jsonType = `coalesce(${d1JsonType(column.field)}, 'null')`;
  const emptyString = `${column.column} = ''`;
  switch (column.fieldType) {
    case "text":
    case "longText":
    case "select":
    case "link":
    case "date":
    case "datetime":
      return `${jsonType} IN ('null', 'text')`;
    case "integer":
      return `${jsonType} IN ('null', 'integer') OR ${emptyString}`;
    case "number":
      return `${jsonType} IN ('null', 'integer', 'real') OR ${emptyString}`;
    case "boolean":
      return `${jsonType} IN ('null', 'true', 'false') OR ${emptyString}`;
    case "json":
    case "table":
      // Refused by promotableField before a column is planned.
      throw invalidLayout(`A ${column.fieldType} field cannot be promoted to a typed column`);
  }
}

function promotableField(
  doctype: DocTypeDefinition,
  declared: ReadonlyMap<string, FieldDefinition>,
  field: string,
  source: "indexes" | "promotedFields"
): FieldDefinition {
  const definition = declared.get(field);
  if (definition === undefined) {
    throw invalidLayout(`DocType '${doctype.name}' ${source} references unknown field '${field}'`);
  }
  if (definition.type === "json" || definition.type === "table") {
    throw invalidLayout(
      `DocType '${doctype.name}' cannot promote ${definition.type} field '${field}' to a typed column; ` +
        "it has no scalar value to store"
    );
  }
  return definition;
}

function assertDistinctColumns(doctype: DocTypeDefinition, columns: readonly D1TypedProjectionColumn[]): void {
  // SQLite column names are case-insensitive and the slug folds spaces, so
  // `customer id` and `Customer_ID` would land on one column.
  const owners = new Map<string, string>();
  for (const column of columns) {
    const owner = owners.get(column.column);
    if (owner !== undefined) {
      throw invalidLayout(
        `DocType '${doctype.name}' promotes '${owner}' and '${column.field}', which both map to column '${column.column}'`
      );
    }
    owners.set(column.column, column.field);
  }
}

function typedProjectionColumnCeiling(maxColumns: number | undefined): number {
  const ceiling = maxColumns ?? D1_TYPED_PROJECTION_COLUMN_BUDGET;
  if (!Number.isInteger(ceiling) || ceiling < D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length || ceiling > D1_MAX_COLUMNS_PER_TABLE) {
    throw invalidLayout(
      `Typed projection maxColumns must be an integer between ${D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length} and ` +
        `${D1_MAX_COLUMNS_PER_TABLE} (D1's per-table limit), got ${String(maxColumns)}`
    );
  }
  return ceiling;
}

function invalidLayout(message: string): FrameworkError {
  return new FrameworkError("MIGRATION_TYPED_PROJECTION_INVALID", message, { status: 400 });
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
