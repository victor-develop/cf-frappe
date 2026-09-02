import {
  D1_AUTOMATION_RUN_MIGRATION_ID,
  D1_EVENT_DOCUMENT_NAME_MIGRATION_ID,
  D1_EVENT_DOCUMENT_NAME_SCHEMA_STATEMENTS,
  D1_AUTOMATION_RUN_SCHEMA_STATEMENTS,
  D1_CORE_MIGRATION_ID,
  D1_CORE_SCHEMA_STATEMENTS,
  D1_DATA_PATCH_MIGRATION_ID,
  D1_DATA_PATCH_ROLLBACK_MIGRATION_ID,
  D1_DATA_PATCH_ROLLBACK_SCHEMA_STATEMENTS,
  D1_DATA_PATCH_SCHEMA_STATEMENTS,
  D1_JOB_EXECUTION_MIGRATION_ID,
  D1_JOB_EXECUTION_MESSAGE_MIGRATION_ID,
  D1_JOB_EXECUTION_MESSAGE_SCHEMA_STATEMENTS,
  D1_JOB_EXECUTION_SCHEMA_STATEMENTS,
  D1_PROJECTION_INDEX_BUDGET,
  D1_PROJECTION_SORT_COLUMN,
  defineDocType,
  planD1Migrations,
  planD1ProjectionIndexes,
  planD1RetiredProjectionIndexes,
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
        "ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.status'), updated_at) " +
        "WHERE doctype = 'Task';"
    );
    expect(statements[1]!.name).toMatch(/^idx_cf_frappe_documents_task_owner_status_[a-f0-9]{8}$/);
    expect(statements[1]!.sql).toBe(
      `CREATE INDEX IF NOT EXISTS ${statements[1]!.name} ` +
        "ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.owner'), json_extract(data_json, '$.status'), updated_at) " +
        "WHERE doctype = 'Task';"
    );
  });

  it("ends every projection index with the default list sort column", () => {
    // Without the trailing sort column a filtered list ordered by the default
    // `updatedAt` falls back to `USE TEMP B-TREE FOR ORDER BY`, which sorts every
    // matching row before LIMIT applies. See docs/projection-indexes.md.
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "priority", type: "text" }
      ],
      indexes: [["status"], ["status", "priority"]]
    });

    for (const statement of planD1ProjectionIndexes([Task])) {
      expect(statement.sql).toContain(`, ${D1_PROJECTION_SORT_COLUMN}) WHERE doctype = 'Task';`);
    }
  });

  it("rejects a plan that exceeds the projection index budget, and allows raising it", () => {
    // Every insert pays for every index on cf_frappe_documents, including ones
    // its own DocType can never match, and the cost grows faster than the count.
    // Measured curve and the reproduction script are in docs/projection-indexes.md.
    const doctypes = Array.from({ length: D1_PROJECTION_INDEX_BUDGET + 1 }, (_unused, index) =>
      defineDocType({
        name: `Budget ${index}`,
        fields: [{ name: "status", type: "text" }],
        indexes: [["status"]]
      })
    );

    expect(() => planD1Migrations(doctypes, { includeCore: false })).toThrow(
      `exceed the budget of ${D1_PROJECTION_INDEX_BUDGET}`
    );
    expect(() => planD1Migrations(doctypes, { includeCore: false })).toThrowError(
      expect.objectContaining({ code: "MIGRATION_INDEX_BUDGET_EXCEEDED" })
    );

    expect(
      planD1Migrations(doctypes.slice(0, D1_PROJECTION_INDEX_BUDGET), { includeCore: false })
    ).toHaveLength(D1_PROJECTION_INDEX_BUDGET);
    expect(
      planD1Migrations(doctypes, { includeCore: false, maxProjectionIndexes: doctypes.length })
    ).toHaveLength(doctypes.length);
  });

  it("counts every declared index on a DocType against the budget", () => {
    const doctype = defineDocType({
      name: "Wide",
      fields: [
        { name: "a", type: "text" },
        { name: "b", type: "text" }
      ],
      indexes: [["a"], ["b"], ["a", "b"]]
    });

    expect(() => planD1Migrations([doctype], { includeCore: false, maxProjectionIndexes: 2 })).toThrow(
      "3 declared projection indexes exceed the budget of 2"
    );
    expect(planD1Migrations([doctype], { includeCore: false, maxProjectionIndexes: 3 })).toHaveLength(1);
  });

  it("rejects the same projection index declared twice on one DocType", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"], ["status"]]
    });

    expect(() => planD1ProjectionIndexes([Task])).toThrow("is planned more than once");
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
      D1_JOB_EXECUTION_MIGRATION_ID,
      D1_JOB_EXECUTION_MESSAGE_MIGRATION_ID,
      D1_DATA_PATCH_MIGRATION_ID,
      D1_DATA_PATCH_ROLLBACK_MIGRATION_ID,
      D1_AUTOMATION_RUN_MIGRATION_ID,
      D1_EVENT_DOCUMENT_NAME_MIGRATION_ID,
      "doctype_task_v7_indexes"
    ]);
    expect(migrations[0]!.checksum).toMatch(/^fnv1a32:[a-f0-9]{8}$/);
    expect(migrations[0]!.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "index_cf_frappe_events_tenant_time",
          sql: "CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_tenant_time ON cf_frappe_events(tenant_id, occurred_at, stream, sequence);"
        })
      ])
    );
    expect(migrations[1]).toMatchObject({
      id: D1_JOB_EXECUTION_MIGRATION_ID,
      label: "cf-frappe job execution history",
      statements: expect.arrayContaining([
        {
          name: "create_cf_frappe_job_executions",
          sql: expect.stringContaining("PRIMARY KEY (tenant_id, idempotency_key)")
        }
      ])
    });
    expect(migrations[2]).toMatchObject({
      id: D1_JOB_EXECUTION_MESSAGE_MIGRATION_ID,
      label: "cf-frappe job execution message snapshots",
      statements: expect.arrayContaining([
        {
          name: "add_payload_json_to_cf_frappe_job_executions",
          sql: "ALTER TABLE cf_frappe_job_executions ADD COLUMN payload_json TEXT;"
        }
      ])
    });
    expect(migrations[3]).toMatchObject({
      id: D1_DATA_PATCH_MIGRATION_ID,
      label: "cf-frappe data patch journal",
      statements: D1_DATA_PATCH_SCHEMA_STATEMENTS
    });
    expect(migrations[4]).toMatchObject({
      id: D1_DATA_PATCH_ROLLBACK_MIGRATION_ID,
      label: "cf-frappe data patch rollback journal",
      statements: D1_DATA_PATCH_ROLLBACK_SCHEMA_STATEMENTS
    });
    expect(migrations[5]).toMatchObject({
      id: D1_AUTOMATION_RUN_MIGRATION_ID,
      label: "cf-frappe automation run claim index",
      statements: D1_AUTOMATION_RUN_SCHEMA_STATEMENTS
    });
    expect(migrations[6]).toMatchObject({
      id: D1_EVENT_DOCUMENT_NAME_MIGRATION_ID,
      label: "cf-frappe event document name index",
      statements: D1_EVENT_DOCUMENT_NAME_SCHEMA_STATEMENTS
    });
    expect(migrations[7]).toMatchObject({
      label: "Task projection indexes",
      statements: [
        {
          name: expect.stringMatching(/^idx_cf_frappe_documents_task_status_[a-f0-9]{8}$/)
        }
      ]
    });
  });

  it("plans retired projection indexes before replacement indexes", () => {
    const Lead = defineDocType({
      name: "Lead",
      version: 2,
      fields: [
        { name: "status", type: "select", options: ["Open", "Qualified"] },
        { name: "account_manager", type: "text" }
      ],
      retiredIndexes: [
        ["owner"],
        { doctype: "CRM Lead", fields: ["customer id", "status"] }
      ],
      indexes: [["account_manager", "status"]]
    });

    const retired = planD1RetiredProjectionIndexes([Lead]);

    expect(retired).toHaveLength(2);
    expect(retired[0]!.name).toMatch(/^drop_idx_cf_frappe_documents_lead_owner_[a-f0-9]{8}$/);
    expect(retired[0]!.sql).toBe(`DROP INDEX IF EXISTS ${retired[0]!.name.slice("drop_".length)};`);
    expect(retired[1]!.name).toMatch(/^drop_idx_cf_frappe_documents_crm_lead_customer_id_status_[a-f0-9]{8}$/);

    const migrations = planD1Migrations([Lead], { includeCore: false });

    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatchObject({
      id: "doctype_lead_v2_indexes",
      label: "Lead projection indexes",
      statements: [
        { name: retired[0]!.name },
        { name: retired[1]!.name },
        { name: expect.stringMatching(/^idx_cf_frappe_documents_lead_account_manager_status_[a-f0-9]{8}$/) }
      ]
    });
    expect(renderD1Migrations(migrations)).toContain("DROP INDEX IF EXISTS");
    expect(renderD1ProjectionIndexMigration([Lead])).toContain("DROP INDEX IF EXISTS");
  });

  it("rejects projection indexes declared as both active and retired", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"]],
      retiredIndexes: [["status"]]
    });

    expect(() => planD1Migrations([Task], { includeCore: false })).toThrow("cannot be both declared and retired");
  });

  it("rejects retired projection indexes that are still active on another DocType", () => {
    const LegacyLead = defineDocType({
      name: "Legacy Lead",
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"]]
    });
    const Cleanup = defineDocType({
      name: "Cleanup",
      fields: [{ name: "status", type: "text" }],
      retiredIndexes: [{ doctype: "Legacy Lead", fields: ["status"] }]
    });

    expect(() => planD1Migrations([LegacyLead, Cleanup], { includeCore: false })).toThrow(
      "is still declared by DocType 'Legacy Lead'"
    );
  });

  it("rejects duplicate retired projection indexes across DocTypes", () => {
    const CleanupA = defineDocType({
      name: "Cleanup A",
      fields: [{ name: "status", type: "text" }],
      retiredIndexes: [{ doctype: "Legacy Lead", fields: ["status"] }]
    });
    const CleanupB = defineDocType({
      name: "Cleanup B",
      fields: [{ name: "status", type: "text" }],
      retiredIndexes: [{ doctype: "Legacy Lead", fields: ["status"] }]
    });

    expect(() => planD1RetiredProjectionIndexes([CleanupA, CleanupB])).toThrow(
      "is planned for retirement by both DocType 'Cleanup A' and 'Cleanup B'"
    );
  });

  it("rejects malformed retired projection index metadata", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      retiredIndexes: [["old status", "old status"]]
    });

    expect(() => planD1RetiredProjectionIndexes([Task])).toThrow("repeats field 'old status'");
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

  it("keeps the checked-in Wrangler job execution migration exactly equivalent to the TypeScript plan", () => {
    const fileSql = readFileSync(new URL("../../migrations/0002_cf_frappe_job_executions.sql", import.meta.url), "utf8");

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_JOB_EXECUTION_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...jobExecutionMigrationStub, statements: [statement] }))
      )
    );
  });

  it("keeps the checked-in Wrangler job execution message migration exactly equivalent to the TypeScript plan", () => {
    const fileSql = readFileSync(new URL("../../migrations/0003_cf_frappe_job_execution_messages.sql", import.meta.url), "utf8");

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_JOB_EXECUTION_MESSAGE_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...jobExecutionMessageMigrationStub, statements: [statement] }))
      )
    );
  });

  it("keeps the checked-in Wrangler data patch migration exactly equivalent to the TypeScript plan", () => {
    const fileSql = readFileSync(new URL("../../migrations/0004_cf_frappe_data_patches.sql", import.meta.url), "utf8");

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_DATA_PATCH_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...dataPatchMigrationStub, statements: [statement] }))
      )
    );
  });

  it("keeps the checked-in Wrangler data patch rollback migration exactly equivalent to the TypeScript plan", () => {
    const fileSql = readFileSync(new URL("../../migrations/0005_cf_frappe_data_patch_rollbacks.sql", import.meta.url), "utf8");

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_DATA_PATCH_ROLLBACK_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...dataPatchRollbackMigrationStub, statements: [statement] }))
      )
    );
  });

  it("keeps the checked-in Wrangler automation run migration exactly equivalent to the TypeScript plan", () => {
    const fileSql = readFileSync(new URL("../../migrations/0006_cf_frappe_automation_runs.sql", import.meta.url), "utf8");

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_AUTOMATION_RUN_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...automationRunMigrationStub, statements: [statement] }))
      )
    );
  });

  it("keeps the checked-in Wrangler event document name migration exactly equivalent to the TypeScript plan", () => {
    // `wrangler d1 migrations apply` runs the file on disk while
    // `D1MigrationRunner` runs the planned statements, so the two can drift
    // apart silently without a guard per migration.
    const fileSql = readFileSync(
      new URL("../../migrations/0007_cf_frappe_events_document_name.sql", import.meta.url),
      "utf8"
    );

    expect(splitSqlStatements(fileSql)).toEqual(
      D1_EVENT_DOCUMENT_NAME_SCHEMA_STATEMENTS.map((statement) =>
        normalizeSql(renderD1Migration({ ...eventDocumentNameMigrationStub, statements: [statement] }))
      )
    );
  });
});

const coreMigrationStub = {
  id: D1_CORE_MIGRATION_ID,
  checksum: "test"
};

const jobExecutionMigrationStub = {
  id: D1_JOB_EXECUTION_MIGRATION_ID,
  checksum: "test"
};

const jobExecutionMessageMigrationStub = {
  id: D1_JOB_EXECUTION_MESSAGE_MIGRATION_ID,
  checksum: "test"
};

const dataPatchMigrationStub = {
  id: D1_DATA_PATCH_MIGRATION_ID,
  checksum: "test"
};

const dataPatchRollbackMigrationStub = {
  id: D1_DATA_PATCH_ROLLBACK_MIGRATION_ID,
  checksum: "test"
};

const automationRunMigrationStub = {
  id: D1_AUTOMATION_RUN_MIGRATION_ID,
  checksum: "test"
};

const eventDocumentNameMigrationStub = {
  id: D1_EVENT_DOCUMENT_NAME_MIGRATION_ID,
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
