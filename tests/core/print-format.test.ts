import { createRegistry, defineDocType, definePrintFormat, FrameworkError } from "../../src";

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

  it("rejects empty print formats", () => {
    expect(() =>
      definePrintFormat({
        name: "Broken Print",
        doctype: "Note",
        sections: []
      })
    ).toThrow(FrameworkError);
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
});
