import { createRegistry, defineDocType, defineReport, FrameworkError } from "../../src";

describe("reports", () => {
  it("registers reports after their DocType and lists them in stable order", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const registry = createRegistry({
      doctypes: [Note],
      reports: [
        defineReport({ name: "Zulu Notes", doctype: "Note", columns: [{ name: "title" }] }),
        defineReport({ name: "Alpha Notes", doctype: "Note", columns: [{ name: "title" }] })
      ]
    });

    expect(registry.listReports().map((report) => report.name)).toEqual(["Alpha Notes", "Zulu Notes"]);
  });

  it("rejects reports with duplicate columns", () => {
    expect(() =>
      defineReport({
        name: "Broken Notes",
        doctype: "Note",
        columns: [{ name: "title" }, { name: "title" }]
      })
    ).toThrow(FrameworkError);
  });

  it("rejects reports whose DocType is not registered", () => {
    const report = defineReport({ name: "Missing Notes", doctype: "Missing", columns: [{ name: "title" }] });

    expect(() => createRegistry({ reports: [report] })).toThrow("DocType 'Missing' is not registered");
  });
});
