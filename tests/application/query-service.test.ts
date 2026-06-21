import { createServices, data, guest, owner } from "../helpers";

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
});
