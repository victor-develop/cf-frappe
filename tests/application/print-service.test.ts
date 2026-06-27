import { PrintService, defineDocType, definePrintFormat, definePrintLetterhead } from "../../src";
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

  it("omits print-hidden DocType fields from section view models", async () => {
    const { registry, documents, prints } = createServices(["e1"]);
    registry.registerDocType(defineDocType({
      name: "Printable Secret",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "public_note", type: "text" },
        { name: "internal_note", type: "longText", printHide: true }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }]
    }));
    registry.registerPrintFormat(definePrintFormat({
      name: "Printable Secret Standard",
      doctype: "Printable Secret",
      sections: [
        {
          heading: "Summary",
          fields: [
            { field: "title", label: "Title" },
            { field: "public_note", label: "Public Note" },
            { field: "internal_note", label: "Internal Note" }
          ]
        }
      ],
      roles: ["User"]
    }));
    await documents.create({
      actor: owner,
      doctype: "Printable Secret",
      data: { title: "Public Memo", public_note: "Share this", internal_note: "Do not print" }
    });

    const view = await prints.printDocument(owner, "Printable Secret Standard", "Public Memo");

    expect(view.hiddenPrintFields).toEqual(["internal_note"]);
    expect(view.sections).toEqual([
      {
        heading: "Summary",
        fields: [
          { field: "title", label: "Title", value: "Public Memo" },
          { field: "public_note", label: "Public Note", value: "Share this" }
        ]
      }
    ]);
  });

  it("omits print-hide-if-no-value fields only when their document value is empty", async () => {
    const { registry, documents, prints } = createServices(["e1"]);
    registry.registerDocType(defineDocType({
      name: "Printable Optional",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "empty_note", type: "text", printHideIfNoValue: true },
        { name: "zero_count", type: "integer", printHideIfNoValue: true },
        { name: "published", type: "boolean", printHideIfNoValue: true }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }]
    }));
    registry.registerPrintFormat(definePrintFormat({
      name: "Printable Optional Standard",
      doctype: "Printable Optional",
      sections: [
        {
          fields: [
            { field: "title", label: "Title" },
            { field: "empty_note", label: "Empty Note" },
            { field: "zero_count", label: "Zero Count" },
            { field: "published", label: "Published" }
          ]
        }
      ],
      roles: ["User"]
    }));
    await documents.create({
      actor: owner,
      doctype: "Printable Optional",
      data: { title: "Optional Memo", empty_note: "", zero_count: 0, published: false }
    });

    const view = await prints.printDocument(owner, "Printable Optional Standard", "Optional Memo");

    expect(view.hiddenPrintFields).toEqual(["empty_note"]);
    expect(view.sections).toEqual([
      {
        fields: [
          { field: "title", label: "Title", value: "Optional Memo" },
          { field: "zero_count", label: "Zero Count", value: 0 },
          { field: "published", label: "Published", value: false }
        ]
      }
    ]);
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
