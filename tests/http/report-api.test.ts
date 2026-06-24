import {
  createResourceApi,
  defineReport,
  ReportService,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver,
  type PrintPdfRenderer,
  type RenderPrintPdfCommand,
  type RenderedPrintPdf
} from "../../src";
import { createServices, data, owner } from "../helpers";

class RecordingPrintPdfRenderer implements PrintPdfRenderer {
  readonly calls: RenderPrintPdfCommand[] = [];

  constructor(private readonly result: RenderedPrintPdf = { body: new Uint8Array([37, 80, 68, 70]) }) {}

  async render(command: RenderPrintPdfCommand): Promise<RenderedPrintPdf> {
    this.calls.push(command);
    return this.result;
  }
}

describe("report api", () => {
  const userHeaders = {
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  function makeApp(options: { readonly printPdfRenderer?: PrintPdfRenderer } = {}) {
    const services = createServices(["e1", "e2", "e3"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports: services.reports,
      printSettings: services.printSettings,
      ...(options.printPdfRenderer === undefined ? {} : { printPdfRenderer: options.printPdfRenderer }),
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  it("lists report metadata", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/reports", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Open Notes", doctype: "Note" }]
    });
  });

  it("runs a report with query-string filters", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low", count: 2 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note", priority: "High", body: "Needs care", count: 7 }) });

    const response = await app.request("/api/report/Open%20Notes/run?filter_priority=High", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ title: "High Note", priority: "High", body: "Needs care" }],
      summary: [
        { name: "note_count", value: 1 },
        { name: "total_count", value: 7 }
      ],
      filters: [
        { name: "priority", type: "select", value: "High", options: ["Low", "Medium", "High"] },
        { name: "title", type: "text", operator: "contains", options: [] }
      ],
      groups: [{ name: "by_priority", rows: [{ key: "High" }] }],
      charts: [
        {
          name: "notes_by_priority",
          points: [
            {
              key: "High",
              value: 1,
              drilldown: {
                filter: "priority",
                value: "High",
                query: "filter_priority=High"
              }
            }
          ]
        }
      ],
      total: 1
    });
  });

  it("runs reports with repeated range query-string filters", async () => {
    const { app, services } = makeApp();
    services.registry.registerReport(
      defineReport({
        name: "Outside Count Notes",
        doctype: "Note",
        columns: [{ name: "title" }, { name: "count" }],
        filters: [{ name: "outside_count", field: "count", operator: "not_between" }],
        roles: ["User"]
      })
    );
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "HTTP Report Low", priority: "Low", count: 1 }) });
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "HTTP Report Middle", priority: "Medium", count: 5 }) });
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "HTTP Report High", priority: "High", count: 9 }) });

    const response = await app.request(
      "/api/report/Outside%20Count%20Notes/run?filter_outside_count=2&filter_outside_count=8",
      { headers: userHeaders }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      filters: [{ name: "outside_count", operator: "not_between", value: [2, 8] }],
      rows: [
        { title: "HTTP Report Low", count: 1 },
        { title: "HTTP Report High", count: 9 }
      ],
      total: 2
    });
  });

  it("rejects malformed repeated range query-string filters", async () => {
    const { app, services } = makeApp();
    services.registry.registerReport(
      defineReport({
        name: "Malformed Count Range",
        doctype: "Note",
        columns: [{ name: "title" }, { name: "count" }],
        filters: [{ name: "count_range", field: "count", operator: "between" }],
        roles: ["User"]
      })
    );

    const response = await app.request(
      "/api/report/Malformed%20Count%20Range/run?filter_count_range=2&filter_count_range=8&filter_count_range=10",
      { headers: userHeaders }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: "Report filter 'count_range' must include exactly two values for between"
      }
    });
  });

  it("returns report chart controls through the JSON API", async () => {
    const { app, services } = makeApp();
    services.registry.registerReport(
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
            type: "bar",
            group: "by_priority",
            summary: "rows",
            maxPoints: 1,
            orderBy: "value",
            order: "desc",
            colors: ["#123456"],
            showValues: false,
            xAxisLabel: "Priority",
            yAxisLabel: "Notes"
          }
        ],
        roles: ["User"]
      })
    );
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low" }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note A", priority: "High" }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note B", priority: "High" }) });

    const response = await app.request("/api/report/Priority%20Leaderboard/run", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      charts: [
        {
          name: "priority_counts",
          orderBy: "value",
          order: "desc",
          colors: ["#123456"],
          showValues: false,
          xAxisLabel: "Priority",
          yAxisLabel: "Notes",
          points: [{ key: "High", value: 2 }]
        }
      ]
    });
  });

  it("runs and exports reports with query-string ordering", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Beta Note", priority: "High", count: 2 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Alpha Note", priority: "High", count: 5 }) });

    const response = await app.request("/api/report/Open%20Notes/run?filter_priority=High&order_by=title&order=desc", {
      headers: userHeaders
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      order: {
        orderBy: "title",
        order: "desc",
        options: [
          { name: "title", label: "Title" },
          { name: "priority", label: "Priority" },
          { name: "body", label: "Body" }
        ]
      },
      rows: [
        { title: "Beta Note" },
        { title: "Alpha Note" }
      ]
    });

    const csv = await app.request("/api/report/Open%20Notes/export.csv?filter_priority=High&order_by=title&order=asc", {
      headers: userHeaders
    });

    expect(csv.status).toBe(200);
    await expect(csv.text()).resolves.toBe([
      "Title,Priority,Body",
      "Alpha Note,High,Body",
      "Beta Note,High,Body"
    ].join("\n"));
  });

  it("maps invalid typed report filters to JSON errors", async () => {
    const { app, services } = makeApp();
    services.registry.registerReport(
      defineReport({
        name: "Count Threshold",
        doctype: "Note",
        columns: [{ name: "title" }],
        filters: [{ name: "minimum", label: "Minimum Count", field: "count", operator: "gte" }],
        roles: ["User"]
      })
    );

    const response = await app.request("/api/report/Count%20Threshold/run?filter_minimum=many", {
      headers: userHeaders
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Report filter 'minimum' must be an integer" }
    });
  });

  it("maps invalid report ordering to JSON errors", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/report/Open%20Notes/run?order=sideways", {
      headers: userHeaders
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Report order must be asc or desc" }
    });
  });

  it("exports a report as filtered CSV", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low", count: 2 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note A", priority: "High", body: "Needs care", count: 7 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note B", priority: "High", body: "Later", count: 3 }) });

    const response = await app.request("/api/report/Open%20Notes/export.csv?filter_priority=High&limit=1", { headers: userHeaders });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Open-Notes.csv"');
    expect(response.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(response.headers.get("x-cf-frappe-exported")).toBe("1");
    expect(response.headers.get("x-cf-frappe-export-limit")).toBe("1");
    expect(response.headers.get("x-cf-frappe-export-truncated")).toBe("true");
    await expect(response.text()).resolves.toBe("Title,Priority,Body\nHigh Note A,High,Needs care");
  });

  it("renders a report as PDF through the configured renderer", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const renderer = new RecordingPrintPdfRenderer({ body: pdf, contentLength: pdf.byteLength });
    const { app, services } = makeApp({ printPdfRenderer: renderer });
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Beta Note", priority: "High", body: "Later", count: 2 }) });
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Alpha Note", priority: "High", body: "Needs care", count: 5 }) });
    await services.printSettings.change({
      actor: { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] },
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
          font: { family: "Inter", sizePt: 10 }
        }
      }
    });

    const response = await app.request(
      "/api/report/Open%20Notes/pdf?filter_priority=High&order_by=title&order=asc&limit=1",
      { headers: userHeaders }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Open-Notes.report.pdf"');
    expect(response.headers.get("content-length")).toBe(String(pdf.byteLength));
    await expect(response.arrayBuffer()).resolves.toEqual(pdf.buffer);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0]).toMatchObject({
      actorId: owner.id,
      tenantId: owner.tenantId,
      formatName: "Report",
      documentName: "Open Notes",
      documentDoctype: "Note",
      title: "Open Notes - Report",
      layout: {
        pageSize: "A4",
        orientation: "landscape",
        margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
        font: { family: "Inter", sizePt: 10 }
      }
    });
    expect(renderer.calls[0]?.html).toContain("@page { size: A4 landscape; margin: 12mm 10mm 14mm 10mm; }");
    expect(renderer.calls[0]?.html).toContain("<dt>Priority</dt><dd>High</dd>");
    expect(renderer.calls[0]?.html).toContain("<td>Alpha Note</td>");
    expect(renderer.calls[0]?.html).not.toContain("<td>Beta Note</td>");
  });

  it("serves custom row-provider reports through the report API", async () => {
    const services = createServices(["e1"]);
    services.registry.registerReport(
      defineReport({
        name: "Priority Metrics",
        doctype: "Note",
        source: { kind: "custom", provider: "priority-metrics" },
        columns: [
          { name: "priority", label: "Priority", type: "select" },
          { name: "open_count", label: "Open Count", type: "integer" }
        ],
        filters: [{ name: "minimum", field: "open_count", type: "integer", operator: "gte" }],
        orderBy: "open_count",
        order: "desc",
        roles: ["User"]
      })
    );
    const reports = new ReportService({
      registry: services.registry,
      queries: services.queries,
      rowProviders: {
        "priority-metrics": {
          async rows() {
            return [
              { priority: "Low", open_count: 1 },
              { priority: "High", open_count: 7 },
              { priority: "Medium", open_count: 3 }
            ];
          }
        }
      }
    });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports,
      actor: unsafeHeaderActorResolver
    });

    const response = await app.request(
      "/api/report/Priority%20Metrics/run?filter_minimum=3&order_by=open_count&order=desc&limit=1",
      { headers: userHeaders }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ priority: "High", open_count: 7 }],
      total: 2,
      filters: [{ name: "minimum", value: 3 }],
      order: { orderBy: "open_count", order: "desc" }
    });

    const csv = await app.request(
      "/api/report/Priority%20Metrics/export.csv?filter_minimum=3&order_by=open_count&order=asc",
      { headers: userHeaders }
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Priority-Metrics.csv"');
    await expect(csv.text()).resolves.toBe("Priority,Open Count\nMedium,3\nHigh,7");
  });

  it("hides reports from actors without report roles", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/reports", {
      headers: { ...userHeaders, "x-cf-frappe-user": "guest", "x-cf-frappe-roles": "Guest" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });
});
