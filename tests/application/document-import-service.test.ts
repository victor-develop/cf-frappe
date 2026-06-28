import { defineDocType, documentImportTemplate, DocumentImportService } from "../../src";
import { createServices, owner } from "../helpers";

describe("DocumentImportService", () => {
  it("builds import templates from writable metadata fields", () => {
    const Importable = defineDocType({
      name: "Importable Thing",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "status", type: "select", options: ["Open", "Closed"], defaultValue: "Open" },
        { name: "count", type: "integer", defaultValue: 0 },
        { name: "secret", type: "text", hidden: true },
        { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });

    const template = documentImportTemplate(Importable);

    expect(template).toEqual({
      doctype: "Importable Thing",
      filename: "Importable-Thing-import-template.csv",
      contentType: "text/csv; charset=utf-8",
      body: "name,expectedVersion,title,status,count\n,,,Open,0",
      fields: ["title", "status", "count"]
    });
  });

  it("excludes reserved import columns from metadata field headers", () => {
    const Reserved = defineDocType({
      name: "Reserved Import",
      fields: [
        { name: "name", type: "text" },
        { name: "expectedVersion", type: "integer" },
        { name: "title", type: "text" }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });

    expect(documentImportTemplate(Reserved)).toMatchObject({
      body: "name,expectedVersion,title",
      fields: ["title"]
    });
  });

  it("builds header-only import templates when no static defaults exist", () => {
    const HeaderOnly = defineDocType({
      name: "Header Only",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "created_by", type: "text", defaultValue: ({ actor }) => actor.id }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });

    expect(documentImportTemplate(HeaderOnly).body).toBe("name,expectedVersion,title,created_by");
  });

  it("imports CSV rows through the document create command boundary", async () => {
    const services = createServices(["import-1", "import-2"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    const result = await imports.importCsv({
      actor: owner,
      doctype: "Note",
      csv: [
        "title,priority,count,body",
        "First Note,High,3,\"Needs, follow-up\"",
        "Second Note,Low,1,"
      ].join("\n")
    });

    expect(result).toMatchObject({
      doctype: "Note",
      mode: "create",
      total: 2,
      failed: []
    });
    expect(result.succeeded.map((row) => [row.row, row.name, row.document.data])).toEqual([
      [
        2,
        "First Note",
        expect.objectContaining({ title: "First Note", priority: "High", count: 3, body: "Needs, follow-up" })
      ],
      [3, "Second Note", expect.objectContaining({ title: "Second Note", priority: "Low", count: 1 })]
    ]);
    await expect(services.queries.getDocument(owner, "Note", "First Note")).resolves.toMatchObject({
      version: 1,
      data: expect.objectContaining({ count: 3 })
    });
  });

  it("continues importing later rows when a row fails validation", async () => {
    const services = createServices(["import-1", "import-2"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    const result = await imports.importCsv({
      actor: owner,
      doctype: "Note",
      csv: ["title,priority", "No,Medium", "Valid Note,Medium"].join("\n")
    });

    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({
        row: 2,
        action: "create",
        code: "VALIDATION_FAILED",
        status: 422
      })
    ]);
    await expect(services.queries.getDocument(owner, "Note", "Valid Note")).resolves.toMatchObject({ version: 1 });
  });

  it("updates existing documents from name and expectedVersion columns", async () => {
    const services = createServices(["create-1", "update-1"]);
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: { title: "Import Target", priority: "Low" }
    });
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    const result = await imports.importCsv({
      actor: owner,
      doctype: "Note",
      mode: "update",
      csv: ["name,expectedVersion,priority,count,body", "Import Target,1,High,7,Escalated"].join("\n")
    });

    expect(result.failed).toEqual([]);
    expect(result.succeeded[0]).toMatchObject({ row: 2, action: "update", name: "Import Target" });
    await expect(services.queries.getDocument(owner, "Note", "Import Target")).resolves.toMatchObject({
      version: 2,
      data: expect.objectContaining({ priority: "High", count: 7, body: "Escalated" })
    });
  });

  it("rejects invalid CSV import headers before writing document events", async () => {
    const services = createServices(["import-1"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    await expect(
      imports.importCsv({
        actor: owner,
        doctype: "Note",
        csv: ["title,unknown", "Valid Note,value"].join("\n")
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CSV import header 'unknown' is not a field on Note"
    });
    await expect(services.queries.listDocuments(owner, "Note")).resolves.toMatchObject({ total: 0 });
  });

  it("rejects non-importable CSV headers before writing document events", async () => {
    const services = createServices(["import-1"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    await expect(imports.importCsv({
      actor: owner,
      doctype: "Note",
      csv: ["title,created_by", "Visible,system"].join("\n")
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CSV import header 'created_by' is not importable on Note"
    });
    await expect(services.queries.listDocuments(owner, "Note")).resolves.toMatchObject({ total: 0 });
  });

  it("rejects mismatched row widths before dropping import cells", async () => {
    const services = createServices(["import-1"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    await expect(
      imports.importCsv({
        actor: owner,
        doctype: "Note",
        csv: ["title,priority,count", "Wide Note,Medium,1,ignored"].join("\n")
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CSV row 2 has 4 columns but the header has 3"
    });
    await expect(services.queries.listDocuments(owner, "Note")).resolves.toMatchObject({ total: 0 });
  });

  it("accepts UTF-8 BOM headers from spreadsheet exports", async () => {
    const services = createServices(["import-1"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    const result = await imports.importCsv({
      actor: owner,
      doctype: "Note",
      csv: "\ufefftitle,priority\nBOM Note,Medium"
    });

    expect(result.failed).toEqual([]);
    expect(result.succeeded[0]).toMatchObject({ row: 2, name: "BOM Note" });
    await expect(services.queries.getDocument(owner, "Note", "BOM Note")).resolves.toMatchObject({ version: 1 });
  });

  it("reports physical row numbers after quoted CRLF cells", async () => {
    const services = createServices(["import-1"]);
    const imports = new DocumentImportService({
      documents: services.documents,
      queries: services.queries
    });

    await expect(
      imports.importCsv({
        actor: owner,
        doctype: "Note",
        csv: "title,body\nMultiline,\"first\r\nsecond\"\nBad Row,Body,extra"
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CSV row 4 has 3 columns but the header has 2"
    });
  });
});
