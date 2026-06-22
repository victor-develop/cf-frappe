import { createRegistry, defineDocType, definePrintFormat, definePrintLetterhead, FrameworkError } from "../../src";

describe("print formats", () => {
  it("registers print formats after their DocType and lists them in stable order", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const registry = createRegistry({
      doctypes: [Note],
      printFormats: [
        definePrintFormat({
          name: "Zulu Print",
          doctype: "Note",
          sections: [{ fields: [{ field: "title" }] }]
        }),
        definePrintFormat({
          name: "Alpha Print",
          doctype: "Note",
          sections: [{ fields: [{ field: "title" }] }]
        })
      ]
    });

    expect(registry.listPrintFormats().map((format) => format.name)).toEqual(["Alpha Print", "Zulu Print"]);
  });

  it("registers print letterheads in stable order", () => {
    const registry = createRegistry({
      letterheads: [
        definePrintLetterhead({ name: "Zulu Letterhead", headerHtml: "<p>Zulu</p>" }),
        definePrintLetterhead({ name: "Alpha Letterhead", headerHtml: "<p>Alpha</p>" })
      ]
    });

    expect(registry.listPrintLetterheads().map((letterhead) => letterhead.name)).toEqual([
      "Alpha Letterhead",
      "Zulu Letterhead"
    ]);
  });

  it("rejects empty print formats", () => {
    expect(() =>
      definePrintFormat({
        name: "Broken Print",
        doctype: "Note"
      })
    ).toThrow(FrameworkError);
  });

  it("rejects empty print letterheads", () => {
    expect(() =>
      definePrintLetterhead({
        name: "Broken Letterhead"
      })
    ).toThrow("Print letterhead 'Broken Letterhead' must define headerHtml or footerHtml");
  });

  it("rejects direct registry print formats without sections or template", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [{ name: "Broken Print", doctype: "Note" }]
      })
    ).toThrow("Print format 'Broken Print' must define at least one section or template");
  });

  it("registers template-only print formats", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const registry = createRegistry({
      doctypes: [Note],
      printFormats: [
        definePrintFormat({
          name: "Template Print",
          doctype: "Note",
          template: "<h2>{{ doc.title }}</h2><small>{{ format.name }} {{ doc.name }}</small>"
        })
      ]
    });

    expect(registry.getPrintFormat("Template Print")).toMatchObject({
      name: "Template Print",
      sections: [],
      template: "<h2>{{ doc.title }}</h2><small>{{ format.name }} {{ doc.name }}</small>"
    });
  });

  it("rejects print formats that reference unknown letterheads", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Missing Letterhead Print",
            doctype: "Note",
            letterhead: "Missing Letterhead",
            sections: [{ fields: [{ field: "title" }] }]
          })
        ]
      })
    ).toThrow("Print format 'Missing Letterhead Print' references unknown letterhead 'Missing Letterhead'");
  });

  it("rejects print formats that reference unknown fields", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Broken Print",
            doctype: "Note",
            sections: [{ fields: [{ field: "missing" }] }]
          })
        ]
      })
    ).toThrow("Print format 'Broken Print' references unknown field 'missing'");
  });

  it("rejects print templates that reference unknown fields or scopes", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Broken Template",
            doctype: "Note",
            template: "<h2>{{ doc.missing }}</h2>"
          })
        ]
      })
    ).toThrow("Print format 'Broken Template' template references unknown field 'missing'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Broken Scope",
            doctype: "Note",
            template: "<h2>{{ user.name }}</h2>"
          })
        ]
      })
    ).toThrow("Print format 'Broken Scope' template variable '{{ user.name }}' must reference doc.<field> or format.<property>");
  });

  it("rejects print template substitutions inside attributes and raw text blocks", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Attribute Template",
            doctype: "Note",
            template: '<a href="{{ doc.title }}">Open</a>'
          })
        ]
      })
    ).toThrow("Print format 'Attribute Template' template variable '{{ doc.title }}' cannot be used inside an HTML tag");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Script Template",
            doctype: "Note",
            template: "<script>const title = '{{ doc.title }}'</script>"
          })
        ]
      })
    ).toThrow("Print format 'Script Template' template variable '{{ doc.title }}' cannot be used inside script or style blocks");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        printFormats: [
          definePrintFormat({
            name: "Quoted Attribute Template",
            doctype: "Note",
            template: '<button data-rule="1 > 0 {{ doc.title }}">Run</button>'
          })
        ]
      })
    ).toThrow(
      "Print format 'Quoted Attribute Template' template variable '{{ doc.title }}' cannot be used inside an HTML tag"
    );
  });
});
