import { defineDocType, planD1ProjectionIndexes, renderD1ProjectionIndexMigration } from "../../src";

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

    expect(planD1ProjectionIndexes([Task])).toEqual([
      {
        name: "idx_cf_frappe_documents_task_status",
        sql:
          "CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_task_status " +
          "ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.status')) " +
          "WHERE doctype = 'Task';"
      },
      {
        name: "idx_cf_frappe_documents_task_owner_status",
        sql:
          "CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_task_owner_status " +
          "ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.owner'), json_extract(data_json, '$.status')) " +
          "WHERE doctype = 'Task';"
      }
    ]);
  });

  it("renders migration text for multiple statements", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }],
      indexes: [["status"]]
    });

    expect(renderD1ProjectionIndexMigration([Task])).toContain("CREATE INDEX IF NOT EXISTS");
  });
});
