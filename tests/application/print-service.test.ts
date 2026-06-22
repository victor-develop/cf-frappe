import { PrintService, definePrintFormat, definePrintLetterhead } from "../../src";
import { createServices, data, guest, owner } from "../helpers";

describe("PrintService", () => {
  it("lists print formats readable by actor roles and DocType permissions", () => {
    const { prints } = createServices();

    expect(prints.listPrintFormats(owner).map((format) => format.name)).toEqual(["Note Standard"]);
    expect(prints.listPrintFormats(guest)).toEqual([]);
  });

  it("builds a print view model from a readable document", async () => {
    const { documents, prints } = createServices(["e1"]);
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Printable", priority: "High", body: "Ready" })
    });

    const view = await prints.printDocument(owner, "Note Standard", "Printable");

    expect(view).toMatchObject({
      format: { name: "Note Standard" },
      document: { name: "Printable" },
      sections: [
        {
          heading: "Details",
          fields: [
            { field: "title", label: "Title", value: "Printable" },
            { field: "priority", label: "Priority", value: "High" },
            { field: "body", label: "Body", value: "Ready" }
          ]
        }
      ]
    });
  });

  it("builds template-only print view models without field sections", async () => {
    const { registry, documents, prints } = createServices(["e1"]);
    registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Template",
        doctype: "Note",
        template: "<h2>{{ doc.title }}</h2><p>{{ doc.body }}</p>"
      })
    );
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Templated", priority: "High", body: "Ready" })
    });

    const view = await prints.printDocument(owner, "Note Template", "Templated");

    expect(view).toMatchObject({
      format: {
        name: "Note Template",
        template: "<h2>{{ doc.title }}</h2><p>{{ doc.body }}</p>"
      },
      document: { name: "Templated" },
      sections: []
    });
  });

  it("resolves readable print letterheads into print view models", async () => {
    const { registry, documents, prints } = createServices(["e1"]);
    registry.registerPrintLetterhead(
      definePrintLetterhead({
        name: "Company Letterhead",
        label: "Company",
        headerHtml: "<strong>ACME</strong>",
        footerHtml: "<small>Registered office</small>"
      })
    );
    registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Letterhead Print",
        doctype: "Note",
        letterhead: "Company Letterhead",
        sections: [{ fields: [{ field: "title" }] }]
      })
    );
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Letterheaded", priority: "High", body: "Ready" })
    });

    const view = await prints.printDocument(owner, "Note Letterhead Print", "Letterheaded");

    expect(view).toMatchObject({
      format: { name: "Note Letterhead Print", letterhead: "Company Letterhead" },
      letterhead: {
        name: "Company Letterhead",
        headerHtml: "<strong>ACME</strong>",
        footerHtml: "<small>Registered office</small>"
      },
      document: { name: "Letterheaded" }
    });
    expect(prints.listPrintLetterheads(owner).map((letterhead) => letterhead.name)).toContain("Company Letterhead");
  });

  it("denies print formats when the referenced letterhead roles do not match", async () => {
    const { registry, documents, prints } = createServices(["e1"]);
    registry.registerPrintLetterhead(
      definePrintLetterhead({
        name: "Managers Only",
        headerHtml: "<strong>Management</strong>",
        roles: ["Task Manager"]
      })
    );
    registry.registerPrintFormat(
      definePrintFormat({
        name: "Restricted Letterhead Print",
        doctype: "Note",
        letterhead: "Managers Only",
        sections: [{ fields: [{ field: "title" }] }]
      })
    );
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Restricted", priority: "High", body: "Ready" })
    });

    expect(prints.listPrintFormats(owner).map((format) => format.name)).not.toContain("Restricted Letterhead Print");
    await expect(prints.printDocument(owner, "Restricted Letterhead Print", "Restricted")).rejects.toThrow(
      "cannot read print format"
    );
  });

  it("denies print access when report roles do not match", async () => {
    const { prints } = createServices();

    expect(() => prints.getPrintFormat(guest, "Note Standard")).toThrow("cannot read print format");
  });
});
