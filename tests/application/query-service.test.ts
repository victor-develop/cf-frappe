import { createLinkedServices, createServices, data, guest, owner } from "../helpers";
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
