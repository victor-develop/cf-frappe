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

  it("registers frozen print layout metadata", () => {
    const format = definePrintFormat({
      name: "Layout Print",
      doctype: "Note",
      sections: [{ fields: [{ field: "title" }] }],
      layout: {
        pageSize: "A4",
        orientation: "landscape",
        margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
        font: { family: "Inter", sizePt: 10 }
      }
    });

    expect(format.layout).toEqual({
      pageSize: "A4",
      orientation: "landscape",
      margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
      font: { family: "Inter", sizePt: 10 }
    });
    expect(Object.isFrozen(format.layout)).toBe(true);
    expect(Object.isFrozen(format.layout?.margins)).toBe(true);
    expect(Object.isFrozen(format.layout?.font)).toBe(true);
  });

  it("rejects invalid print layout metadata", () => {
    expect(() =>
      definePrintFormat({
        name: "Negative Margin Print",
        doctype: "Note",
        sections: [{ fields: [{ field: "title" }] }],
        layout: { margins: { topMm: -1 } }
      })
    ).toThrow("Print format 'Negative Margin Print' layout margin topMm must be between 0 and 100 millimeters");

    expect(() =>
      definePrintFormat({
        name: "Unsafe Font Print",
        doctype: "Note",
        sections: [{ fields: [{ field: "title" }] }],
        layout: { font: { family: "Inter; color:red" } }
      })
    ).toThrow("Print format 'Unsafe Font Print' layout font family contains unsupported characters");

    expect(() =>
      createRegistry({
        doctypes: [defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] })],
        printFormats: [
          {
            name: "Tiny Page Print",
            doctype: "Note",
            sections: [{ fields: [{ field: "title" }] }],
            layout: { pageSize: { widthMm: 0, heightMm: 297 } }
          }
        ]
      })
    ).toThrow("Print format 'Tiny Page Print' layout custom page widthMm must be between 1 and 2000 millimeters");

    expect(() =>
      definePrintFormat({
        name: "Ambiguous Page Print",
        doctype: "Note",
        sections: [{ fields: [{ field: "title" }] }],
        layout: { pageSize: { widthMm: 210, heightMm: 297 }, orientation: "landscape" }
      })
    ).toThrow("Print format 'Ambiguous Page Print' layout orientation cannot be combined with custom page size");
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
