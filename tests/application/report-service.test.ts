import { defineReport } from "../../src";
import { createServices, data, guest, owner } from "../helpers";

describe("ReportService", () => {
  it("lists reports readable by actor roles and DocType permissions", () => {
    const { reports } = createServices();

    expect(reports.listReports(owner).map((report) => report.name)).toEqual(["Open Notes"]);
    expect(reports.listReports(guest)).toEqual([]);
  });

  it("runs metadata-defined reports over permission-filtered documents", async () => {
    const { documents, reports } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Note", priority: "Low" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Note", priority: "High", body: "Needs care" }) });

    const result = await reports.runReport(owner, "Open Notes", {
      filters: { priority: "High" }
    });

    expect(result).toMatchObject({
      columns: [{ name: "title" }, { name: "priority" }, { name: "body" }],
      rows: [{ title: "High Note", priority: "High", body: "Needs care" }],
      total: 1
    });
  });

  it("supports contains filters and pagination after filtering", async () => {
    const { documents, reports } = createServices(["e1", "e2", "e3"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Alpha Note" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Beta Note" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Gamma" }) });

    const result = await reports.runReport(owner, "Open Notes", {
      filters: { title: "note" },
      limit: 1,
      offset: 1
    });

    expect(result.rows).toEqual([{ title: "Beta Note", priority: "Medium", body: "Body" }]);
    expect(result.total).toBe(2);
  });

  it("finds matching rows beyond the first projection page", async () => {
    const { store, reports } = createServices();
    for (let index = 0; index < 204; index += 1) {
      await store.save({
        tenantId: "acme",
        doctype: "Note",
        name: `Filler ${index}`,
        version: 1,
        docstatus: "draft",
        data: {
          title: `Filler ${index}`,
          priority: "Low",
          body: "Filler",
          created_by: owner.id
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString()
      });
    }
    await store.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Needle",
      version: 1,
      docstatus: "draft",
      data: {
        title: "Needle",
        priority: "High",
        body: "Beyond first page",
        created_by: owner.id
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await reports.runReport(owner, "Open Notes", {
      filters: { priority: "High" }
    });

    expect(result.rows).toEqual([{ title: "Needle", priority: "High", body: "Beyond first page" }]);
    expect(result.total).toBe(1);
  });

  it("rejects report metadata that references unknown fields", () => {
    const { registry } = createServices();

    expect(() =>
      registry.registerReport(
        defineReport({
          name: "Broken Notes",
          doctype: "Note",
          columns: [{ name: "missing" }]
        })
      )
    ).toThrow(
      "Report 'Broken Notes' column 'missing' references unknown field 'missing'"
    );
  });
});
