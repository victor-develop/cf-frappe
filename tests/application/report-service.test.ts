import { QueryService, ReportService, defineReport } from "../../src";
import { createChildTableServices, createServices, data, guest, owner } from "../helpers";

describe("ReportService", () => {
  it("lists reports readable by actor roles and DocType permissions", () => {
    const { reports } = createServices();

    expect(reports.listReports(owner).map((report) => report.name)).toEqual(["Open Notes"]);
    expect(reports.listReports(guest)).toEqual([]);
  });

  it("runs metadata-defined reports over permission-filtered documents", async () => {
    const { documents, reports } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Note", priority: "Low", count: 2 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Note", priority: "High", body: "Needs care", count: 7 }) });

    const result = await reports.runReport(owner, "Open Notes", {
      filters: { priority: "High" }
    });

    expect(result).toMatchObject({
      columns: [{ name: "title" }, { name: "priority" }, { name: "body" }],
      rows: [{ title: "High Note", priority: "High", body: "Needs care" }],
      summary: [
        { name: "note_count", label: "Notes", aggregate: "count", value: 1, type: "integer" },
        { name: "total_count", label: "Total Count", aggregate: "sum", value: 7, field: "count", type: "integer" }
      ],
      groups: [
        {
          name: "by_priority",
          label: "By Priority",
          field: "priority",
          rows: [
            {
              key: "High",
              label: "High",
              summaries: [
                { name: "note_count", value: 1 },
                { name: "total_count", value: 7 }
              ]
            }
          ]
        }
      ],
      charts: [
        {
          name: "notes_by_priority",
          label: "Notes by Priority",
          type: "bar",
          group: "by_priority",
          summary: "note_count",
          points: [{ key: "High", label: "High", value: 1 }]
        }
      ],
      total: 1
    });
  });

  it("computes report summaries and groups before pagination", async () => {
    const { documents, reports } = createServices(["e1", "e2", "e3"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Note", priority: "Low", count: 2 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Note A", priority: "High", count: 7 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Note B", priority: "High", count: 3 }) });

    const result = await reports.runReport(owner, "Open Notes", {
      limit: 1
    });

    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.summary).toMatchObject([
      { name: "note_count", value: 3 },
      { name: "total_count", value: 12 }
    ]);
    expect(result.groups).toMatchObject([
      {
        name: "by_priority",
        rows: [
          {
            key: "High",
            summaries: [
              { name: "note_count", value: 2 },
              { name: "total_count", value: 10 }
            ]
          },
          {
            key: "Low",
            summaries: [
              { name: "note_count", value: 1 },
              { name: "total_count", value: 2 }
            ]
          }
        ]
      }
    ]);
    expect(result.charts).toMatchObject([
      {
        name: "notes_by_priority",
        points: [
          { key: "High", value: 2 },
          { key: "Low", value: 1 }
        ]
      }
    ]);
  });

  it("counts populated table fields in top-level and grouped summaries", async () => {
    const { registry, store, projections } = createChildTableServices();
    registry.registerReport(
      defineReport({
        name: "Invoice Item Coverage",
        doctype: "Sales Invoice",
        columns: [{ name: "title" }],
        summaries: [{ name: "invoices_with_items", aggregate: "count", field: "items" }],
        groups: [
          {
            name: "by_title",
            field: "title",
            summaries: [{ name: "invoices_with_items", aggregate: "count", field: "items" }]
          }
        ],
        roles: ["User"]
      })
    );
    const reports = new ReportService({ registry, queries: new QueryService({ registry, projections }) });
    await store.save({
      tenantId: "acme",
      doctype: "Sales Invoice",
      name: "INV-1",
      version: 1,
      docstatus: "draft",
      data: { title: "INV-1", items: [{ product: "SKU-1", quantity: 2, rate: 5 }] },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await store.save({
      tenantId: "acme",
      doctype: "Sales Invoice",
      name: "INV-2",
      version: 1,
      docstatus: "draft",
      data: { title: "INV-2", items: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await store.save({
      tenantId: "acme",
      doctype: "Sales Invoice",
      name: "INV-3",
      version: 1,
      docstatus: "draft",
      data: { title: "INV-3" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });

    const result = await reports.runReport(owner, "Invoice Item Coverage");

    expect(result.summary).toMatchObject([{ name: "invoices_with_items", value: 2 }]);
    expect(result.groups).toMatchObject([
      {
        name: "by_title",
        rows: [
          { key: "INV-1", summaries: [{ name: "invoices_with_items", value: 1 }] },
          { key: "INV-2", summaries: [{ name: "invoices_with_items", value: 1 }] },
          { key: "INV-3", summaries: [{ name: "invoices_with_items", value: 0 }] }
        ]
      }
    ]);
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

  it("exports all filtered report rows as CSV with escaped cells", async () => {
    const { documents, reports } = createServices(["e1", "e2", "e3", "e4"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Note", priority: "Low" }) });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High, One", priority: "High", body: "Needs \"care\"" })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Two", priority: "High", body: "Line\nbreak" })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({
        title: "=HYPERLINK(\"https://example.com\",\"x\")",
        priority: "High",
        body: "+SUM(1,1)"
      })
    });

    const csv = await reports.exportReportCsv(owner, "Open Notes", {
      filters: { priority: "High" }
    });

    expect(csv).toMatchObject({
      filename: "Open-Notes.csv",
      contentType: "text/csv; charset=utf-8",
      exported: 3,
      total: 3,
      truncated: false,
      limit: 10_000
    });
    expect(csv.body).toBe([
      "Title,Priority,Body",
      "\"High, One\",High,\"Needs \"\"care\"\"\"",
      "High Two,High,\"Line\nbreak\"",
      "\"'=HYPERLINK(\"\"https://example.com\"\",\"\"x\"\")\",High,\"'+SUM(1,1)\""
    ].join("\n"));
  });

  it("caps CSV exports while counting all matched rows", async () => {
    const { documents, reports } = createServices(["e1", "e2", "e3"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "First", priority: "High" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Second", priority: "High" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Third", priority: "High" }) });

    const csv = await reports.exportReportCsv(owner, "Open Notes", {
      filters: { priority: "High" },
      limit: 2
    });

    expect(csv).toMatchObject({
      exported: 2,
      total: 3,
      truncated: true,
      limit: 2
    });
    expect(csv.body).toBe([
      "Title,Priority,Body",
      "First,High,Body",
      "Second,High,Body"
    ].join("\n"));
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
