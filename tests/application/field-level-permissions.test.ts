import {
  DashboardService,
  DocumentHistoryService,
  DocumentImportService,
  DocumentService,
  InMemoryDocumentStore,
  PrintService,
  QueryService,
  ReportService,
  SYSTEM_MANAGER_ROLE,
  SavedListFilterService,
  SavedReportService,
  createRegistry,
  defineDashboard,
  defineDocType,
  definePrintFormat,
  defineReport,
  deterministicIds,
  fixedClock
} from "../../src";
import type { Actor, FieldPermissionContext } from "../../src";
import { now } from "../helpers";

const hr: Actor = { id: "hr@example.com", roles: ["HR"], tenantId: "acme" };
const alice: Actor = { id: "alice@example.com", roles: ["Employee"], tenantId: "acme" };
const bob: Actor = { id: "bob@example.com", roles: ["Employee"], tenantId: "acme" };
const admin: Actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

const EmployeeRecord = defineDocType({
  name: "Employee Record",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "employee", type: "text", required: true },
    { name: "department", type: "text" },
    {
      name: "salary",
      type: "number",
      inListView: true,
      inListFilter: true,
      inGlobalSearch: true,
      permissions: [
        { roles: ["HR"], actions: ["read", "create", "update"] },
        {
          roles: ["Employee"],
          actions: ["read"],
          when: ({ actor, document }) => document?.data.employee === actor.id
        }
      ]
    },
    {
      name: "self_review",
      type: "longText",
      inListView: true,
      permissions: [
        { roles: ["HR"], actions: ["read", "create", "update"] },
        {
          roles: ["Employee"],
          actions: ["read", "create", "update"],
          when: ({ actor, document }) => document?.data.employee === actor.id
        }
      ]
    },
    {
      name: "internal_notes",
      type: "longText",
      inListView: true,
      inListFilter: true,
      inGlobalSearch: true,
      permissions: [{ roles: ["HR"], actions: ["read", "create", "update"] }]
    }
  ],
  formView: {
    sections: [
      { heading: "Profile", columns: 2, fields: ["title", "employee", "department"] },
      { heading: "Confidential", columns: 2, fields: ["salary", "self_review", "internal_notes"] }
    ]
  },
  listView: {
    columns: ["title", "salary", "self_review", "internal_notes"],
    filterFields: ["title", "salary", "internal_notes"]
  },
  permissions: [{ roles: ["Employee", "HR"], actions: ["read", "create", "update"] }]
});

const ExpenseLine = defineDocType({
  name: "Expense Line",
  fields: [
    { name: "description", type: "text", required: true },
    {
      name: "cost",
      type: "number",
      permissions: [{ roles: ["HR"], actions: ["read", "create", "update"] }]
    }
  ]
});

const ExpenseReport = defineDocType({
  name: "Expense Report",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "items", type: "table", tableOf: "Expense Line" }
  ],
  permissions: [{ roles: ["Employee", "HR"], actions: ["read", "create", "update"] }]
});

describe("field-level permissions", () => {
  it("redacts document fields per actor and document-conditioned field rules", async () => {
    const { documents, queries } = createFieldPermissionServices();
    await createEmployeeRecord(documents, "Alice Record", alice.id, 120_000);
    await createEmployeeRecord(documents, "Bob Record", bob.id, 130_000);

    const own = await queries.getDocument(alice, "Employee Record", "Alice Record");
    const other = await queries.getDocument(alice, "Employee Record", "Bob Record");
    const list = await queries.listDocuments(alice, "Employee Record", { orderBy: "title", order: "asc" });

    expect(own.data).toMatchObject({ title: "Alice Record", salary: 120_000, self_review: "Initial" });
    expect(own.data).not.toHaveProperty("internal_notes");
    expect(other.data).toMatchObject({ title: "Bob Record" });
    expect(other.data).not.toHaveProperty("salary");
    expect(other.data).not.toHaveProperty("self_review");
    expect(other.data).not.toHaveProperty("internal_notes");
    expect(list.data.map((document) => document.data)).toEqual([
      expect.objectContaining({ title: "Alice Record", salary: 120_000 }),
      expect.not.objectContaining({ salary: 130_000 })
    ]);
  });

  it("projects metadata and list controls without statically unreadable or conditionally queryable fields", async () => {
    const { queries } = createFieldPermissionServices();

    const meta = await queries.getEffectiveMeta(alice, "Employee Record");
    const form = await queries.getEffectiveFormView(alice, "Employee Record");
    const list = await queries.getEffectiveListView(alice, "Employee Record");

    expect(meta.fields.map((field) => field.name)).toEqual([
      "title",
      "employee",
      "department",
      "salary",
      "self_review"
    ]);
    expect(form.fields.map((field) => field.name)).toEqual([
      "title",
      "employee",
      "department",
      "salary",
      "self_review"
    ]);
    expect(list.columns.map((field) => field.name)).toEqual(["title", "salary", "self_review"]);
    expect(list.filterBuilderFields.map((field) => field.field)).toEqual([
      "title",
      "system.name",
      "system.docstatus",
      "system.createdAt",
      "system.updatedAt",
      "system.version"
    ]);
  });

  it("blocks filters and ordering on fields that are only conditionally readable", async () => {
    const { documents, queries } = createFieldPermissionServices();
    await createEmployeeRecord(documents, "Alice Record", alice.id, 120_000);

    await expect(
      queries.listDocuments(alice, "Employee Record", { filters: [{ field: "salary", operator: "gt", value: 1 }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter field 'salary' is not defined on Employee Record"
    });
    await expect(
      queries.listDocuments(alice, "Employee Record", { orderBy: "salary" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "List orderBy field 'salary' is not defined on Employee Record"
    });

    await expect(
      queries.listDocuments(hr, "Employee Record", { filters: [{ field: "salary", operator: "gt", value: 1 }] })
    ).resolves.toMatchObject({ total: 1, data: [expect.objectContaining({ name: "Alice Record" })] });
  });

  it("enforces field create and update permissions with condition context", async () => {
    const { documents, store } = createFieldPermissionServices();

    await expect(
      documents.create({
        actor: alice,
        doctype: "Employee Record",
        data: {
          title: "Alice Record",
          employee: alice.id,
          salary: 1
        }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "salary", code: "field_permission" })]
    });

    await createEmployeeRecord(documents, "Alice Record", alice.id, 120_000);
    await expect(
      documents.update({
        actor: alice,
        doctype: "Employee Record",
        name: "Alice Record",
        patch: { self_review: "Ready for review" }
      })
    ).resolves.toMatchObject({
      data: expect.objectContaining({ self_review: "Ready for review", salary: 120_000 })
    });
    await expect(
      documents.update({
        actor: bob,
        doctype: "Employee Record",
        name: "Alice Record",
        patch: { self_review: "Looks great" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "self_review", code: "field_permission" })]
    });
    await expect(
      documents.update({
        actor: alice,
        doctype: "Employee Record",
        name: "Alice Record",
        patch: { salary: 999_999 }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "salary", code: "field_permission" })]
    });
    await expect(store.get("acme", "Employee Record", "Alice Record")).resolves.toMatchObject({
      data: expect.objectContaining({ salary: 120_000, self_review: "Ready for review" })
    });
  });

  it("redacts and protects child table fields through the related DocType resolver", async () => {
    const { documents, queries } = createFieldPermissionServices(["report-1", "report-2"]);
    await documents.create({
      actor: hr,
      doctype: "Expense Report",
      data: {
        title: "Trip",
        items: [{ description: "Flight", cost: 500 }]
      }
    });

    await expect(queries.getDocument(alice, "Expense Report", "Trip")).resolves.toMatchObject({
      data: { title: "Trip", items: [{ description: "Flight" }] }
    });
    await expect(
      documents.update({
        actor: alice,
        doctype: "Expense Report",
        name: "Trip",
        patch: { items: [{ description: "Flight", cost: 600 }] }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "items[0].cost", code: "field_permission" })]
    });
  });

  it("redacts stale merge plans and rejects unauthorized merge fields before returning conflicts", async () => {
    const { documents } = createFieldPermissionServices([
      "merge-1",
      "merge-2",
      "merge-3",
      "merge-denied-1",
      "merge-denied-2"
    ]);
    await createEmployeeRecord(documents, "Bob Merge", bob.id, 130_000);
    await documents.update({
      actor: hr,
      doctype: "Employee Record",
      name: "Bob Merge",
      patch: { salary: 140_000, internal_notes: "sensitive remote note" }
    });

    const result = await documents.merge({
      actor: alice,
      doctype: "Employee Record",
      name: "Bob Merge",
      baseVersion: 1,
      patch: { department: "Support" }
    });

    expect(result).toMatchObject({
      status: "applied",
      plan: {
        localChangedFields: ["department"],
        remoteChangedFields: [],
        patch: { department: "Support" },
        unset: [],
        conflicts: []
      },
      document: {
        data: { title: "Bob Merge", employee: bob.id, department: "Support" }
      }
    });
    expect(JSON.stringify(result)).not.toContain("salary");
    expect(JSON.stringify(result)).not.toContain("140000");
    expect(JSON.stringify(result)).not.toContain("internal_notes");
    expect(JSON.stringify(result)).not.toContain("sensitive remote note");

    await createEmployeeRecord(documents, "Bob Merge Denied", bob.id, 130_000);
    await documents.update({
      actor: hr,
      doctype: "Employee Record",
      name: "Bob Merge Denied",
      patch: { salary: 140_000 }
    });
    await expect(
      documents.merge({
        actor: alice,
        doctype: "Employee Record",
        name: "Bob Merge Denied",
        baseVersion: 1,
        patch: { salary: 1 }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "salary", code: "field_permission" })]
    });
  });

  it("passes actor, action, tenant, document, field, and value into field permission conditions", async () => {
    const captured: Array<{
      readonly actor: string;
      readonly action: FieldPermissionContext["action"];
      readonly doctype: string;
      readonly document: string | undefined;
      readonly field: string;
      readonly tenantId: string | undefined;
      readonly value: FieldPermissionContext["value"] | undefined;
    }> = [];
    const Probe = defineDocType({
      name: "Probe",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "secret",
          type: "text",
          permissions: [
            {
              roles: ["Employee"],
              actions: ["read"],
              when: (context) => {
                captured.push({
                  actor: context.actor.id,
                  action: context.action,
                  doctype: context.doctype.name,
                  document: context.document?.name,
                  field: context.field.name,
                  tenantId: context.tenantId,
                  value: context.value
                });
                return true;
              }
            },
            { roles: ["HR"], actions: ["read", "create", "update"] }
          ]
        }
      ],
      permissions: [{ roles: ["Employee", "HR"], actions: ["read", "create"] }]
    });
    const store = new InMemoryDocumentStore();
    const registry = createRegistry({ doctypes: [Probe] });
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["probe-1"])
    });
    const queries = new QueryService({ registry, projections: store });

    await documents.create({ actor: hr, doctype: "Probe", data: { title: "P-1", secret: "context-value" } });
    await queries.getDocument(alice, "Probe", "P-1");

    expect(captured).toEqual([
      {
        actor: alice.id,
        action: "read",
        doctype: "Probe",
        document: "P-1",
        field: "secret",
        tenantId: "acme",
        value: "context-value"
      }
    ]);
  });

  it("lets System Manager bypass field-level rules", async () => {
    const { documents, queries } = createFieldPermissionServices(["admin-1"]);

    await documents.create({
      actor: admin,
      doctype: "Employee Record",
      data: {
        title: "Admin Record",
        employee: admin.id,
        salary: 1,
        internal_notes: "visible"
      }
    });

    await expect(queries.getDocument(admin, "Employee Record", "Admin Record")).resolves.toMatchObject({
      data: expect.objectContaining({ salary: 1, internal_notes: "visible" })
    });
  });

  it("redacts timeline changes, payloads, and metadata through the same field policy", async () => {
    const { documents, history } = createFieldPermissionServices(["timeline-1", "timeline-2"]);
    await createEmployeeRecord(documents, "Bob Record", bob.id, 130_000);
    await documents.update({
      actor: hr,
      doctype: "Employee Record",
      name: "Bob Record",
      patch: { salary: 140_000, internal_notes: "sensitive", department: "Support" },
      metadata: { privateReason: "comp-review" }
    });

    const timeline = await history.getTimeline(alice, "Employee Record", "Bob Record");

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[0]?.payload).toMatchObject({
      kind: "DocumentCreated",
      data: expect.not.objectContaining({ salary: 130_000, internal_notes: "HR-only" })
    });
    expect(timeline.entries[1]).toMatchObject({
      payload: { kind: "DocumentUpdated", patch: { department: "Support" } },
      metadata: {},
      changes: [{ field: "department", oldValue: "Engineering", newValue: "Support" }]
    });
    expect(JSON.stringify(timeline)).not.toContain("140000");
    expect(JSON.stringify(timeline)).not.toContain("sensitive");
    expect(JSON.stringify(timeline)).not.toContain("comp-review");
  });

  it("blocks saved filters and saved report query surfaces for non-queryable fields", async () => {
    const { savedFilters, savedReports } = createFieldPermissionServices();

    await expect(
      savedFilters.save({
        actor: alice,
        doctype: "Employee Record",
        label: "Salary filter",
        filters: [{ field: "salary", operator: "gt", value: 1 }]
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter field 'salary' is not defined on Employee Record"
    });

    await expect(
      savedReports.save({
        actor: alice,
        doctype: "Employee Record",
        label: "Salary report",
        definition: {
          columns: [{ name: "title" }],
          filters: [{ name: "salary", field: "salary", operator: "gte" }]
        }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("hides reports, dashboards, and print metadata that reference unreadable fields", async () => {
    const ConfidentialReport = defineReport({
      name: "Confidential Employees",
      doctype: "Employee Record",
      columns: [{ name: "title" }, { name: "internal_notes" }],
      roles: ["Employee", "HR"]
    });
    const SalaryDashboard = defineDashboard({
      name: "Salary Metrics",
      roles: ["Employee", "HR"],
      cards: [
        {
          name: "salary_sum",
          source: { kind: "documentAggregate", doctype: "Employee Record", aggregate: "sum", field: "salary" }
        }
      ]
    });
    const ConfidentialPrint = definePrintFormat({
      name: "Employee Confidential",
      doctype: "Employee Record",
      sections: [
        {
          fields: [
            { field: "title" },
            { field: "internal_notes", label: "Internal Notes" }
          ]
        }
      ],
      template: "Notes: {{ doc.internal_notes }}",
      roles: ["Employee", "HR"]
    });
    const registry = createRegistry({
      doctypes: [EmployeeRecord, ExpenseLine, ExpenseReport],
      reports: [ConfidentialReport],
      dashboards: [SalaryDashboard],
      printFormats: [ConfidentialPrint]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["employee-1"])
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });
    const prints = new PrintService({ registry, queries });
    await createEmployeeRecord(documents, "Alice Record", alice.id, 120_000);

    expect(reports.listReports(alice)).toEqual([]);
    expect(() => reports.getReport(alice, "Confidential Employees")).toThrow("cannot read report");
    await expect(dashboards.listDashboards(alice)).resolves.toEqual([]);
    await expect(dashboards.runDashboard(alice, "Salary Metrics")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    expect(prints.listPrintFormats(alice)).toMatchObject([
      {
        name: "Employee Confidential",
        sections: [{ fields: [{ field: "title" }] }]
      }
    ]);
    expect(prints.listPrintFormats(alice)[0]).not.toHaveProperty("template");
    await expect(prints.printDocument(alice, "Employee Confidential", "Alice Record")).resolves.toMatchObject({
      format: {
        sections: [{ fields: [{ field: "title" }] }]
      },
      sections: [{ fields: [{ field: "title", value: "Alice Record" }] }]
    });
  });

  it("limits field-permission bypassing domain commands to System Manager actors", async () => {
    const ProtectedCommand = defineDocType({
      name: "Protected Command",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "secret",
          type: "text",
          permissions: [{ roles: ["HR"], actions: ["read", "create", "update"] }]
        }
      ],
      permissions: [{ roles: ["Employee", "HR"], actions: ["read", "create", "update"] }],
      commands: [
        {
          name: "setSecret",
          eventType: "ProtectedCommandSecretSet",
          fields: ["secret"],
          bypassFieldPermissions: true
        }
      ]
    });
    const registry = createRegistry({ doctypes: [ProtectedCommand] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["protected-1", "protected-2"])
    });

    await documents.create({ actor: alice, doctype: "Protected Command", data: { title: "P-1" } });
    await expect(
      documents.execute({
        actor: alice,
        doctype: "Protected Command",
        name: "P-1",
        command: "setSecret",
        input: { secret: "classified" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "secret", code: "field_permission" })]
    });
    await expect(
      documents.execute({
        actor: admin,
        doctype: "Protected Command",
        name: "P-1",
        command: "setSecret",
        input: { secret: "classified" }
      })
    ).resolves.toMatchObject({
      data: expect.objectContaining({ secret: "classified" })
    });
  });

  it("uses create and update field projections for import headers", async () => {
    const ImportAcl = defineDocType({
      name: "Import ACL",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "create_only",
          type: "text",
          permissions: [{ roles: ["Employee"], actions: ["read", "create"] }]
        },
        {
          name: "update_only",
          type: "text",
          permissions: [{ roles: ["Employee"], actions: ["read", "update"] }]
        }
      ],
      permissions: [{ roles: ["Employee"], actions: ["read", "create", "update"] }]
    });
    const registry = createRegistry({ doctypes: [ImportAcl] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["import-1"])
    });
    const queries = new QueryService({ registry, projections: store });
    const imports = new DocumentImportService({ documents, queries });

    await expect(
      imports.importCsv({
        actor: alice,
        doctype: "Import ACL",
        csv: ["title,update_only", "Import Target,not-on-create"].join("\n")
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CSV import header 'update_only' is not a field on Import ACL"
    });
    await expect(
      imports.importCsv({
        actor: alice,
        doctype: "Import ACL",
        mode: "update",
        csv: ["name,expectedVersion,create_only", "Import Target,1,not-on-update"].join("\n")
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CSV import header 'create_only' is not a field on Import ACL"
    });
  });
});

function createFieldPermissionServices(ids: readonly string[] = [
  "employee-1",
  "employee-2",
  "employee-3",
  "employee-4",
  "employee-5",
  "employee-6"
]) {
  const registry = createRegistry({ doctypes: [EmployeeRecord, ExpenseLine, ExpenseReport] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(ids)
  });
  const queries = new QueryService({ registry, projections: store });
  const reports = new ReportService({ registry, queries });
  const history = new DocumentHistoryService({ events: store, queries });
  const savedFilters = new SavedListFilterService({
    registry,
    events: store,
    clock: fixedClock(now),
    ids: deterministicIds(["filter-1", "filter-event-1", "filter-event-2"])
  });
  const savedReports = new SavedReportService({
    registry,
    events: store,
    reports,
    clock: fixedClock(now),
    ids: deterministicIds(["report-1", "report-event-1", "report-event-2"])
  });
  return { registry, store, documents, queries, reports, history, savedFilters, savedReports };
}

async function createEmployeeRecord(
  documents: DocumentService,
  title: string,
  employee: string,
  salary: number
) {
  return documents.create({
    actor: hr,
    doctype: "Employee Record",
    data: {
      title,
      employee,
      department: "Engineering",
      salary,
      self_review: "Initial",
      internal_notes: "HR-only"
    }
  });
}
