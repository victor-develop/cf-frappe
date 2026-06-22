import type { DocTypeDefinition } from "../../core/types";
import { FrameworkError } from "../../core/errors";

export interface PlannedSqlStatement {
  readonly name: string;
  readonly sql: string;
}

export interface D1Migration {
  readonly id: string;
  readonly label?: string;
  readonly checksum: string;
  readonly statements: readonly PlannedSqlStatement[];
}

export interface D1MigrationInput {
  readonly id: string;
  readonly label?: string;
  readonly statements: readonly PlannedSqlStatement[];
}

export interface D1MigrationPlanOptions {
  readonly includeCore?: boolean;
}

export const D1_CORE_MIGRATION_ID = "0001_cf_frappe_core";
export const D1_JOB_EXECUTION_MIGRATION_ID = "0002_cf_frappe_job_executions";

export const D1_CORE_SCHEMA_STATEMENTS: readonly PlannedSqlStatement[] = [
  {
    name: "create_cf_frappe_events",
    sql:
      "CREATE TABLE IF NOT EXISTS cf_frappe_events (" +
      "id TEXT PRIMARY KEY, " +
      "tenant_id TEXT NOT NULL, " +
      "stream TEXT NOT NULL, " +
      "sequence INTEGER NOT NULL, " +
      "type TEXT NOT NULL, " +
      "doctype TEXT NOT NULL, " +
      "document_name TEXT NOT NULL, " +
      "actor_id TEXT NOT NULL, " +
      "occurred_at TEXT NOT NULL, " +
      "payload_json TEXT NOT NULL, " +
      "metadata_json TEXT NOT NULL DEFAULT '{}', " +
      "UNIQUE(stream, sequence)" +
      ");"
  },
  {
    name: "index_cf_frappe_events_stream_sequence",
    sql:
      "CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_stream_sequence " +
      "ON cf_frappe_events(stream, sequence);"
  },
  {
    name: "index_cf_frappe_events_doctype_time",
    sql:
      "CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_doctype_time " +
      "ON cf_frappe_events(tenant_id, doctype, occurred_at);"
  },
  {
    name: "index_cf_frappe_events_tenant_time",
    sql:
      "CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_tenant_time " +
      "ON cf_frappe_events(tenant_id, occurred_at, stream, sequence);"
  },
  {
    name: "create_cf_frappe_documents",
    sql:
      "CREATE TABLE IF NOT EXISTS cf_frappe_documents (" +
      "tenant_id TEXT NOT NULL, " +
      "doctype TEXT NOT NULL, " +
      "name TEXT NOT NULL, " +
      "version INTEGER NOT NULL, " +
      "docstatus TEXT NOT NULL, " +
      "data_json TEXT NOT NULL, " +
      "created_at TEXT NOT NULL, " +
      "updated_at TEXT NOT NULL, " +
      "PRIMARY KEY (tenant_id, doctype, name)" +
      ");"
  },
  {
    name: "index_cf_frappe_documents_list",
    sql:
      "CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_list " +
      "ON cf_frappe_documents(tenant_id, doctype, updated_at);"
  },
  {
    name: "create_cf_frappe_migrations",
    sql:
      "CREATE TABLE IF NOT EXISTS cf_frappe_migrations (" +
      "id TEXT PRIMARY KEY, " +
      "checksum TEXT NOT NULL, " +
      "statement_count INTEGER NOT NULL, " +
      "applied_at TEXT NOT NULL" +
      ");"
  }
];

export const D1_JOB_EXECUTION_SCHEMA_STATEMENTS: readonly PlannedSqlStatement[] = [
  {
    name: "create_cf_frappe_job_executions",
    sql:
      "CREATE TABLE IF NOT EXISTS cf_frappe_job_executions (" +
      "tenant_id TEXT NOT NULL, " +
      "idempotency_key TEXT NOT NULL, " +
      "job_name TEXT NOT NULL, " +
      "run_id TEXT NOT NULL, " +
      "status TEXT NOT NULL, " +
      "started_at TEXT NOT NULL, " +
      "finished_at TEXT, " +
      "result_json TEXT, " +
      "error TEXT, " +
      "PRIMARY KEY (tenant_id, idempotency_key)" +
      ");"
  },
  {
    name: "index_cf_frappe_job_executions_history",
    sql:
      "CREATE INDEX IF NOT EXISTS idx_cf_frappe_job_executions_history " +
      "ON cf_frappe_job_executions(tenant_id, job_name, status, started_at);"
  },
  {
    name: "index_cf_frappe_job_executions_started_at",
    sql:
      "CREATE INDEX IF NOT EXISTS idx_cf_frappe_job_executions_started_at " +
      "ON cf_frappe_job_executions(tenant_id, started_at);"
  }
];

export function planD1ProjectionIndexes(
  doctypes: readonly DocTypeDefinition[]
): readonly PlannedSqlStatement[] {
  return doctypes.flatMap((doctype) => {
    const indexNames = new Set<string>();
    return (doctype.indexes ?? []).map((fields) => {
      validateIndexedFields(doctype, fields);
      const name = indexName(doctype.name, fields);
      if (indexNames.has(name)) {
        throw new FrameworkError(
          "MIGRATION_INDEX_DUPLICATE",
          `D1 index '${name}' is planned more than once for DocType '${doctype.name}'`,
          { status: 409 }
        );
      }
      indexNames.add(name);
      const jsonColumns = fields.map((field) => `json_extract(data_json, '$.${escapeJsonPath(field)}')`);
      return {
        name,
        sql:
          `CREATE INDEX IF NOT EXISTS ${name} ` +
          `ON cf_frappe_documents (tenant_id, doctype, ${jsonColumns.join(", ")}) ` +
          `WHERE doctype = '${escapeSqlString(doctype.name)}';`
      };
    })
  });
}

export function planD1Migrations(
  doctypes: readonly DocTypeDefinition[],
  options: D1MigrationPlanOptions = {}
): readonly D1Migration[] {
  const includeCore = options.includeCore ?? true;
  const migrations: D1Migration[] = includeCore
    ? [
        defineD1Migration({
          id: D1_CORE_MIGRATION_ID,
          label: "cf-frappe event/projection tables",
          statements: D1_CORE_SCHEMA_STATEMENTS
        }),
        defineD1Migration({
          id: D1_JOB_EXECUTION_MIGRATION_ID,
          label: "cf-frappe job execution history",
          statements: D1_JOB_EXECUTION_SCHEMA_STATEMENTS
        })
      ]
    : [];

  for (const doctype of [...doctypes].sort((left, right) => left.name.localeCompare(right.name))) {
    const statements = planD1ProjectionIndexes([doctype]);
    if (statements.length === 0) {
      continue;
    }
    migrations.push(
      defineD1Migration({
        id: `doctype_${slug(doctype.name)}_v${doctype.version ?? 1}_indexes`,
        label: `${doctype.name} projection indexes`,
        statements
      })
    );
  }

  assertUniqueMigrationIds(migrations);
  return migrations;
}

export function defineD1Migration(input: D1MigrationInput): D1Migration {
  assertMigrationId(input.id);
  if (input.statements.length === 0) {
    throw new FrameworkError("MIGRATION_EMPTY", `Migration '${input.id}' has no statements`, {
      status: 400
    });
  }
  const migration = {
    ...input,
    statements: Object.freeze([...input.statements]),
    checksum: checksumMigration(input.id, input.statements)
  };
  return Object.freeze(migration);
}

export function renderD1ProjectionIndexMigration(
  doctypes: readonly DocTypeDefinition[]
): string {
  return planD1ProjectionIndexes(doctypes)
    .map((statement) => statement.sql)
    .join("\n\n");
}

export function renderD1Migration(migration: D1Migration): string {
  return migration.statements.map((statement) => statement.sql).join("\n\n");
}

export function renderD1Migrations(migrations: readonly D1Migration[]): string {
  return migrations
    .map((migration) => `-- ${migration.id}: ${migration.label ?? migration.id}\n${renderD1Migration(migration)}`)
    .join("\n\n");
}

function indexName(doctype: string, fields: readonly string[]): string {
  const parts = [doctype, ...fields].map(slug);
  const readable = parts.join("_");
  const digest = fnv1a32(JSON.stringify([doctype, ...fields]));
  return `idx_cf_frappe_documents_${readable}_${digest}`;
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

function validateIndexedFields(doctype: DocTypeDefinition, fields: readonly string[]): void {
  if (fields.length === 0) {
    throw new FrameworkError(
      "MIGRATION_INDEX_INVALID",
      `D1 index on DocType '${doctype.name}' must include at least one field`,
      { status: 400 }
    );
  }
  const declaredFields = new Map(doctype.fields.map((field) => [field.name, field]));
  const indexedFields = new Set<string>();
  for (const field of fields) {
    const definition = declaredFields.get(field);
    if (!definition) {
      throw new FrameworkError(
        "MIGRATION_INDEX_INVALID",
        `D1 index on DocType '${doctype.name}' references unknown field '${field}'`,
        { status: 400 }
      );
    }
    if (definition.type === "json" || definition.type === "table") {
      throw new FrameworkError(
        "MIGRATION_INDEX_INVALID",
        `D1 index on DocType '${doctype.name}' cannot index ${definition.type} field '${field}'`,
        { status: 400 }
      );
    }
    if (indexedFields.has(field)) {
      throw new FrameworkError(
        "MIGRATION_INDEX_DUPLICATE",
        `D1 index on DocType '${doctype.name}' repeats field '${field}'`,
        { status: 409 }
      );
    }
    indexedFields.add(field);
  }
}

function assertMigrationId(id: string): void {
  if (!/^[a-z0-9][a-z0-9_]*$/.test(id)) {
    throw new FrameworkError("MIGRATION_ID_INVALID", `Invalid migration id '${id}'`, {
      status: 400
    });
  }
}

function assertUniqueMigrationIds(migrations: readonly D1Migration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new FrameworkError("MIGRATION_DUPLICATE", `Migration '${migration.id}' is defined more than once`, {
        status: 409
      });
    }
    seen.add(migration.id);
  }
}

function checksumMigration(id: string, statements: readonly PlannedSqlStatement[]): string {
  const payload = JSON.stringify({
    id,
    statements: statements.map((statement) => ({
      name: statement.name,
      sql: statement.sql.trim()
    }))
  });
  return `fnv1a32:${fnv1a32(payload)}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
