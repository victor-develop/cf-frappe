import { createLinkedServices, createServices, data, guest, owner } from "../helpers";
import { applyCustomFieldsToDocType, QueryService } from "../../src";
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
      queries.listDocuments(owner, "Note", { filters: [{ field: "count", operator: "gte", value: "2" }] })
    ).resolves.toMatchObject({ data: [{ name: "Urgent Launch" }], total: 1 });

    await expect(
      queries.listDocuments(owner, "Note", { filters: [{ field: "priority", operator: "ne", value: "Low" }] })
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
    expect(view.listView.filterBuilderFields).toEqual([
      expect.objectContaining({
        field: "title",
        inputType: "text",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "contains", label: "contains" }
        ]
      }),
      expect.objectContaining({
        field: "priority",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" }
        ]
      }),
      expect.objectContaining({
        field: "workflow_state",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" }
        ]
      }),
      expect.objectContaining({
        field: "count",
        inputType: "number",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "gt", label: "greater than" },
          { operator: "gte", label: "greater than or equal" },
          { operator: "lt", label: "less than" },
          { operator: "lte", label: "less than or equal" }
        ]
      })
    ]);
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
