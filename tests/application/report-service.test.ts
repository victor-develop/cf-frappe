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
      filters: [
        {
          name: "priority",
          label: "Priority",
          field: "priority",
          type: "select",
          operator: "eq",
          required: false,
          value: "High",
          options: ["Low", "Medium", "High"]
        },
        {
          name: "title",
          label: "Title",
          field: "title",
          type: "text",
          operator: "contains",
          required: false,
          options: []
        }
      ],
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
          orderBy: "key",
          order: "asc",
          colors: [],
          showValues: true,
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

  it("sorts chart points by metadata before applying maxPoints", async () => {
    const { documents, registry, reports } = createServices(["e1", "e2", "e3", "e4", "e5", "e6"]);
    registry.registerReport(
      defineReport({
        name: "Priority Leaderboard",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "rows", aggregate: "count" }]
          }
        ],
        charts: [
          {
            name: "priority_counts",
            label: "Priority Counts",
            type: "bar",
            group: "by_priority",
            summary: "rows",
            maxPoints: 2,
            orderBy: "value",
            order: "desc",
            colors: ["#123", "#abcdef"],
            showValues: false
          }
        ],
        roles: ["User"]
      })
    );
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High 1", priority: "High" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low 1", priority: "Low" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low 2", priority: "Low" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Medium 1", priority: "Medium" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Medium 2", priority: "Medium" }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Medium 3", priority: "Medium" }) });

    const result = await reports.runReport(owner, "Priority Leaderboard");

    expect(result.charts).toMatchObject([
      {
        name: "priority_counts",
        orderBy: "value",
        order: "desc",
        colors: ["#123", "#abcdef"],
        showValues: false,
        points: [
          { key: "Medium", label: "Medium", value: 3 },
          { key: "Low", label: "Low", value: 2 }
        ]
      }
    ]);
  });

  it("sorts report rows by metadata and runtime controls before pagination and export", async () => {
    const { documents, registry, reports } = createServices(["e1", "e2", "e3"]);
    registry.registerReport(
      defineReport({
        name: "Ordered Counts",
        doctype: "Note",
        columns: [
          { name: "title", label: "Title" },
          { name: "count", label: "Count" }
        ],
        orderBy: "count",
        order: "desc",
        roles: ["User"]
      })
    );
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Beta", count: 2 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Alpha", count: 5 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Gamma", count: 5 }) });

    const metadataOrdered = await reports.runReport(owner, "Ordered Counts", { limit: 2 });

    expect(metadataOrdered.order).toEqual({
      orderBy: "count",
      order: "desc",
      options: [
        { name: "title", label: "Title" },
        { name: "count", label: "Count" }
      ]
    });
    expect(metadataOrdered.rows).toEqual([
      { title: "Alpha", count: 5 },
      { title: "Gamma", count: 5 }
    ]);
    expect(metadataOrdered.total).toBe(3);

    const runtimeOrdered = await reports.runReport(owner, "Ordered Counts", {
      orderBy: "title",
      order: "asc"
    });

    expect(runtimeOrdered.rows).toEqual([
      { title: "Alpha", count: 5 },
      { title: "Beta", count: 2 },
      { title: "Gamma", count: 5 }
    ]);

    const csv = await reports.exportReportCsv(owner, "Ordered Counts", {
      orderBy: "title",
      order: "desc",
      limit: 2
    });

    expect(csv).toMatchObject({ exported: 2, total: 3, truncated: true });
    expect(csv.body).toBe([
      "Title,Count",
      "Gamma,5",
      "Beta,2"
    ].join("\n"));
  });

  it("rejects invalid runtime report ordering controls", async () => {
    const { registry, reports } = createServices();
    registry.registerReport(
      defineReport({
        name: "Ordered Counts",
        doctype: "Note",
        columns: [{ name: "title" }],
        roles: ["User"]
      })
    );

    await expect(
      reports.runReport(owner, "Ordered Counts", {
        orderBy: "missing"
      })
    ).rejects.toThrow("Report orderBy 'missing' is not a sortable report column");

    await expect(
      reports.runReport(owner, "Ordered Counts", {
        order: "sideways" as "asc"
      })
    ).rejects.toThrow("Report order must be asc or desc");
  });

  it("returns filter controls with coerced current values and select options", async () => {
    const { documents, registry, reports } = createServices(["e1", "e2"]);
    registry.registerReport(
      defineReport({
        name: "Count Threshold",
        doctype: "Note",
        columns: [{ name: "title" }, { name: "count" }],
        filters: [
          { name: "priority", label: "Priority", field: "priority", type: "select", defaultValue: "Medium" },
          { name: "minimum", label: "Minimum Count", field: "count", operator: "gte", defaultValue: 1 }
        ],
        roles: ["User"]
      })
    );
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Count", priority: "High", count: 1 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Count", priority: "High", count: 3 }) });

    const result = await reports.runReport(owner, "Count Threshold", {
      filters: { priority: "High", minimum: "2" }
    });

    expect(result.rows).toEqual([{ title: "High Count", count: 3 }]);
    expect(result.filters).toEqual([
      {
        name: "priority",
        label: "Priority",
        field: "priority",
        type: "select",
        operator: "eq",
        required: false,
        value: "High",
        options: ["Low", "Medium", "High"]
      },
      {
        name: "minimum",
        label: "Minimum Count",
        field: "count",
        type: "integer",
        operator: "gte",
        required: false,
        value: 2,
        options: []
      }
    ]);
  });

  it("rejects invalid typed report filter values", async () => {
    const { registry, reports } = createServices();
    registry.registerReport(
      defineReport({
        name: "Count Threshold",
        doctype: "Note",
        columns: [{ name: "title" }],
        filters: [
          { name: "minimum", label: "Minimum Count", field: "count", operator: "gte" },
          { name: "enabled", label: "Enabled", field: "workflow_state", type: "boolean" }
        ],
        roles: ["User"]
      })
    );

    await expect(
      reports.runReport(owner, "Count Threshold", {
        filters: { minimum: "many" }
      })
    ).rejects.toThrow("Report filter 'minimum' must be an integer");

    await expect(
      reports.runReport(owner, "Count Threshold", {
        filters: { minimum: true }
      })
    ).rejects.toThrow("Report filter 'minimum' must be an integer");

    await expect(
      reports.runReport(owner, "Count Threshold", {
        filters: { minimum: 1.5 }
      })
    ).rejects.toThrow("Report filter 'minimum' must be an integer");

    await expect(
      reports.runReport(owner, "Count Threshold", {
        filters: { enabled: 2 }
      })
    ).rejects.toThrow("Report filter 'enabled' must be a boolean");
  });

  it("rejects invalid typed report filter defaults", async () => {
    const { registry, reports } = createServices();
    registry.registerReport(
      defineReport({
        name: "Broken Default",
        doctype: "Note",
        columns: [{ name: "title" }],
        filters: [{ name: "enabled", label: "Enabled", field: "workflow_state", type: "boolean", defaultValue: 2 }],
        roles: ["User"]
      })
    );

    await expect(reports.runReport(owner, "Broken Default")).rejects.toThrow(
      "Report filter 'enabled' must be a boolean"
    );
  });

  it("keeps null chart values behind numeric points before applying maxPoints", async () => {
    const { registry, reports, store } = createServices();
    registry.registerReport(
      defineReport({
        name: "Priority Average",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "average_count", aggregate: "avg", field: "count" }]
          }
        ],
        charts: [
          {
            name: "average_priority_count",
            type: "bar",
            group: "by_priority",
            summary: "average_count",
            maxPoints: 2,
            orderBy: "value",
            order: "asc"
          }
        ],
        roles: ["User"]
      })
    );
    await store.save({
      tenantId: "acme",
      doctype: "Note",
      name: "High without Count",
      version: 1,
      docstatus: "draft",
      data: { title: "High without Count", priority: "High", created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await store.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Low Count",
      version: 1,
      docstatus: "draft",
      data: { title: "Low Count", priority: "Low", count: 1, created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await store.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Medium Count",
      version: 1,
      docstatus: "draft",
      data: { title: "Medium Count", priority: "Medium", count: 2, created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });

    const result = await reports.runReport(owner, "Priority Average");

    expect(result.charts).toMatchObject([
      {
        name: "average_priority_count",
        points: [
          { key: "Low", value: 1 },
          { key: "Medium", value: 2 }
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

  it("exports top ordered CSV rows across projection pages while counting all matches", async () => {
    const { registry, reports, store } = createServices();
    registry.registerReport(
      defineReport({
        name: "Ordered Count Export",
        doctype: "Note",
        columns: [
          { name: "title", label: "Title" },
          { name: "count", label: "Count" }
        ],
        orderBy: "count",
        order: "desc",
        roles: ["User"]
      })
    );
    for (let index = 0; index < 205; index += 1) {
      await store.save({
        tenantId: "acme",
        doctype: "Note",
        name: `Rank ${index}`,
        version: 1,
        docstatus: "draft",
        data: {
          title: `Rank ${index}`,
          count: index,
          created_by: owner.id
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      });
    }

    const csv = await reports.exportReportCsv(owner, "Ordered Count Export", { limit: 2 });

    expect(csv).toMatchObject({
      exported: 2,
      total: 205,
      truncated: true,
      limit: 2
    });
    expect(csv.body).toBe([
      "Title,Count",
      "Rank 204,204",
      "Rank 203,203"
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
