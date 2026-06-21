import type { DocTypeDefinition } from "../../core/types";

export interface PlannedSqlStatement {
  readonly name: string;
  readonly sql: string;
}

export function planD1ProjectionIndexes(
  doctypes: readonly DocTypeDefinition[]
): readonly PlannedSqlStatement[] {
  return doctypes.flatMap((doctype) =>
    (doctype.indexes ?? []).map((fields) => {
      const name = indexName(doctype.name, fields);
      const jsonColumns = fields.map((field) => `json_extract(data_json, '$.${escapeJsonPath(field)}')`);
      return {
        name,
        sql:
          `CREATE INDEX IF NOT EXISTS ${name} ` +
          `ON cf_frappe_documents (tenant_id, doctype, ${jsonColumns.join(", ")}) ` +
          `WHERE doctype = '${escapeSqlString(doctype.name)}';`
      };
    })
  );
}

export function renderD1ProjectionIndexMigration(
  doctypes: readonly DocTypeDefinition[]
): string {
  return planD1ProjectionIndexes(doctypes)
    .map((statement) => statement.sql)
    .join("\n\n");
}

function indexName(doctype: string, fields: readonly string[]): string {
  const parts = [doctype, ...fields].map(slug);
  return `idx_cf_frappe_documents_${parts.join("_")}`;
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function escapeJsonPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
