import { createResourceApi, unsafeHeaderActorResolver } from "../../src";
import { createServices, data, owner } from "../helpers";

describe("saved report api", () => {
  const userHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  function makeApp() {
    const services = createServices(["doc-1", "doc-2", "doc-3"], {
      savedReportIds: ["high-counts", "event-1", "event-2", "event-3", "event-4"]
    });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports: services.reports,
      savedReports: services.savedReports,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  it("creates, lists, reads, updates, and deletes report-builder definitions", async () => {
    const { app } = makeApp();

    const created = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "High counts",
        definition: highCountsDefinition()
      })
    });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        id: "report_high-counts",
        doctype: "Note",
        label: "High counts",
        ownerId: "owner@example.com",
        definition: { columns: [{ name: "title" }, { name: "count" }] }
      }
    });

    const listed = await app.request("/api/report-builder/Note", { headers: userHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: [{ id: "report_high-counts", label: "High counts" }]
    });

    const read = await app.request("/api/report-builder/Note/report_high-counts", { headers: userHeaders });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      data: { id: "report_high-counts", label: "High counts" }
    });

    const updated = await app.request("/api/report-builder/Note/report_high-counts", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Titles only",
        definition: { columns: [{ name: "title", label: "Title" }], orderBy: "title", order: "asc" }
      })
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { id: "report_high-counts", label: "Titles only", definition: { orderBy: "title" } }
    });

    const deleted = await app.request("/api/report-builder/Note/report_high-counts", {
      method: "DELETE",
      headers: userHeaders
    });
    expect(deleted.status).toBe(204);

    const listedAfterDelete = await app.request("/api/report-builder/Note", { headers: userHeaders });
    await expect(listedAfterDelete.json()).resolves.toEqual({ data: [] });
  });

  it("runs and exports saved reports with query filters and ordering", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Count", priority: "Low", count: 1 }) });
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Count A", priority: "High", count: 3 }) });
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Count B", priority: "High", count: 7 }) });
    const created = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ label: "Counts", definition: highCountsDefinition() })
    });
    expect(created.status).toBe(201);

    const run = await app.request(
      "/api/report-builder/Note/report_high-counts/run?filter_priority=High&order_by=count&order=asc&limit=1",
      { headers: userHeaders }
    );

    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      report: { label: "Counts", doctype: "Note" },
      rows: [{ title: "High Count A", count: 3 }],
      summary: [{ name: "total_count", value: 10 }],
      order: { orderBy: "count", order: "asc" },
      total: 2
    });

    const csv = await app.request(
      "/api/report-builder/Note/report_high-counts/export.csv?filter_priority=High&order_by=count&order=desc&limit=1",
      { headers: userHeaders }
    );

    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Saved-Report-report_high-counts.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-exported")).toBe("1");
    await expect(csv.text()).resolves.toBe("Title,Count\nHigh Count B,7");
  });

  it("maps malformed saved report JSON to bounded JSON errors", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ label: "Missing definition" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Saved report definition must be an object" }
    });
  });

  it("maps metadata-invalid saved report definitions to JSON errors", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid",
        definition: { columns: [{ name: "missing" }] }
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "REPORT_INVALID",
        message: "Report 'Saved Report Draft' column 'missing' references unknown field 'missing'"
      }
    });
  });

  it("rejects invalid report display types before appending saved definition events", async () => {
    const { app } = makeApp();

    const columnType = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid column type",
        definition: { columns: [{ name: "title", type: "currency" }] }
      })
    });

    expect(columnType.status).toBe(400);
    await expect(columnType.json()).resolves.toMatchObject({
      error: {
        code: "REPORT_INVALID",
        message: "Report 'Saved Report Draft' column 'title' has invalid type 'currency'"
      }
    });

    const summaryType = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid summary type",
        definition: {
          columns: [{ name: "title" }],
          summaries: [{ name: "total_count", aggregate: "sum", field: "count", type: "currency" }]
        }
      })
    });

    expect(summaryType.status).toBe(400);
    await expect(summaryType.json()).resolves.toMatchObject({
      error: {
        code: "REPORT_INVALID",
        message: "Report 'Saved Report Draft' summary 'total_count' has invalid type 'currency'"
      }
    });

    const listed = await app.request("/api/report-builder/Note", { headers: userHeaders });
    await expect(listed.json()).resolves.toEqual({ data: [] });
  });

  it("protects report-builder definitions with DocType read permissions", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/report-builder/Note", {
      method: "POST",
      headers: {
        ...userHeaders,
        "x-cf-frappe-user": "stranger@example.com",
        "x-cf-frappe-roles": "Stranger"
      },
      body: JSON.stringify({
        label: "Guest report",
        definition: { columns: [{ name: "title" }] }
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED" }
    });
  });
});

function highCountsDefinition() {
  return {
    columns: [
      { name: "title", label: "Title" },
      { name: "count", label: "Count" }
    ],
    filters: [{ name: "priority", field: "priority", type: "select", defaultValue: "High" }],
    summaries: [{ name: "total_count", label: "Total Count", aggregate: "sum", field: "count", type: "integer" }],
    orderBy: "count",
    order: "desc"
  };
}
