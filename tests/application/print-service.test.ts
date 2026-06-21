import { PrintService } from "../../src";
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

  it("denies print access when report roles do not match", async () => {
    const { prints } = createServices();

    expect(() => prints.getPrintFormat(guest, "Note Standard")).toThrow("cannot read print format");
  });
});
