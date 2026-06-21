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

    await expect(queries.listDocuments(guest, "Note")).resolves.toMatchObject({ data: [] });
  });
});
