import {
  D1_CORE_MIGRATION_ID,
  D1_CORE_SCHEMA_STATEMENTS,
  defineDocType,
  planD1Migrations,
  planD1ProjectionIndexes,
  renderD1Migration,
  renderD1Migrations,
  renderD1ProjectionIndexMigration
} from "../../src";
import { readFileSync } from "node:fs";

describe("D1 schema planner", () => {
  it("renders projection indexes from doctype metadata", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "owner", type: "text" }
      ],
      indexes: [["status"], ["owner", "status"]]
    });

    const statements = planD1ProjectionIndexes([Task]);

    expect(statements[0]!.name).toMatch(/^idx_cf_frappe_documents_task_status_[a-f0-9]{8}$/);
    expect(statements[0]!.sql).toBe(
      `CREATE INDEX IF NOT EXISTS ${statements[0]!.name} ` +
        "ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.status')) " +
        "WHERE doctype = 'Task';"
    );
    expect(statements[1]!.name).toMatch(/^idx_cf_frappe_documents_task_owner_status_[a-f0-9]{8}$/);
    expect(statements[1]!.sql).toBe(
      `CREATE INDEX IF NOT EXISTS ${statements[1]!.name} ` +
        "ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.owner'), json_extract(data_json, '$.status')) " +
        "WHERE doctype = 'Task';"
    );
  });

  it("renders migration text for multiple statements", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"]]
    });

    expect(renderD1ProjectionIndexMigration([Task])).toContain("CREATE INDEX IF NOT EXISTS");
  });

  it("plans core and metadata-derived migrations with stable checksums", () => {
    const Task = defineDocType({
      name: "Task",
      version: 7,
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"]]
    });

    const migrations = planD1Migrations([Task]);

    expect(migrations.map((migration) => migration.id)).toEqual([
      D1_CORE_MIGRATION_ID,
      "doctype_task_v7_indexes"
    ]);
    expect(migrations[0]!.checksum).toMatch(/^fnv1a32:[a-f0-9]{8}$/);
    expect(migrations[1]).toMatchObject({
      label: "Task projection indexes",
      statements: [
        {
          name: expect.stringMatching(/^idx_cf_frappe_documents_task_status_[a-f0-9]{8}$/)
        }
      ]
    });
  });

  it("renders ordered migration bundles for reviewable files", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"]]
    });

    expect(renderD1Migrations(planD1Migrations([Task]))).toContain(
      "-- 0001_cf_frappe_core: cf-frappe event/projection tables"
    );
  });

  it("keeps slug-equivalent fields from colliding into one index name", () => {
    const Contact = defineDocType({
      name: "Contact",
      fields: [
        { name: "owner id", type: "text" },
        { name: "owner_id", type: "text" }
      ],
      indexes: [["owner id"], ["owner_id"]]
    });

    const names = planD1ProjectionIndexes([Contact]).map((statement) => statement.name);

    expect(new Set(names).size).toBe(2);
  });

  it("rejects indexes that do not reference declared fields", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      indexes: [["statsu"]]
    });

    expect(() => planD1ProjectionIndexes([Task])).toThrow("references unknown field 'statsu'");
  });

  it("rejects projection indexes over table fields", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Sales Invoice Item" }],
      indexes: [["items"]]
    });

    expect(() => planD1ProjectionIndexes([Invoice])).toThrow("cannot index table field 'items'");
  });

  it("keeps the checked-in Wrangler core migration exactly equivalent to the TypeScript plan", () => {
    const fileSql = readFileSync(new URL("../../migrations/0001_cf_frappe_core.sql", import.meta.url), "utf8");

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_CORE_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...coreMigrationStub, statements: [statement] }))
      )
    );
  });
});

const coreMigrationStub = {
  id: D1_CORE_MIGRATION_ID,
  checksum: "test"
};

function normalizeSql(sql: string): string {
  return sql
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*([(),;])\s*/g, "$1")
    .trim();
}

function splitSqlStatements(sql: string): readonly string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => normalizeSql(`${statement};`));
}
