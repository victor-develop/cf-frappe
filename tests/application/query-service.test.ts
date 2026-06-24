import { createLinkedServices, createServices, data, guest, owner } from "../helpers";
import { applyCustomFieldsToDocType, createRegistry, defineDocType, InMemoryDocumentStore, QueryService } from "../../src";
import type { ProjectionStore } from "../../src";

describe("QueryService", () => {
  it("lists readable doctypes", () => {
    const { queries } = createServices();

    expect(queries.listDoctypes(guest).map((doctype) => doctype.name)).toEqual(["Note"]);
  });

  it("gets a single document by projection", async () => {
    const { documents, queries } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      name: "My Note"
    });
  });

  it("resolves metadata-driven form views through the query boundary", () => {
    const { queries } = createServices();

    expect(queries.getFormView(owner, "Note").sections).toMatchObject([
      { heading: "Summary", columns: 1, fields: [{ name: "title" }, { name: "priority" }] },
      { heading: "Details", columns: 2, fields: [{ name: "body" }, { name: "count" }, { name: "workflow_state" }] }
    ]);
  });

  it("hides deleted documents from list results", async () => {
    const { documents, queries } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });
    await documents.delete({ actor: { ...owner, roles: ["Task Manager"] }, doctype: "Note", name: "My Note" });

    await expect(queries.listDocuments(guest, "Note")).resolves.toMatchObject({ data: [], total: 1 });
  });

  it("filters list results through metadata-validated scalar fields", async () => {
    const { documents, queries } = createServices(["e1", "e2", "e3"]);
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Urgent Launch", priority: "High", body: "Launch report", count: 7 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Routine Check", priority: "Low", body: "Maintenance note", count: 1 })
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", value: "High" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "contains", value: "report" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "like", value: "Launch%" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "like", value: "\\L%" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "like", value: "Launch report\\" }] })
    ).resolves.toMatchObject({ data: [], total: 0 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "not_like", value: "%note%" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "gte", value: "2" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", operator: "ne", value: "Low" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", operator: "in", value: ["High", "Medium"] }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", operator: "not_in", value: ["Low"] }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", {
        filters: [
          { field: "count", operator: "gt", value: 2 },
          { field: "count", operator: "lt", value: 9 }
        ]
      })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });
  });

  it("filters list results through nested compound expressions", async () => {
    const { documents, queries } = createServices(["e1", "e2", "e3", "e4"]);
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Open", priority: "High", workflow_state: "Open", count: 10 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Count Open", priority: "Low", workflow_state: "Open", count: 3 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Count Closed", priority: "Low", workflow_state: "Closed", count: 3 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Miss Open", priority: "Medium", workflow_state: "Open", count: 9 })
    });

    const result = await queries.listDocuments(owner, "Note", {
      filters: [{ field: "workflow_state", value: "Open" }],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "priority", value: "High" },
          {
            kind: "group",
            match: "all",
            filters: [
              { field: "count", operator: "gte", value: "2" },
              { field: "count", operator: "lte", value: "4" }
            ]
          }
        ]
      }
    });

    expect(result.total).toBe(2);
    expect(result.data.map((document) => document.name).sort()).toEqual(["Count Open", "High Open"]);
  });

  it("filters list results through inclusive between ranges", async () => {
    const { documents, queries } = createServices(["e1", "e2", "e3"]);
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "In Range", priority: "High", body: "Launch report", count: 7 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Too Low", priority: "Low", body: "Maintenance note", count: 1 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Too High", priority: "Medium", body: "Escalated note", count: 9 })
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "between", value: ["2", "7"] }] })
    ).resolves.toMatchObject({ data: [{ name: "In Range" }], total: 1 });

    const notBetween = await queries.listDocuments(owner, "Note", {
      filters: [{ field: "count", operator: "not_between", value: ["2", "7"] }]
    });
    expect(notBetween.total).toBe(2);
    expect(notBetween.data.map((document) => document.name).sort()).toEqual(["Too High", "Too Low"]);
  });

  it("filters list results through presence checks", async () => {
    const { projections, queries } = createServices();
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Body Set",
      version: 1,
      docstatus: "draft",
      data: { title: "Body Set", body: "Body", created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Body Empty",
      version: 1,
      docstatus: "draft",
      data: { title: "Body Empty", body: "", created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Body Missing",
      version: 1,
      docstatus: "draft",
      data: { title: "Body Missing", created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const set = await queries.listDocuments(owner, "Note", {
      filters: [{ field: "body", operator: "is", value: "set" }]
    });
    expect(set.data.map((document) => document.name).sort()).toEqual(["Body Empty", "Body Set"]);
    expect(set.total).toBe(2);

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "is", value: "not set" }] })
    ).resolves.toMatchObject({ data: [{ name: "Body Missing" }], total: 1 });
  });

  it("filters list results through metadata-validated system fields", async () => {
    const { projections, queries } = createServices();
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Old Draft",
      version: 1,
      docstatus: "draft",
      data: data({ title: "Old Draft", created_by: owner.id }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "New Submitted",
      version: 3,
      docstatus: "submitted",
      data: data({ title: "New Submitted", created_by: owner.id }),
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "system.docstatus", value: "submitted" }] })
    ).resolves.toMatchObject({ data: [{ name: "New Submitted" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "system.name", operator: "contains", value: "old" }] })
    ).resolves.toMatchObject({ data: [{ name: "Old Draft" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "system.updatedAt", operator: "gte", value: "2026-01-04T00:00:00.000Z" }] })
    ).resolves.toMatchObject({ data: [{ name: "New Submitted" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "system.version", operator: "gt", value: "1" }] })
    ).resolves.toMatchObject({ data: [{ name: "New Submitted" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", {
        filters: [
          {
            field: "system.updatedAt",
            operator: "between",
            value: ["2026-01-04T00:00:00.000Z", "2026-01-06T00:00:00.000Z"]
          }
        ]
      })
    ).resolves.toMatchObject({ data: [{ name: "New Submitted" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", {
        filters: [
          {
            field: "system.updatedAt",
            operator: "not_between",
            value: ["2026-01-03T00:00:00.000Z", "2026-01-06T00:00:00.000Z"]
          }
        ]
      })
    ).resolves.toMatchObject({ data: [{ name: "Old Draft" }], total: 1 });
  });

  it("keeps system filters namespaced from DocType fields with the same names", async () => {
    const Collision = defineDocType({
      name: "Collision",
      fields: [
        { name: "name", type: "text", inListFilter: true },
        { name: "version", type: "text", inListFilter: true }
      ],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const projections = new InMemoryDocumentStore();
    const queries = new QueryService({
      registry: createRegistry({ doctypes: [Collision] }),
      projections
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Collision",
      name: "System Row",
      version: 7,
      docstatus: "draft",
      data: { name: "Data Name", version: "Data Version" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const dataName = await queries.listDocuments(owner, "Collision", {
      filters: [{ field: "name", operator: "contains", value: "data" }]
    });
    expect(dataName).toMatchObject({ data: [{ name: "System Row" }], total: 1 });

    const systemName = await queries.listDocuments(owner, "Collision", {
      filters: [{ field: "system.name", operator: "contains", value: "system" }]
    });
    expect(systemName).toMatchObject({ data: [{ name: "System Row" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Collision", { filters: [{ field: "version", operator: "contains", value: "Data" }] })
    ).resolves.toMatchObject({ data: [{ name: "System Row" }], total: 1 });
    await expect(
      queries.listDocuments(owner, "Collision", { filters: [{ field: "system.version", operator: "gt", value: "6" }] })
    ).resolves.toMatchObject({ data: [{ name: "System Row" }], total: 1 });
  });

  it("rejects list filters that are not declared by the DocType", async () => {
    const { queries } = createServices();

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "missing", value: "x" }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter field 'missing' is not defined on Note"
    });
  });

  it("rejects list filters that cannot be coerced to field types", async () => {
    const { queries } = createServices();

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "gte", value: "many" }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'count' must be an integer"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "contains", value: "2" }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'count' does not support contains"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", operator: "in", value: [] }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'priority' must include at least one value"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", value: ["High"] }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'priority' must use a scalar value for eq"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "between", value: ["1"] }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'count' must include exactly two values for between"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "not_between", value: ["1"] }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'count' must include exactly two values for not_between"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "between", value: [" ", "7"] }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'count' range values cannot be empty"
    });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "body", operator: "is", value: "present" }] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Filter 'body' must be set or not set"
    });
  });

  it("orders list results through metadata-validated fields", async () => {
    const Ticket = defineDocType({
      name: "Ticket",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "rank", type: "integer" },
        { name: "secret_rank", type: "integer", hidden: true },
        { name: "payload", type: "json" }
      ],
      listView: {
        columns: ["title", "rank"],
        orderBy: "rank",
        order: "asc"
      },
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const projections = new InMemoryDocumentStore();
    const queries = new QueryService({
      registry: createRegistry({ doctypes: [Ticket] }),
      projections
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Ticket",
      name: "Later",
      version: 1,
      docstatus: "draft",
      data: { title: "Later", rank: 2 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Ticket",
      name: "Sooner",
      version: 1,
      docstatus: "draft",
      data: { title: "Sooner", rank: 1 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const view = await queries.listDocumentsForView(owner, "Ticket");
    expect(view.listView).toMatchObject({ orderBy: "rank", order: "asc" });
    expect(view.result.data.map((document) => document.name)).toEqual(["Sooner", "Later"]);

    const override = await queries.listDocumentsForView(owner, "Ticket", { orderBy: "name", order: "desc" });
    expect(override.listView).toMatchObject({ orderBy: "name", order: "desc" });
    expect(override.result.data.map((document) => document.name)).toEqual(["Sooner", "Later"]);

    await expect(queries.listDocuments(owner, "Ticket", { orderBy: "payload" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "List orderBy field 'payload' cannot be a json field"
    });
    await expect(queries.listDocuments(owner, "Ticket", { orderBy: "secret_rank" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "List orderBy field 'secret_rank' is hidden on Ticket"
    });
  });

  it("exports metadata list views as bounded escaped CSV", async () => {
    const { documents, queries } = createServices(["csv1", "csv2", "csv3"]);
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "CSV Low", priority: "Low", body: "Routine", count: 1 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "=CSV High", priority: "High", body: "Escaped", count: 7 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "CSV Closed", priority: "High", workflow_state: "Closed", body: "Hidden", count: 2 })
    });

    const csv = await queries.exportDocumentsCsv(owner, "Note", {
      filters: [{ field: "priority", value: "High" }],
      orderBy: "count",
      order: "desc",
      limit: 1
    });

    expect(csv).toMatchObject({
      filename: "Note.csv",
      contentType: "text/csv; charset=utf-8",
      exported: 1,
      total: 1,
      truncated: false,
      limit: 1
    });
    expect(csv.body).toBe("Name,title,priority,workflow_state,Version,Updated\n'=CSV High,'=CSV High,High,Open,1,2026-01-01T00:00:00.000Z");

    const allCsv = await queries.exportDocumentsCsv(owner, "Note", {
      useDefaultFilters: false,
      filters: [{ field: "priority", value: "High" }],
      orderBy: "count",
      order: "asc",
      limit: 1
    });
    expect(allCsv).toMatchObject({ exported: 1, total: 2, truncated: true });
    expect(allCsv.body).toBe("Name,title,priority,workflow_state,Version,Updated\nCSV Closed,CSV Closed,High,Closed,1,2026-01-01T00:00:00.000Z");
  });

  it("lets CSV exports use the export limit without raising the list-page cap", async () => {
    const { projections, queries } = createServices();
    for (let index = 1; index <= 201; index += 1) {
      const name = `Bulk Note ${String(index).padStart(3, "0")}`;
      await projections.save({
        tenantId: "acme",
        doctype: "Note",
        name,
        version: 1,
        docstatus: "draft",
        data: data({ title: name, workflow_state: "Open", created_by: owner.id }),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
    }

    const list = await queries.listDocuments(owner, "Note", { limit: 10_000 });
    expect(list.limit).toBe(200);
    expect(list.data).toHaveLength(200);

    const csv = await queries.exportDocumentsCsv(owner, "Note");
    expect(csv).toMatchObject({
      exported: 201,
      total: 201,
      truncated: false,
      limit: 10_000
    });
    expect(csv.body.split("\n")).toHaveLength(202);
  });

  it("lists readable link options for link fields", async () => {
    const { documents, queries } = createLinkedServices(["p1", "p2"]);
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });

    await expect(
      queries.listLinkOptions(owner, "Task", "project", { q: "apo" })
    ).resolves.toEqual({
      doctype: "Task",
      field: "project",
      target: "Project",
      options: [{ value: "Apollo", label: "Apollo" }]
    });
  });

  it("applies event-sourced user permissions to linked documents and link options", async () => {
    const { documents, queries, userPermissions } = createLinkedServices(["p1", "p2", "t1", "t2"]);
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Apollo Task", project: "Apollo", description: "Allowed" }
    });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Zeus Task", project: "Zeus", description: "Denied" }
    });
    await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo"
    });

    await expect(queries.getDocument(owner, "Project", "Apollo")).resolves.toMatchObject({ name: "Apollo" });
    await expect(queries.getDocument(owner, "Project", "Zeus")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(queries.listDocuments(owner, "Project")).resolves.toMatchObject({
      data: [{ name: "Apollo" }],
      total: 2
    });
    await expect(queries.listDocuments(owner, "Task")).resolves.toMatchObject({
      data: [{ name: "Apollo Task" }],
      total: 2
    });
    await expect(queries.listLinkOptions(owner, "Task", "project")).resolves.toMatchObject({
      options: [{ value: "Apollo", label: "Apollo" }]
    });
  });

  it("limits user-permission grants to explicitly applicable DocTypes when configured", async () => {
    const { documents, queries, userPermissions } = createLinkedServices(["p1", "p2", "t1", "t2"]);
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Apollo Task", project: "Apollo", description: "Allowed" }
    });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Zeus Task", project: "Zeus", description: "Still visible" }
    });
    await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Project"]
    });

    await expect(queries.listDocuments(owner, "Project")).resolves.toMatchObject({
      data: [{ name: "Apollo" }],
      total: 2
    });
    await expect(queries.listDocuments(owner, "Task")).resolves.toMatchObject({
      data: [{ name: "Apollo Task" }, { name: "Zeus Task" }],
      total: 2
    });
    await expect(queries.listLinkOptions(owner, "Task", "project")).resolves.toMatchObject({
      options: [
        { value: "Apollo", label: "Apollo" },
        { value: "Zeus", label: "Zeus" }
      ]
    });
  });

  it("applies source-scoped user permissions to link options", async () => {
    const { documents, queries, userPermissions } = createLinkedServices(["p1", "p2", "t1", "t2"]);
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Apollo Task", project: "Apollo", description: "Allowed" }
    });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Zeus Task", project: "Zeus", description: "Denied" }
    });
    await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Task"]
    });

    await expect(queries.listDocuments(owner, "Project")).resolves.toMatchObject({
      data: [{ name: "Apollo" }, { name: "Zeus" }],
      total: 2
    });
    await expect(queries.listDocuments(owner, "Task")).resolves.toMatchObject({
      data: [{ name: "Apollo Task" }],
      total: 2
    });
    await expect(queries.listLinkOptions(owner, "Task", "project")).resolves.toMatchObject({
      options: [{ value: "Apollo", label: "Apollo" }]
    });
  });

  it("omits unreadable target documents from link options", async () => {
    const { documents, queries } = createLinkedServices(["p1"]);
    const other = { ...owner, id: "other@example.com" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Secret" } });

    await expect(queries.listLinkOptions(other, "Task", "project")).resolves.toMatchObject({
      options: []
    });
  });

  it("fills default link options beyond unreadable projection pages", async () => {
    const { projections, queries } = createLinkedServices();
    for (let index = 0; index < 200; index += 1) {
      await saveProjectedProject(projections, `Secret ${index}`, "other@example.com", "2026-01-02T00:00:00.000Z");
    }
    await saveProjectedProject(projections, "Readable", owner.id, "2026-01-01T00:00:00.000Z");

    await expect(queries.listLinkOptions(owner, "Task", "project", { limit: 1 })).resolves.toMatchObject({
      options: [{ value: "Readable", label: "Readable" }]
    });
  });

  it("continues searching link options beyond the first projection page", async () => {
    const { projections, queries } = createLinkedServices();
    for (let index = 0; index < 200; index += 1) {
      await saveProjectedProject(projections, `Project ${index}`, owner.id, "2026-01-02T00:00:00.000Z");
    }
    await saveProjectedProject(projections, "Needle", owner.id, "2026-01-01T00:00:00.000Z");

    await expect(queries.listLinkOptions(owner, "Task", "project", { q: "needle", limit: 1 })).resolves.toMatchObject({
      options: [{ value: "Needle", label: "Needle" }]
    });
  });

  it("searches readable documents across metadata global-search fields", async () => {
    const SearchNote = defineDocType({
      name: "Search Note",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "longText", inGlobalSearch: true },
        { name: "internal_code", type: "text" },
        { name: "created_by", type: "text" }
      ],
      permissions: [
        {
          roles: ["User"],
          actions: ["read"],
          when: ({ actor, document }) => !document || document.data.created_by === actor.id
        }
      ]
    });
    const SearchProject = defineDocType({
      name: "Search Project",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "summary", type: "longText", inGlobalSearch: true },
        { name: "created_by", type: "text" }
      ],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const registry = createRegistry({ doctypes: [SearchNote, SearchProject] });
    const projections = new InMemoryDocumentStore();
    const queries = new QueryService({ registry, projections });
    await projections.save({
      tenantId: "acme",
      doctype: "Search Note",
      name: "Launch Plan",
      version: 1,
      docstatus: "draft",
      data: {
        title: "Launch Plan",
        body: "Coordinate Saturn release",
        internal_code: "not-secret",
        created_by: owner.id
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Search Project",
      name: "Saturn Project",
      version: 1,
      docstatus: "draft",
      data: {
        title: "Saturn Project",
        summary: "Mission planning",
        created_by: "other@example.com"
      },
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Search Note",
      name: "Private Note",
      version: 1,
      docstatus: "draft",
      data: {
        title: "Private Note",
        body: "Saturn unreadable",
        internal_code: "not-secret",
        created_by: "other@example.com"
      },
      createdAt: "2026-01-01T00:00:02.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Search Note",
      name: "Internal Only",
      version: 1,
      docstatus: "draft",
      data: {
        title: "Internal Only",
        body: "Visible body",
        internal_code: "saturn-hidden",
        created_by: owner.id
      },
      createdAt: "2026-01-01T00:00:03.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z"
    });

    await expect(queries.search(owner, { q: "saturn" })).resolves.toMatchObject({
      query: "saturn",
      limit: 20,
      total: 2,
      data: [
        {
          doctype: "Search Project",
          name: "Saturn Project",
          label: "Saturn Project",
          matchedField: "name",
          matchedText: "Saturn Project",
          route: "/desk/Search%20Project/Saturn%20Project"
        },
        {
          doctype: "Search Note",
          name: "Launch Plan",
          label: "Launch Plan",
          matchedField: "body",
          matchedText: "Coordinate Saturn release",
          route: "/desk/Search%20Note/Launch%20Plan"
        }
      ]
    });
    await expect(queries.search(owner, { q: "saturn", limit: 1 })).resolves.toMatchObject({
      total: 2,
      data: [{ doctype: "Search Project", name: "Saturn Project" }]
    });
    await expect(queries.search(owner, { q: "  " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Search query is required"
    });
  });

  it("rejects link option lookups for non-link fields", async () => {
    const { queries } = createLinkedServices();

    await expect(queries.listLinkOptions(owner, "Task", "title")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Field 'title' on Task is not a link field"
    });
  });

  it("applies DocType list-view defaults only for generated list views", async () => {
    const { documents, queries } = createServices(["e1", "e2"]);
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Open Note", workflow_state: "Open" })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Closed Note", workflow_state: "Closed" })
    });

    const raw = await queries.listDocuments(owner, "Note");
    expect(raw.total).toBe(2);
    expect(raw.data.map((document) => document.name).sort()).toEqual(["Closed Note", "Open Note"]);

    const view = await queries.listDocumentsForView(owner, "Note");

    expect(view.listView.columns.map((field) => field.name)).toEqual(["title", "priority", "workflow_state"]);
    expect(view.listView.filterBuilderFields.map((field) => field.field)).toEqual([
      "title",
      "priority",
      "workflow_state",
      "count",
      "system.name",
      "system.docstatus",
      "system.createdAt",
      "system.updatedAt",
      "system.version"
    ]);
    expect(view.listView.filterBuilderFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "title",
        inputType: "text",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" },
          { operator: "contains", label: "contains" },
          { operator: "like", label: "like" },
          { operator: "not_like", label: "not like" }
        ]
      }),
      expect.objectContaining({
        field: "priority",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" }
        ]
      }),
      expect.objectContaining({
        field: "workflow_state",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" }
        ]
      }),
      expect.objectContaining({
        field: "count",
        inputType: "number",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" },
          { operator: "gt", label: "greater than" },
          { operator: "gte", label: "greater than or equal" },
          { operator: "lt", label: "less than" },
          { operator: "lte", label: "less than or equal" },
          { operator: "between", label: "between" },
          { operator: "not_between", label: "not between" }
        ]
      }),
      expect.objectContaining({
        field: "system.docstatus",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" }
        ]
      }),
      expect.objectContaining({
        field: "system.updatedAt",
        inputType: "datetime-local",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" },
          { operator: "gt", label: "greater than" },
          { operator: "gte", label: "greater than or equal" },
          { operator: "lt", label: "less than" },
          { operator: "lte", label: "less than or equal" },
          { operator: "between", label: "between" },
          { operator: "not_between", label: "not between" }
        ]
      })
    ]));
    expect(view.listView.filterControls).toEqual([
      expect.objectContaining({ field: "title", inputType: "text", operator: "contains", queryKey: "filter_title__contains" }),
      expect.objectContaining({ field: "title", inputType: "text", operator: "ne", queryKey: "filter_title__ne" }),
      expect.objectContaining({ field: "priority", inputType: "select", operator: "eq", queryKey: "filter_priority" }),
      expect.objectContaining({ field: "priority", inputType: "select", operator: "ne", queryKey: "filter_priority__ne" }),
      expect.objectContaining({ field: "workflow_state", inputType: "select", operator: "eq", queryKey: "filter_workflow_state" }),
      expect.objectContaining({ field: "workflow_state", inputType: "select", operator: "ne", queryKey: "filter_workflow_state__ne" }),
      expect.objectContaining({ field: "count", inputType: "number", operator: "gte", queryKey: "filter_count__gte" }),
      expect.objectContaining({ field: "count", inputType: "number", operator: "lte", queryKey: "filter_count__lte" })
    ]);
    expect(view.result).toMatchObject({
      data: [{ name: "Open Note" }],
      limit: 25,
      total: 1
    });

    const closedView = await queries.listDocumentsForView(owner, "Note", {
      filters: [{ field: "workflow_state", value: "Closed" }]
    });
    expect(closedView.filters).toEqual([{ field: "workflow_state", value: "Closed" }]);
    expect(closedView.result).toMatchObject({
      data: [{ name: "Closed Note" }],
      total: 1
    });

    const allView = await queries.listDocumentsForView(owner, "Note", { useDefaultFilters: false });
    expect(allView.result.total).toBe(2);
  });

  it("resolves tenant-extended DocTypes for metadata and list filtering", async () => {
    const { registry, projections } = createServices();
    const queries = new QueryService({
      registry,
      projections,
      doctypeResolver: (base, { tenantId }) =>
        tenantId === "acme"
          ? applyCustomFieldsToDocType(base, {
              tenantId,
              doctype: base.name,
              version: 1,
              fields: [
                {
                  tenantId,
                  doctype: base.name,
                  enabled: true,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  field: {
                    name: "reviewed",
                    label: "Reviewed",
                    type: "boolean",
                    inFormView: true,
                    inListView: true,
                    inListFilter: true
                  }
                }
              ]
            })
          : base
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Reviewed Note",
      version: 1,
      docstatus: "draft",
      data: data({ title: "Reviewed Note", workflow_state: "Open", created_by: owner.id, reviewed: true }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Queued Note",
      version: 1,
      docstatus: "draft",
      data: data({ title: "Queued Note", workflow_state: "Open", created_by: owner.id, reviewed: false }),
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });

    await expect(queries.getEffectiveMeta(owner, "Note")).resolves.toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ name: "reviewed", type: "boolean" })])
    });
    await expect(queries.getEffectiveFormView(owner, "Note")).resolves.toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ name: "reviewed" })])
    });
    const view = await queries.listDocumentsForView(owner, "Note", {
      filters: [{ field: "reviewed", value: true }]
    });

    expect(view.listView.columns.map((field) => field.name)).toContain("reviewed");
    expect(view.listView.filterBuilderFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "reviewed", inputType: "boolean" })])
    );
    expect(view.result).toMatchObject({
      data: [{ name: "Reviewed Note" }],
      total: 1
    });
  });
});

async function saveProjectedProject(
  projections: ProjectionStore,
  name: string,
  ownerId: string,
  updatedAt: string
): Promise<void> {
  await projections.save({
    tenantId: "acme",
    doctype: "Project",
    name,
    version: 1,
    docstatus: "draft",
    data: { title: name, created_by: ownerId },
    createdAt: updatedAt,
    updatedAt
  });
}
