import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  CustomFieldService,
  createDeskApp,
  createRegistry,
  DataPatchService,
  defineClientScript,
  defineDataPatch,
  defineDocType,
  defineWorkspace,
  deterministicIds,
  DocumentService,
  fileDocType,
  FileService,
  fixedClock,
  createJobRegistry,
  InMemoryEventStore,
  InMemoryDocumentStore,
  InMemoryDataPatchLog,
  InMemoryFileStorage,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  JobDispatcher,
  JobHistoryService,
  JobRetryService,
  JobScheduleService,
  QueryService,
  ReportService,
  RoleService,
  SavedListFilterService,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  UserNotificationService,
  UserProfileService,
  type DocTypeDefinition,
  type PasswordHasher
} from "../../src";
import {
  createChildTableServices,
  createLinkedServices,
  createSeriesServices,
  createServices,
  data,
  guest,
  manager,
  noteDocType,
  now,
  openNotesReport,
  owner
} from "../helpers";

describe("Desk app", () => {
  function makeDesk(
    actor = owner,
    options: { readonly realtime?: boolean; readonly documentShares?: boolean } = {}
  ) {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      queries: services.queries,
      ...(options.documentShares === false ? {} : { documentShares: services.documentShares }),
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      savedReports: services.savedReports,
      userPermissions: services.userPermissions,
      ...(options.realtime === undefined ? {} : { realtime: options.realtime }),
      actor: () => actor
    });
    return { app, services };
  }

  function makeAccountDesk(actor = owner) {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const userAccounts = new UserAccountService({
      events: services.store,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-1", "password-1", "roles-1", "disable-1", "enable-1"]),
      clock: fixedClock(now)
    });
    const userProfiles = new UserProfileService({
      events: services.store,
      ids: deterministicIds(["profile-1", "profile-2"]),
      clock: fixedClock(now)
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      queries: services.queries,
      documentShares: services.documentShares,
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      savedReports: services.savedReports,
      userAccounts,
      userProfiles,
      userPermissions: services.userPermissions,
      actor: () => actor
    });
    return { app, services: { ...services, userAccounts, userProfiles } };
  }

  function makeRoleDesk(actor = owner) {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const roles = new RoleService({
      events: services.store,
      ids: deterministicIds(["role-1", "describe-1", "disable-1", "enable-1"]),
      clock: fixedClock(now)
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      queries: services.queries,
      documentShares: services.documentShares,
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      savedReports: services.savedReports,
      roles,
      userPermissions: services.userPermissions,
      actor: () => actor
    });
    return { app, services: { ...services, roles } };
  }

  function makeCustomFieldDesk(actor = owner) {
    const services = createServices(["base-1", "base-2"]);
    const customFields = new CustomFieldService({
      registry: services.registry,
      events: services.store,
      ids: deterministicIds(["custom-field-1", "custom-field-2", "custom-field-3"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      customFields.effectiveDocType(base.name, context.tenantId);
    const documents = new DocumentService({
      registry: services.registry,
      store: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      userPermissions: services.userPermissions,
      ids: deterministicIds(["custom-doc-1", "custom-doc-2"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({
      registry: services.registry,
      projections: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      userPermissions: services.userPermissions
    });
    const savedFilters = new SavedListFilterService({
      registry: services.registry,
      events: services.store,
      doctypeResolver,
      ids: deterministicIds(["custom-saved-filter-1", "custom-saved-filter-event-1"]),
      clock: fixedClock(now)
    });
    const app = createDeskApp({
      registry: services.registry,
      documents,
      prints: services.prints,
      queries,
      documentShares: services.documentShares,
      reports: services.reports,
      timeline: services.history,
      savedFilters,
      savedReports: services.savedReports,
      customFields,
      userPermissions: services.userPermissions,
      actor: () => actor
    });
    return { app, services: { ...services, documents, queries, savedFilters, customFields } };
  }

  function makeChildTableCustomFieldDesk(actor = owner) {
    const services = createChildTableServices(["base-product", "base-invoice"]);
    const customFields = new CustomFieldService({
      registry: services.registry,
      events: services.store,
      ids: deterministicIds(["custom-field-1"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      customFields.effectiveDocType(base.name, context.tenantId);
    const documents = new DocumentService({
      registry: services.registry,
      store: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      ids: deterministicIds(["custom-product-1", "custom-product-2", "custom-invoice-1", "custom-invoice-2"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({
      registry: services.registry,
      projections: services.store,
      doctypeResolver,
      documentShares: services.documentShares
    });
    const app = createDeskApp({
      registry: services.registry,
      documents,
      queries,
      documentShares: services.documentShares,
      customFields,
      actor: () => actor
    });
    return { app, services: { ...services, documents, queries, customFields } };
  }

  function makeLinkedDesk() {
    const services = createLinkedServices(["p1", "p2", "t1"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => owner
    });
    return { app, services };
  }

  function makeChildTableDesk() {
    const services = createChildTableServices(["product-1", "product-2", "invoice-1", "invoice-2"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => owner
    });
    return { app, services };
  }

  function makeSeriesDesk(actor = owner, ids: readonly string[] = ["series-1", "ticket-1", "series-2", "ticket-2"]) {
    const services = createSeriesServices(ids);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => actor
    });
    return { app, services };
  }

  function makeFileDesk(
    actor = owner,
    options: {
      readonly maxFileBytes?: number;
      readonly ids?: readonly string[];
      readonly fileIds?: readonly string[];
      readonly doctypes?: readonly DocTypeDefinition[];
    } = {}
  ) {
    const registry = createRegistry({ doctypes: options.doctypes ?? [fileDocType] });
    const store = new InMemoryDocumentStore();
    const storage = new InMemoryFileStorage();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(options.ids ?? ["create", "request-delete", "delete"])
    });
    const queries = new QueryService({ registry, projections: store });
    const files = new FileService({
      registry,
      documents,
      queries,
      storage,
      clock: fixedClock(now),
      ids: deterministicIds(options.fileIds ?? ["object"]),
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes })
    });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      files,
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
      actor: () => actor
    });
    return { app, registry, store, storage, documents, queries, files };
  }

  it("renders a metadata-driven home page", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("cf-frappe Desk");
    expect(html).toContain("/desk/Note");
    expect(html).toContain("/desk/reports/Open%20Notes");
    expect(html).toContain("DocType");
  });

  it("renders metadata-defined workspaces with permissioned shortcuts", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      reports: [openNotesReport],
      workspaces: [
        defineWorkspace({
          name: "Operations",
          label: "Operations",
          description: "Daily workspace",
          roles: ["User"],
          sections: [
            {
              name: "main",
              label: "Main",
              shortcuts: [
                { name: "notes", label: "Notes", kind: "doctype", target: "Note" },
                { name: "open-notes", label: "Open Notes", kind: "report", target: "Open Notes" },
                { name: "manager-only", label: "Manager Only", kind: "doctype", target: "Note", roles: ["Task Manager"] }
              ]
            }
          ]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["workspace-test"])
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      reports,
      actor: () => owner
    });

    const home = await app.request("/desk");
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain('href="/desk/workspaces/Operations"');
    expect(homeHtml).toContain("Daily workspace");

    const workspace = await app.request("/desk/workspaces/Operations");
    expect(workspace.status).toBe(200);
    const html = await workspace.text();
    expect(html).toContain("Daily workspace");
    expect(html).toContain('href="/desk/Note"');
    expect(html).toContain('href="/desk/reports/Open%20Notes"');
    expect(html).not.toContain("Manager Only");
  });

  it("renders and updates a durable notification inbox in Desk", async () => {
    const services = createServices();
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      clock: fixedClock("2026-01-01T01:00:00.000Z"),
      ids: deterministicIds(["record-1", "read-1", "dismiss-1"])
    });
    await notifications.recordFromDomainEvent({
      id: "evt_assign",
      tenantId: "acme",
      stream: "acme:Note:My Note",
      sequence: 2,
      type: "NoteAssigned",
      doctype: "Note",
      documentName: "My Note",
      actorId: "owner@example.com",
      occurredAt: now,
      payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" },
      metadata: {}
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notifications,
      actor: () => ({ id: "support@example.com", roles: ["User"], tenantId: "acme" })
    });
    const actionBase = "/desk/notifications/evt_assign%3Auser%3Asupport%2540example.com";

    const response = await app.request("/desk/notifications");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("owner@example.com assigned you to Note My Note");
    expect(html).toContain("1 unread");
    expect(html).toContain(`formaction="${actionBase}/read"`);
    expect(html).toContain(`formaction="${actionBase}/dismiss"`);

    const read = await app.request(`${actionBase}/read`, { method: "POST" });

    expect(read.status).toBe(303);
    const readInbox = await app.request("/desk/notifications");
    expect(await readInbox.text()).toContain("<td>read</td>");

    const dismiss = await app.request(`${actionBase}/dismiss`, { method: "POST" });

    expect(dismiss.status).toBe(303);
    const hidden = await app.request("/desk/notifications");
    expect(await hidden.text()).toContain("No notifications.");
    const included = await app.request("/desk/notifications?include_dismissed=1");
    expect(await included.text()).toContain("<td>yes</td>");
  });

  it("renders report list and report result pages", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Report Note", priority: "High", body: "For reporting", count: 7 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Alpha Report", priority: "High", body: "Earlier title", count: 3 })
    });

    const list = await app.request("/desk/reports");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain("Open Notes");

    const report = await app.request("/desk/reports/Open%20Notes?filter_priority=High&order_by=title&order=desc");
    expect(report.status).toBe(200);
    const html = await report.text();
    expect(html).toContain("Report Note");
    expect(html.indexOf("Report Note")).toBeLessThan(html.indexOf("Alpha Report"));
    expect(html).toContain("For reporting");
    expect(html).toContain("Total Count");
    expect(html).toContain("By Priority");
    expect(html).toContain("Notes by Priority");
    expect(html).toContain("chart-svg chart-bar");
    expect(html).toContain('<select id="filter-priority" name="filter_priority">');
    expect(html).toContain('<option value="High" selected>High</option>');
    expect(html).toContain('name="filter_title" type="text" value=""');
    expect(html).toContain('<select id="report-order-by" name="order_by">');
    expect(html).toContain('<option value="title" selected>Title</option>');
    expect(html).toContain('<option value="desc" selected>Descending</option>');
    expect(html).toContain(
      '<a class="chart-drilldown" href="/desk/reports/Open%20Notes?filter_priority=High&amp;order_by=title&amp;order=desc"><g>'
    );
    expect(html).toContain("/desk/reports/Open%20Notes/export.csv?filter_priority=High&amp;order_by=title&amp;order=desc");

    const csv = await app.request("/desk/reports/Open%20Notes/export.csv?filter_priority=High&order_by=title&order=desc");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Open-Notes.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-exported")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-export-truncated")).toBe("false");
    await expect(csv.text()).resolves.toBe("Title,Priority,Body\nReport Note,High,For reporting\nAlpha Report,High,Earlier title");
  });

  it("builds, runs, exports, and deletes saved reports in Desk", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Count", priority: "Low", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Count A", priority: "High", count: 3 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Count B", priority: "High", count: 7 })
    });

    const reports = await app.request("/desk/reports");
    expect(reports.status).toBe(200);
    await expect(reports.text()).resolves.toContain("/desk/report-builder/Note");

    const builder = await app.request("/desk/report-builder/Note");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain("Note Report Builder");
    expect(builderHtml).toContain('name="column" value="title"');
    expect(builderHtml).toContain('name="filter" value="priority"');
    expect(builderHtml).toContain('name="summaryCount" value="1"');
    expect(builderHtml).toContain('name="summary" value="count"');
    expect(builderHtml).toContain('<select name="groupBy">');
    expect(builderHtml).toContain('<option value="priority">priority</option>');
    expect(builderHtml).toContain('<select name="chartType">');
    expect(builderHtml).toContain('<option value="sum_count">Total count</option>');
    expect(builderHtml).toContain('name="chartPalette"');
    expect(builderHtml).toContain('<select name="chartShowValues">');
    expect(builderHtml).toContain('name="chartXAxisLabel"');
    expect(builderHtml).toContain('name="chartYAxisLabel"');
    expect(builderHtml).toContain('name="formulaLabel"');
    expect(builderHtml).toContain('<select name="formulaOperator">');

    const body = new URLSearchParams();
    body.set("label", "High count desk report");
    body.append("column", "title");
    body.append("column", "count");
    body.set("formulaLabel", "Double Count");
    body.set("formulaLeft", "count");
    body.set("formulaOperator", "add");
    body.set("formulaRight", "count");
    body.append("filter", "priority");
    body.set("summaryCount", "1");
    body.append("summary", "count");
    body.set("groupBy", "priority");
    body.set("chartType", "bar");
    body.set("chartSummary", "sum_count");
    body.set("chartOrderBy", "value");
    body.set("chartOrder", "desc");
    body.set("chartMaxPoints", "3");
    body.set("chartPalette", "#123456, #abcdef");
    body.set("chartShowValues", "false");
    body.set("chartXAxisLabel", "Priority");
    body.set("chartYAxisLabel", "Total Count");
    body.set("orderBy", "count");
    body.set("order", "desc");
    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/report-builder/Note/report_saved-report-1");

    const run = await app.request(
      "/desk/report-builder/Note/report_saved-report-1?filter_priority=High&order_by=count&order=desc"
    );
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("High count desk report");
    expect(html).toContain("High Count B");
    expect(html.indexOf("High Count B")).toBeLessThan(html.indexOf("High Count A"));
    expect(html).toContain("<th>Double Count</th>");
    expect(html).toContain("<td>14</td>");
    expect(html).toContain("<dt>Summaries</dt><dd>Records, Total count</dd>");
    expect(html).toContain("<dt>Groups</dt><dd>By priority</dd>");
    expect(html).toContain("<dt>Charts</dt><dd>Chart</dd>");
    expect(html).toContain("<span>Records</span><strong>2</strong>");
    expect(html).toContain("<span>Total count</span><strong>10</strong>");
    expect(html).toContain("By priority");
    expect(html).toContain("chart-svg chart-bar");
    expect(html).toContain("Priority");
    expect(html).toContain("Total Count");
    expect(html).toContain("fill: #123456");
    expect(html).not.toContain('text-anchor="middle">10</text>');
    expect(html).toContain('<select id="filter-priority" name="filter_priority">');
    expect(html).toContain(
      '<a class="chart-drilldown" href="/desk/report-builder/Note/report_saved-report-1?filter_priority=High&amp;order_by=count&amp;order=desc"><g>'
    );
    expect(html).toContain("/desk/report-builder/Note/report_saved-report-1/export.csv?filter_priority=High&amp;order_by=count&amp;order=desc");
    expect(html).toContain('action="/desk/report-builder/Note/report_saved-report-1/delete"');
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        charts: [
          expect.objectContaining({
            colors: ["#123456", "#abcdef"],
            showValues: false,
            xAxisLabel: "Priority",
            yAxisLabel: "Total Count"
          })
        ],
        columns: [
          expect.objectContaining({ name: "title" }),
          expect.objectContaining({ name: "count" }),
          expect.objectContaining({
            name: "double_count",
            label: "Double Count",
            formula: { operator: "add", left: "count", right: "count" }
          })
        ]
      }
    });

    const csv = await app.request(
      "/desk/report-builder/Note/report_saved-report-1/export.csv?filter_priority=High&order_by=count&order=desc"
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Saved-Report-report_saved-report-1.csv"');
    await expect(csv.text()).resolves.toBe("title,count,Double Count\nHigh Count B,7,14\nHigh Count A,3,6");

    const deleted = await app.request("/desk/report-builder/Note/report_saved-report-1/delete", {
      method: "POST"
    });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/desk/report-builder/Note");
    const afterDelete = await app.request("/desk/report-builder/Note");
    await expect(afterDelete.text()).resolves.toContain("No saved reports.");
  });

  it("builds saved report charts without requiring a matching top-level summary", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Chart Count", priority: "Low", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Chart Count", priority: "High", count: 5 })
    });

    const body = new URLSearchParams();
    body.set("label", "Chart-only count report");
    body.append("column", "title");
    body.append("column", "count");
    body.set("groupBy", "priority");
    body.set("chartType", "bar");
    body.set("chartSummary", "sum_count");
    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/report-builder/Note/report_saved-report-1");

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("<dt>Groups</dt><dd>By priority</dd>");
    expect(html).toContain("<dt>Charts</dt><dd>Chart</dd>");
    expect(html).toContain("<th>Total count</th>");
    expect(html).toContain("chart-svg chart-bar");
  });

  it("escapes saved report builder labels and rejects invalid builder fields", async () => {
    const { app } = makeDesk();
    const xssBody = new URLSearchParams();
    xssBody.set("label", "<script>alert('report')</script>");
    xssBody.append("column", "title");
    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: xssBody
    });
    expect(saved.status).toBe(303);

    const builder = await app.request("/desk/report-builder/Note");
    const html = await builder.text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;report&#39;)&lt;/script&gt;");

    const invalidBody = new URLSearchParams();
    invalidBody.set("label", "Invalid report");
    invalidBody.append("column", "missing");
    const invalid = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidBody
    });

    expect(invalid.status).toBe(400);
    await expect(invalid.text()).resolves.toContain("Unknown report column &#39;missing&#39;");
  });

  it("rejects invalid saved report groups and chart summaries without persisting them", async () => {
    const { app } = makeDesk();
    const invalidGroupBody = new URLSearchParams();
    invalidGroupBody.set("label", "Invalid group report");
    invalidGroupBody.append("column", "title");
    invalidGroupBody.set("groupBy", "missing");
    const invalidGroup = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidGroupBody
    });

    expect(invalidGroup.status).toBe(400);
    await expect(invalidGroup.text()).resolves.toContain("Unknown report group &#39;missing&#39;");

    const invalidChartBody = new URLSearchParams();
    invalidChartBody.set("label", "Invalid chart report");
    invalidChartBody.append("column", "title");
    invalidChartBody.set("groupBy", "priority");
    invalidChartBody.set("chartType", "bar");
    invalidChartBody.set("chartSummary", "missing");
    const invalidChart = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidChartBody
    });

    expect(invalidChart.status).toBe(400);
    await expect(invalidChart.text()).resolves.toContain("Unknown report chart summary &#39;missing&#39;");

    const invalidChartLimitBody = new URLSearchParams();
    invalidChartLimitBody.set("label", "Invalid chart limit report");
    invalidChartLimitBody.append("column", "title");
    invalidChartLimitBody.set("groupBy", "priority");
    invalidChartLimitBody.set("chartType", "bar");
    invalidChartLimitBody.set("chartMaxPoints", "51");
    const invalidChartLimit = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidChartLimitBody
    });

    expect(invalidChartLimit.status).toBe(400);
    await expect(invalidChartLimit.text()).resolves.toContain("Report chart max points must be at most 50");

    const invalidChartColorBody = new URLSearchParams();
    invalidChartColorBody.set("label", "Invalid chart color report");
    invalidChartColorBody.append("column", "title");
    invalidChartColorBody.set("groupBy", "priority");
    invalidChartColorBody.set("chartType", "bar");
    invalidChartColorBody.set("chartPalette", "#123456, blue");
    const invalidChartColor = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidChartColorBody
    });

    expect(invalidChartColor.status).toBe(400);
    await expect(invalidChartColor.text()).resolves.toContain("Report chart color &#39;blue&#39; is invalid");

    const builder = await app.request("/desk/report-builder/Note");
    await expect(builder.text()).resolves.toContain("No saved reports.");
  });

  it("rejects invalid saved report chart display controls without persisting them", async () => {
    const { app } = makeDesk();
    const invalidValuesBody = new URLSearchParams();
    invalidValuesBody.set("label", "Invalid chart values report");
    invalidValuesBody.append("column", "title");
    invalidValuesBody.set("groupBy", "priority");
    invalidValuesBody.set("chartType", "bar");
    invalidValuesBody.set("chartShowValues", "maybe");
    const invalidValues = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidValuesBody
    });

    expect(invalidValues.status).toBe(400);
    await expect(invalidValues.text()).resolves.toContain("Report chart show values must be true or false");

    const builder = await app.request("/desk/report-builder/Note");
    await expect(builder.text()).resolves.toContain("No saved reports.");
  });

  it("renders a Desk file manager for upload, metadata, download, and delete workflows", async () => {
    const { app, storage } = makeFileDesk(owner, {
      ids: [
        "create",
        "create-other",
        "create-html",
        "bulk-metadata",
        "bulk-request-delete",
        "bulk-delete",
        "metadata",
        "request-delete",
        "delete"
      ],
      fileIds: ["object", "other", "html"]
    });

    const home = await app.request("/desk");
    expect(home.status).toBe(200);
    await expect(home.text()).resolves.toContain('href="/desk/files"');

    const uploadForm = new FormData();
    uploadForm.append("file", new Blob(["hello"], { type: "text/plain" }), "hello.txt");
    uploadForm.set("is_private", "1");
    const uploaded = await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: uploadForm
    });
    expect(uploaded.status).toBe(303);
    expect(uploaded.headers.get("location")).toBe("/desk/files");

    const otherUploadForm = new FormData();
    otherUploadForm.append("file", new Blob(["{}"], { type: "application/json" }), "public.json");
    const otherUploaded = await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: otherUploadForm
    });
    expect(otherUploaded.status).toBe(303);
    const htmlUploadForm = new FormData();
    htmlUploadForm.append("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "inline.html");
    const htmlUploaded = await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: htmlUploadForm
    });
    expect(htmlUploaded.status).toBe(303);

    const list = await app.request("/desk/files");
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain("hello.txt");
    expect(html).toContain("public.json");
    expect(html).toContain("inline.html");
    expect(html).toContain("/desk/files/file_object/content");
    expect(html).toContain("/desk/files/file_object/preview");
    expect(html).toContain("/desk/files/file_html/content");
    expect(html).not.toContain("/desk/files/file_html/preview");
    expect(html).toContain('action="/desk/files/file_object/metadata"');
    expect(html).toContain('formaction="/desk/files/file_object/delete"');
    expect(html).toContain('name="filename"');
    expect(html).toContain('name="content_type"');
    expect(html).toContain('name="uploaded_by"');
    expect(html).toContain('name="storage_state"');
    expect(html).toContain('name="scan_status"');
    expect(html).toContain('name="is_private"');
    expect(html).toContain('name="bulk_is_private"');
    expect(html).toContain('name="bulk_attached_to_doctype"');
    expect(html).toContain('formaction="/desk/files/bulk-metadata"');
    expect(html).toContain('formaction="/desk/files/bulk-delete"');
    expect(html).toContain('name="file" value="file_other"');

    const filteredList = await app.request(
      "/desk/files?filename=hello&content_type=text/plain&uploaded_by=owner%40example.com&storage_state=available&is_private=1&limit=10"
    );
    expect(filteredList.status).toBe(200);
    const filteredHtml = await filteredList.text();
    expect(filteredHtml).toContain("hello.txt");
    expect(filteredHtml).not.toContain("public.json");
    expect(filteredHtml).toContain('value="hello"');
    expect(filteredHtml).toContain('value="text/plain"');
    expect(filteredHtml).toContain('value="owner@example.com"');
    expect(filteredHtml).toContain('<option value="available" selected>Available</option>');
    expect(filteredHtml).toContain('<option value="1" selected>Private</option>');

    const publicList = await app.request("/desk/files?is_private=0&limit=10");
    expect(publicList.status).toBe(200);
    const publicHtml = await publicList.text();
    expect(publicHtml).toContain("public.json");
    expect(publicHtml).not.toContain("hello.txt");

    const invalidPrivacy = await app.request("/desk/files?is_private=maybe");
    expect(invalidPrivacy.status).toBe(400);
    await expect(invalidPrivacy.text()).resolves.toContain("Expected boolean query parameter");

    const bulkMetadata = await app.request("/desk/files/bulk-metadata", {
      method: "POST",
      body: new URLSearchParams({
        file: "file_object",
        "expectedVersion:file_object": "1",
        bulk_is_private: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(bulkMetadata.status).toBe(303);
    expect(bulkMetadata.headers.get("location")).toBe("/desk/files");

    const publicAfterBulkMetadata = await app.request("/desk/files?is_private=0&limit=10");
    const publicAfterBulkMetadataHtml = await publicAfterBulkMetadata.text();
    expect(publicAfterBulkMetadataHtml).toContain("hello.txt");
    expect(publicAfterBulkMetadataHtml).toContain("public.json");

    const bulkDeleted = await app.request("/desk/files/bulk-delete", {
      method: "POST",
      body: new URLSearchParams({
        file: "file_other",
        "expectedVersion:file_other": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(bulkDeleted.status).toBe(303);
    expect(bulkDeleted.headers.get("location")).toBe("/desk/files");
    expect(storage.has("acme/files/file_other-public.json")).toBe(false);
    expect(storage.has("acme/files/file_object-hello.txt")).toBe(true);

    const genericCommand = await app.request("/desk/File/file_object/command/updateMetadata", {
      method: "POST",
      body: new URLSearchParams({ filename: "bypass.txt", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(genericCommand.status).toBe(403);

    const metadata = await app.request("/desk/files/file_object/metadata", {
      method: "POST",
      body: new URLSearchParams({ filename: "renamed.txt", expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(metadata.status).toBe(303);
    expect(metadata.headers.get("location")).toBe("/desk/files");

    const renamedList = await app.request("/desk/files");
    const renamedHtml = await renamedList.text();
    expect(renamedHtml).toContain("renamed.txt");

    const downloaded = await app.request("/desk/files/file_object/content");
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toBe('attachment; filename="renamed.txt"');
    await expect(downloaded.text()).resolves.toBe("hello");
    const preview = await app.request("/desk/files/file_object/preview");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-disposition")).toBe('inline; filename="renamed.txt"');
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(preview.text()).resolves.toBe("hello");
    const unsupportedPreview = await app.request("/desk/files/file_html/preview");
    expect(unsupportedPreview.status).toBe(400);
    await expect(unsupportedPreview.text()).resolves.toContain("File &#39;file_html&#39; cannot be previewed");

    const deleted = await app.request("/desk/files/file_object/delete", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "3" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(deleted.status).toBe(303);
    expect(storage.has("acme/files/file_object-hello.txt")).toBe(false);
  });

  it("reports Desk bulk file delete failures while preserving successful deletes", async () => {
    const { app, storage } = makeFileDesk(owner, {
      ids: ["create-1", "create-2", "request-delete-1", "delete-1"],
      fileIds: ["selected", "stale"]
    });
    const selected = new FormData();
    selected.append("file", new Blob(["selected"], { type: "text/plain" }), "selected.txt");
    selected.set("is_private", "1");
    await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: selected
    });
    const stale = new FormData();
    stale.append("file", new Blob(["stale"], { type: "text/plain" }), "stale.txt");
    stale.set("is_private", "1");
    await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: stale
    });

    const bulkBody = new URLSearchParams();
    bulkBody.append("file", "file_selected");
    bulkBody.set("expectedVersion:file_selected", "1");
    bulkBody.append("file", "file_stale");
    bulkBody.set("expectedVersion:file_stale", "99");
    const response = await app.request("/desk/files/bulk-delete", {
      method: "POST",
      body: bulkBody,
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("1 file could not be deleted");
    expect(storage.has("acme/files/file_selected-selected.txt")).toBe(false);
    expect(storage.has("acme/files/file_stale-stale.txt")).toBe(true);
  });

  it("reports Desk bulk file metadata failures while preserving successful updates", async () => {
    const { app, files } = makeFileDesk(owner, {
      ids: ["create-1", "create-2", "metadata-1"],
      fileIds: ["selected", "stale"]
    });
    const selected = new FormData();
    selected.append("file", new Blob(["selected"], { type: "text/plain" }), "selected.txt");
    selected.set("is_private", "1");
    await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: selected
    });
    const stale = new FormData();
    stale.append("file", new Blob(["stale"], { type: "text/plain" }), "stale.txt");
    stale.set("is_private", "1");
    await app.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: stale
    });

    const bulkBody = new URLSearchParams();
    bulkBody.append("file", "file_selected");
    bulkBody.set("expectedVersion:file_selected", "1");
    bulkBody.append("file", "file_stale");
    bulkBody.set("expectedVersion:file_stale", "99");
    bulkBody.set("bulk_is_private", "0");
    const response = await app.request("/desk/files/bulk-metadata", {
      method: "POST",
      body: bulkBody,
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("1 file metadata update failed");
    await expect(files.get(owner, "file_selected")).resolves.toMatchObject({
      expectedVersion: 2,
      isPrivate: false
    });
    await expect(files.get(owner, "file_stale")).resolves.toMatchObject({
      expectedVersion: 1,
      isPrivate: true
    });
  });

  it("manages record attachments directly from generated Desk document forms", async () => {
    const { app, storage, documents, files } = makeFileDesk(owner, {
      doctypes: [noteDocType, fileDocType],
      ids: ["note-create", "file-create", "other-create", "request-delete", "delete"],
      fileIds: ["attachment", "other"]
    });
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const emptyForm = await app.request("/desk/Note/My%20Note");
    expect(emptyForm.status).toBe(200);
    const emptyHtml = await emptyForm.text();
    expect(emptyHtml).toContain("Attachments");
    expect(emptyHtml).toContain('action="/desk/Note/My%20Note/files"');
    expect(emptyHtml).toContain("No files attached.");

    const uploadForm = new FormData();
    uploadForm.append("file", new Blob(["proposal"], { type: "text/plain" }), "proposal.txt");
    uploadForm.set("is_private", "1");
    const uploaded = await app.request("/desk/Note/My%20Note/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: uploadForm
    });
    expect(uploaded.status).toBe(303);
    expect(uploaded.headers.get("location")).toBe("/desk/Note/My%20Note");

    const form = await app.request("/desk/Note/My%20Note");
    const html = await form.text();
    expect(html).toContain("proposal.txt");
    expect(html).toContain("/desk/files/file_attachment/content");
    expect(html).toContain("/desk/files/file_attachment/preview");
    expect(html).toContain("/desk/files?attached_to_doctype=Note&amp;attached_to_name=My%20Note");
    expect(html).toContain('formaction="/desk/Note/My%20Note/files/file_attachment/delete"');

    const attachmentDashboard = await files.dashboard(owner, {
      attachedToDoctype: "Note",
      attachedToName: "My Note"
    });
    expect(attachmentDashboard.files).toMatchObject([
      {
        name: "file_attachment",
        filename: "proposal.txt",
        attachedTo: { doctype: "Note", name: "My Note" }
      }
    ]);

    const other = await files.upload({
      actor: owner,
      filename: "loose.txt",
      body: "loose",
      contentType: "text/plain"
    });
    const wrongDelete = await app.request(`/desk/Note/My%20Note/files/${other.snapshot.name}/delete`, {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(wrongDelete.status).toBe(404);
    expect(storage.has("acme/files/file_other-loose.txt")).toBe(true);

    const downloaded = await app.request("/desk/files/file_attachment/content");
    expect(downloaded.status).toBe(200);
    await expect(downloaded.text()).resolves.toBe("proposal");
    const preview = await app.request("/desk/files/file_attachment/preview");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-disposition")).toBe('inline; filename="proposal.txt"');
    await expect(preview.text()).resolves.toBe("proposal");

    const deleted = await app.request("/desk/Note/My%20Note/files/file_attachment/delete", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/desk/Note/My%20Note");
    expect(storage.has("acme/files/file_attachment-proposal.txt")).toBe(false);

    const afterDelete = await app.request("/desk/Note/My%20Note");
    await expect(afterDelete.text()).resolves.toContain("No files attached.");
  });

  it("rejects oversized Desk file uploads before parsing multipart content", async () => {
    const { app, storage } = makeFileDesk(owner, { maxFileBytes: 4 });

    const response = await app.request("/desk/files", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=oversized",
        "content-length": "99"
      },
      body: "--oversized--"
    });

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("File exceeds 4 bytes");
    expect(storage.has("acme/files/file_object-hello.txt")).toBe(false);
  });

  it("requires Desk file uploads to declare content length before parsing multipart content", async () => {
    const { app, storage } = makeFileDesk();

    const response = await app.request("/desk/files", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=missing-length"
      },
      body: "--missing-length--"
    });

    expect(response.status).toBe(411);
    const html = await response.text();
    expect(html).toContain("content-length is required for file uploads");
    expect(storage.has("acme/files/file_object-hello.txt")).toBe(false);
  });

  it("enforces File permissions for Desk content and delete routes", async () => {
    const services = makeFileDesk(owner);
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "private.txt",
      body: "secret",
      contentType: "text/plain"
    });
    const guestApp = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      files: services.files,
      actor: () => guest
    });

    const downloaded = await guestApp.request(`/desk/files/${uploaded.snapshot.name}/content`);
    expect(downloaded.status).toBe(403);
    await expect(downloaded.text()).resolves.toContain("cannot read File");
    const preview = await guestApp.request(`/desk/files/${uploaded.snapshot.name}/preview`);
    expect(preview.status).toBe(403);
    await expect(preview.text()).resolves.toContain("cannot read File");

    const deleted = await guestApp.request(`/desk/files/${uploaded.snapshot.name}/delete`, {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(deleted.status).toBe(403);
    expect(services.storage.has("acme/files/file_object-private.txt")).toBe(true);
  });

  it("renders list and create form pages", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const list = await app.request("/desk/Note");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain("My Note");

    const form = await app.request("/desk/Note/new");
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('name="title"');
    expect(html).toContain('name="body"');
    expect(html).toContain("<h3>Summary</h3>");
    expect(html).toContain("<h3>Details</h3>");
    expect(html.indexOf('name="title"')).toBeLessThan(html.indexOf('name="body"'));
    expect(html).toContain('class="fields cols-1"');
    expect(html).toContain('class="fields cols-2"');
    expect(html).toContain("Create");
  });

  it("renders model-declared client scripts for list and form pages", async () => {
    const { app, services } = makeDesk();
    services.registry.registerClientScript(
      defineClientScript({ name: "note-list", doctype: "Note", src: "/assets/note-list.js", scope: "list", type: "classic" })
    );
    services.registry.registerClientScript(
      defineClientScript({ name: "note-form", doctype: "Note", src: "/assets/note-form.js", scope: "form" })
    );
    services.registry.registerClientScript(
      defineClientScript({ name: "note-shared", doctype: "Note", src: "/assets/note-shared.js", scope: "both" })
    );
    services.registry.registerClientScript(
      defineClientScript({
        name: 'note-"<form>',
        doctype: "Note",
        src: '/assets/note-"<form>.js',
        scope: "form"
      })
    );
    const document = await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: 'Script " <Note>' })
    });

    const list = await app.request("/desk/Note");
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain('src="/desk/client.js" data-cf-frappe-runtime="desk"');
    expect(listHtml).toContain('data-cf-frappe-runtime="desk" data-doctype="Note" data-scope="list"');
    expect(listHtml).toContain('src="/assets/note-list.js" data-cf-frappe-script="note-list"');
    expect(listHtml.indexOf('src="/desk/client.js"')).toBeLessThan(listHtml.indexOf('src="/assets/note-list.js"'));
    expect(listHtml).toContain('data-scope="list"');
    expect(listHtml).toContain('src="/assets/note-shared.js"');
    expect(listHtml).not.toContain('src="/assets/note-form.js"');
    expect(listHtml).not.toContain('type="module" src="/assets/note-list.js"');

    const create = await app.request("/desk/Note/new");
    expect(create.status).toBe(200);
    const createHtml = await create.text();
    expect(createHtml).toContain('src="/desk/client.js" data-cf-frappe-runtime="desk"');
    expect(createHtml).toContain('data-cf-frappe-runtime="desk" data-doctype="Note" data-scope="form"');
    expect(createHtml).toContain('type="module" src="/assets/note-form.js"');
    expect(createHtml).toContain('data-scope="form"');
    expect(createHtml).toContain('src="/assets/note-shared.js"');
    expect(createHtml).not.toContain('src="/assets/note-list.js"');
    expect(createHtml).not.toContain("data-document-name=");

    const update = await app.request(`/desk/Note/${encodeURIComponent(document.name)}`);
    expect(update.status).toBe(200);
    const updateHtml = await update.text();
    expect(updateHtml).toContain('src="/assets/note-&quot;&lt;form&gt;.js"');
    expect(updateHtml).toContain('data-cf-frappe-script="note-&quot;&lt;form&gt;"');
    expect(updateHtml).toContain('data-document-name="Script &quot; &lt;Note&gt;"');
    expect(updateHtml).toContain('data-tenant-id="acme"');
  });

  it("renders realtime document presence panels on generated update forms when enabled", async () => {
    const { app, services } = makeDesk(owner, { realtime: true });
    const document = await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Collaborative Note" })
    });

    const response = await app.request(`/desk/Note/${encodeURIComponent(document.name)}`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-cf-frappe-presence="document"');
    expect(html).toContain('data-doctype="Note"');
    expect(html).toContain('data-document-name="Collaborative Note"');
    expect(html).toContain('data-realtime-route="/api/realtime"');
    expect(html).toContain('data-tenant-id="acme"');
    expect(html).toContain("Checking active collaborators.");

    const create = await app.request("/desk/Note/new");
    await expect(create.text()).resolves.not.toContain('data-cf-frappe-presence="document"');
  });

  it("serves a built-in Desk client API for model client scripts", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk/client.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    const source = await response.text();
    expect(source).toContain("root.cfFrappe");
    expect(source).toContain("form: Object.freeze");
    expect(source).toContain("documentTopic(tenantId, doctype, name)");
    expect(source).toContain("userTopic(tenantId, userId)");
    expect(source).toContain("resourcePath(doctype, name) + \"/transition/\"");
    expect(source).toContain("new WebSocket(realtimeUrl(topic, options)");
    expect(source).toContain("subscribeDocument");
    expect(source).toContain("DocumentUserNotification");
    expect(source).toContain("cf-frappe.realtime.replay");
    expect(() => new Function(source)).not.toThrow();
  });

  it("renders metadata-driven list filters", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk High", priority: "High", body: "Hidden body", count: 7 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Low", priority: "Low", body: "Routine", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Closed High", priority: "High", workflow_state: "Closed", body: "Closed", count: 3 })
    });

    const response = await app.request("/desk/Note?filter_priority=High");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Desk High");
    expect(html).not.toContain("Desk Low");
    expect(html).not.toContain("Desk Closed High");
    expect(html).not.toContain("Hidden body");
    expect(html).toContain("<th>title</th><th>priority</th><th>workflow_state</th>");
    expect(html).toContain('name="filter_title__contains"');
    expect(html).toContain('name="filter_title__ne"');
    expect(html).toContain('name="filter_priority"');
    expect(html).toContain('name="filter_priority__ne"');
    expect(html).toContain('name="filter_count__gte"');
    expect(html).toContain('name="filter_count__lte"');
    expect(html).toContain('<option value="High" selected>High</option>');
    expect(html).toContain('<option value="Open" selected>Open</option>');
    expect(html).toContain("/desk/Note?default_filters=0");

    const closed = await app.request("/desk/Note?filter_priority=High&filter_workflow_state=Closed");
    expect(closed.status).toBe(200);
    const closedHtml = await closed.text();
    expect(closedHtml).toContain("Desk Closed High");
    expect(closedHtml).not.toContain("Desk High");
    expect(closedHtml).toContain('<option value="Closed" selected>Closed</option>');

    const advanced = await app.request("/desk/Note?filter_priority__ne=Low&filter_count__gte=2&filter_count__lte=8");
    expect(advanced.status).toBe(200);
    const advancedHtml = await advanced.text();
    expect(advancedHtml).toContain("Desk High");
    expect(advancedHtml).not.toContain("Desk Low");
    expect(advancedHtml).not.toContain("Desk Closed High");
    expect(advancedHtml).toContain('<option value="Low" selected>Low</option>');
    expect(advancedHtml).toContain('name="filter_count__gte" value="2"');
    expect(advancedHtml).toContain('name="filter_count__lte" value="8"');
  });

  it("renders and submits generated list bulk document deletes", async () => {
    const { app, services } = makeDesk(manager);
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Selected" })
    });
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Keep" })
    });

    const list = await app.request("/desk/Note");

    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain('formaction="/desk/Note/bulk-delete"');
    expect(html).toContain('name="document" type="checkbox" value="Desk Bulk Selected"');
    expect(html).toContain('name="expectedVersion:Desk Bulk Selected" type="hidden" value="1"');

    const deleted = await app.request("/desk/Note/bulk-delete", {
      method: "POST",
      body: new URLSearchParams({
        document: "Desk Bulk Selected",
        "expectedVersion:Desk Bulk Selected": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/desk/Note");

    const after = await app.request("/desk/Note");
    const afterHtml = await after.text();
    expect(afterHtml).not.toContain("Desk Bulk Selected");
    expect(afterHtml).toContain("Desk Bulk Keep");
  });

  it("renders and submits generated list bulk workflow transitions", async () => {
    const { app, services } = makeDesk(owner);
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Bulk Transition" })
    });

    const list = await app.request("/desk/Note");

    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain('formaction="/desk/Note/bulk-transition/close"');
    expect(html).toContain("Close selected");

    const transitioned = await app.request("/desk/Note/bulk-transition/close", {
      method: "POST",
      body: new URLSearchParams({
        document: "Desk Bulk Transition",
        "expectedVersion:Desk Bulk Transition": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(transitioned.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "Desk Bulk Transition")).resolves.toMatchObject({
      data: { workflow_state: "Closed" }
    });
  });

  it("renders and submits generated list bulk lifecycle actions for DocTypes without workflow", async () => {
    const { app, services } = makeSeriesDesk(owner, ["series-1", "ticket-1", "series-2", "ticket-2", "submit-1", "cancel-1"]);
    await services.documents.create({
      actor: owner,
      doctype: "Support Ticket",
      data: { subject: "Lifecycle selected" }
    });
    await services.documents.create({
      actor: owner,
      doctype: "Support Ticket",
      data: { subject: "Lifecycle keep" }
    });

    const list = await app.request("/desk/Support%20Ticket");

    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain('formaction="/desk/Support%20Ticket/bulk-submit"');
    expect(html).toContain("Submit selected");
    expect(html).not.toContain('formaction="/desk/Support%20Ticket/bulk-cancel"');

    const submitted = await app.request("/desk/Support%20Ticket/bulk-submit", {
      method: "POST",
      body: new URLSearchParams({
        document: "TICK-.0001",
        "expectedVersion:TICK-.0001": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(submitted.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Support Ticket", "TICK-.0001")).resolves.toMatchObject({
      docstatus: "submitted"
    });

    const submittedList = await app.request("/desk/Support%20Ticket");
    expect(await submittedList.text()).toContain('formaction="/desk/Support%20Ticket/bulk-cancel"');

    const cancelled = await app.request("/desk/Support%20Ticket/bulk-cancel", {
      method: "POST",
      body: new URLSearchParams({
        document: "TICK-.0001",
        "expectedVersion:TICK-.0001": "2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(cancelled.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Support Ticket", "TICK-.0001")).resolves.toMatchObject({
      docstatus: "cancelled"
    });
  });

  it("hides generated list bulk delete actions from actors without delete permission", async () => {
    const { app, services } = makeDesk(owner);
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Owner Note" })
    });

    const response = await app.request("/desk/Note");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.not.toContain('formaction="/desk/Note/bulk-delete"');
  });

  it("reports generated list bulk document delete failures while preserving successful deletes", async () => {
    const { app, services } = makeDesk(manager);
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Partial Selected" })
    });
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Partial Stale" })
    });
    const body = new URLSearchParams();
    body.append("document", "Desk Bulk Partial Selected");
    body.set("expectedVersion:Desk Bulk Partial Selected", "1");
    body.append("document", "Desk Bulk Partial Stale");
    body.set("expectedVersion:Desk Bulk Partial Stale", "99");

    const response = await app.request("/desk/Note/bulk-delete", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("1 document could not be deleted");
    await expect(services.queries.getDocument(manager, "Note", "Desk Bulk Partial Stale")).resolves.toMatchObject({
      docstatus: "draft"
    });
    await expect(services.queries.getDocument(manager, "Note", "Desk Bulk Partial Selected")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("saves, applies, and deletes Desk list filters", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Saved High", priority: "High", body: "High" })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Saved Low", priority: "Low", body: "Low" })
    });

    const saved = await app.request("/desk/Note/saved-filters", {
      method: "POST",
      body: new URLSearchParams({ saved_filter_label: "High notes", filter_priority: "High" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(saved.status).toBe(303);
    const location = saved.headers.get("location") ?? "";
    expect(location).toContain("/desk/Note?saved_filter=");

    const list = await app.request(location);
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain("High notes");
    expect(html).toContain("Desk Saved High");
    expect(html).not.toContain("Desk Saved Low");
    expect(html).toContain("/desk/Note/saved-filters/");
    expect(html).toContain("/delete");

    const id = new URL(`http://localhost${location}`).searchParams.get("saved_filter");
    const deleted = await app.request(`/desk/Note/saved-filters/${id}/delete`, { method: "POST" });

    expect(deleted.status).toBe(303);
    await expect(services.savedFilters.list(owner, "Note")).resolves.toEqual([]);
  });

  it("renders and mutates user permissions from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const { app, services } = makeDesk(admin);
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Permission Target" }) });

    const empty = await app.request("/desk/admin/user-permissions?user=owner%40example.com");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("User Permissions");
    expect(emptyHtml).toContain('name="targetDoctype"');
    expect(emptyHtml).toContain('name="applicableDoctypes"');
    expect(emptyHtml).toContain("No grants configured.");

    const granted = await app.request("/desk/admin/user-permissions", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        targetDoctype: "Note",
        targetName: "Permission Target",
        applicableDoctypes: "Note",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(granted.status).toBe(303);
    expect(granted.headers.get("location")).toBe("/desk/admin/user-permissions?user=owner%40example.com");
    await expect(services.userPermissions.getUserPermissions(admin, owner.id)).resolves.toMatchObject({
      version: 1,
      grants: [{ targetDoctype: "Note", targetName: "Permission Target", applicableDoctypes: ["Note"] }]
    });

    const current = await app.request("/desk/admin/user-permissions?user=owner%40example.com");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("Note");
    expect(currentHtml).toContain("Permission Target");
    expect(currentHtml).toContain('name="expectedVersion" value="1"');
    expect(currentHtml).toContain('action="/desk/admin/user-permissions/revoke"');

    const revoked = await app.request("/desk/admin/user-permissions/revoke", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        targetDoctype: "Note",
        targetName: "Permission Target",
        applicableDoctypes: "Note",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(revoked.status).toBe(303);
    await expect(services.userPermissions.getUserPermissions(admin, owner.id)).resolves.toMatchObject({
      version: 2,
      grants: []
    });
  });

  it("renders and mutates roles from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const { app, services } = makeRoleDesk(admin);

    const empty = await app.request("/desk/admin/roles");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Roles");
    expect(emptyHtml).toContain("Create Role");
    expect(emptyHtml).toContain("No roles configured.");
    expect(emptyHtml).toContain('name="expectedVersion" value="0"');

    const created = await app.request("/desk/admin/roles", {
      method: "POST",
      body: new URLSearchParams({
        role: "Support Lead",
        description: "Escalation owner",
        enabled: "true",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/roles");
    await expect(services.roles.list(admin)).resolves.toMatchObject({
      version: 1,
      roles: [{ name: "Support Lead", description: "Escalation owner", enabled: true, version: 1 }]
    });

    const current = await app.request("/desk/admin/roles");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("Support Lead");
    expect(currentHtml).toContain("Escalation owner");
    expect(currentHtml).toContain('action="/desk/admin/roles/Support%20Lead/description"');
    expect(currentHtml).toContain('action="/desk/admin/roles/Support%20Lead/disable"');
    expect(currentHtml).toContain('name="expectedVersion" value="1"');

    const stale = await app.request("/desk/admin/roles/Support%20Lead/description", {
      method: "POST",
      body: new URLSearchParams({
        description: "Stale",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected role catalog at version 0, found 1");
    expect(staleHtml).toContain("Escalation owner");

    const described = await app.request("/desk/admin/roles/Support%20Lead/description", {
      method: "POST",
      body: new URLSearchParams({
        description: "Owns escalations",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(described.status).toBe(303);
    await expect(services.roles.list(admin)).resolves.toMatchObject({
      version: 2,
      roles: [{ name: "Support Lead", description: "Owns escalations" }]
    });

    const disabled = await app.request("/desk/admin/roles/Support%20Lead/disable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(disabled.status).toBe(303);
    await expect(services.roles.list(admin)).resolves.toMatchObject({
      version: 3,
      roles: [{ name: "Support Lead", enabled: false }]
    });

    const disabledPage = await app.request("/desk/admin/roles");
    expect(disabledPage.status).toBe(200);
    await expect(disabledPage.text()).resolves.toContain('action="/desk/admin/roles/Support%20Lead/enable"');

    const enabled = await app.request("/desk/admin/roles/Support%20Lead/enable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "3" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(enabled.status).toBe(303);
    await expect(services.roles.list(admin)).resolves.toMatchObject({
      version: 4,
      roles: [{ name: "Support Lead", enabled: true }]
    });
  });

  it("requires role administrators before parsing malformed Desk role forms", async () => {
    const { app } = makeRoleDesk(owner);

    const response = await app.request("/desk/admin/roles", {
      method: "POST",
      body: new URLSearchParams({
        role: "Support",
        enabled: "maybe"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("cannot manage roles");
    expect(html).not.toContain("Create Role");
  });

  it("renders and mutates custom fields from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const { app, services } = makeCustomFieldDesk(admin);

    const empty = await app.request("/desk/admin/custom-fields?doctype=Note");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Custom Fields");
    expect(emptyHtml).toContain('name="doctype"');
    expect(emptyHtml).toContain('name="defaultValue"');
    expect(emptyHtml).toContain("No custom fields configured.");

    const created = await app.request("/desk/admin/custom-fields", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "reviewed",
        label: "Reviewed",
        type: "boolean",
        inListView: "1",
        defaultValue: "false",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/custom-fields?doctype=Note");
    await expect(services.customFields.list(admin, "Note")).resolves.toMatchObject({
      version: 1,
      fields: [{ field: { name: "reviewed", label: "Reviewed", type: "boolean", defaultValue: false }, enabled: true }]
    });

    const current = await app.request("/desk/admin/custom-fields?doctype=Note");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("reviewed");
    expect(currentHtml).toContain("Reviewed");
    expect(currentHtml).toContain("default: false");
    expect(currentHtml).toContain('action="/desk/admin/custom-fields/Note/reviewed/disable"');
    expect(currentHtml).toContain('name="expectedVersion" value="1"');

    const stale = await app.request("/desk/admin/custom-fields", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "reviewed_by",
        type: "text",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected custom fields for &#39;Note&#39; at version 0, found 1");
    expect(staleHtml).toContain("reviewed");

    const disabled = await app.request("/desk/admin/custom-fields/Note/reviewed/disable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(disabled.status).toBe(303);
    await expect(services.customFields.list(admin, "Note")).resolves.toMatchObject({
      version: 2,
      fields: [{ field: { name: "reviewed" }, enabled: false }]
    });
  });

  it("applies custom fields to generated Desk forms and lists", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"] };
    const { app, services } = makeCustomFieldDesk(admin);
    await services.customFields.saveField({
      actor: admin,
      doctype: "Note",
      field: {
        name: "reviewed",
        label: "Reviewed",
        type: "boolean",
        inFormView: true,
        inListView: true,
        inListFilter: true,
        defaultValue: false
      }
    });

    const form = await app.request("/desk/Note/new");
    expect(form.status).toBe(200);
    const formHtml = await form.text();
    expect(formHtml).toContain("Reviewed");
    expect(formHtml).toContain('name="reviewed"');

    const created = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({
        title: "Runtime Desk",
        body: "Body",
        reviewed: "on"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/Note/Runtime%20Desk");
    await expect(services.queries.getDocument(admin, "Note", "Runtime Desk")).resolves.toMatchObject({
      data: { reviewed: true }
    });

    const list = await app.request("/desk/Note?filter_reviewed=true");
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain("Reviewed");
    expect(listHtml).toContain("Runtime Desk");
    expect(listHtml).toContain("filter_reviewed");

    const saved = await app.request("/desk/Note/saved-filters", {
      method: "POST",
      body: new URLSearchParams({
        saved_filter_label: "Reviewed notes",
        filter_reviewed: "true"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(saved.status).toBe(303);
    const savedLocation = saved.headers.get("location") ?? "";
    expect(savedLocation).toContain("/desk/Note?saved_filter=");
    await expect(services.savedFilters.list(admin, "Note")).resolves.toMatchObject([
      { label: "Reviewed notes", filters: [{ field: "reviewed", value: true }] }
    ]);

    const savedList = await app.request(savedLocation);
    expect(savedList.status).toBe(200);
    const savedListHtml = await savedList.text();
    expect(savedListHtml).toContain("Reviewed notes");
    expect(savedListHtml).toContain("Runtime Desk");
  });

  it("applies table custom fields to generated Desk child-table forms", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"] };
    const { app, services } = makeChildTableCustomFieldDesk(admin);
    await services.customFields.saveField({
      actor: admin,
      doctype: "Sales Invoice",
      field: {
        name: "bonus_items",
        label: "Bonus Items",
        type: "table",
        tableOf: "Sales Invoice Item",
        inFormView: true
      }
    });
    await services.documents.create({ actor: admin, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });

    const form = await app.request("/desk/Sales%20Invoice/new");
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("<legend>Bonus Items</legend>");
    expect(html).toContain('name="bonus_items[0].product"');
    expect(html).toContain('<option value="SKU-1">Widget</option>');

    const created = await app.request("/desk/Sales%20Invoice", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-CUSTOM-DESK",
        "items[0].product": "SKU-1",
        "items[0].quantity": "1",
        "bonus_items[0].product": "SKU-1",
        "bonus_items[0].quantity": "2",
        "bonus_items[0].rate": "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/Sales%20Invoice/INV-CUSTOM-DESK");
    await expect(services.queries.getDocument(admin, "Sales Invoice", "INV-CUSTOM-DESK")).resolves.toMatchObject({
      data: {
        bonus_items: [{ product: "SKU-1", quantity: 2, rate: 0 }]
      }
    });
  });

  it("applies child table DocType custom fields to generated Desk child-table forms", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"] };
    const { app, services } = makeChildTableCustomFieldDesk(admin);
    await services.customFields.saveField({
      actor: admin,
      doctype: "Sales Invoice Item",
      field: {
        name: "bonus_product",
        label: "Bonus Product",
        type: "link",
        linkTo: "Product"
      }
    });
    await services.documents.create({ actor: admin, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });
    await services.documents.create({ actor: admin, doctype: "Product", data: { sku: "SKU-2", title: "Cable" } });

    const form = await app.request("/desk/Sales%20Invoice/new");
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("<th>Bonus Product</th>");
    expect(html).toContain('name="items[0].bonus_product"');
    expect(html).toContain('<option value="SKU-2">Cable</option>');

    const created = await app.request("/desk/Sales%20Invoice", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-CHILD-CUSTOM-DESK",
        "items[0].product": "SKU-1",
        "items[0].quantity": "1",
        "items[0].bonus_product": "SKU-2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/Sales%20Invoice/INV-CHILD-CUSTOM-DESK");
    await expect(services.queries.getDocument(admin, "Sales Invoice", "INV-CHILD-CUSTOM-DESK")).resolves.toMatchObject({
      data: {
        items: [{ product: "SKU-1", quantity: 1, bonus_product: "SKU-2" }]
      }
    });
  });

  it("requires custom-field administrators before rendering an empty Desk admin surface", async () => {
    const { app } = makeCustomFieldDesk({ id: "reader@example.com", roles: ["Reader"], tenantId: "acme" });

    const response = await app.request("/desk/admin/custom-fields");

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("cannot manage custom fields");
    expect(html).not.toContain('name="defaultValue"');
  });

  it("renders and mutates user accounts from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const { app, services } = makeAccountDesk(admin);

    const empty = await app.request("/desk/admin/users");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Users");
    expect(emptyHtml).toContain("Create User");
    expect(emptyHtml).toContain('name="roles"');
    expect(emptyHtml).toContain("No account loaded.");

    const created = await app.request("/desk/admin/users", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        email: "OWNER@EXAMPLE.COM",
        password: "secret-123",
        roles: "User, Task Manager",
        enabled: "true",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/users?user=owner%40example.com");
    await expect(services.userAccounts.get(admin, owner.id)).resolves.toMatchObject({
      version: 1,
      email: "owner@example.com",
      roles: ["Task Manager", "User"],
      enabled: true
    });

    const current = await app.request("/desk/admin/users?user=owner%40example.com");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("owner@example.com");
    expect(currentHtml).toContain("Task Manager, User");
    expect(currentHtml).toContain('name="expectedVersion" value="1"');
    expect(currentHtml).toContain('action="/desk/admin/users/profile"');
    expect(currentHtml).toContain('action="/desk/admin/users/password"');
    expect(currentHtml).toContain('action="/desk/admin/users/roles"');
    expect(currentHtml).toContain('action="/desk/admin/users/disable"');
    expect(currentHtml).not.toContain("hash:secret-123");

    const profile = await app.request("/desk/admin/users/profile", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        expectedVersion: "0",
        fullName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada",
        language: "en",
        timeZone: "Europe/London",
        deskTheme: "dark",
        dateFormat: "yyyy-MM-dd",
        timeFormat: "HH:mm",
        numberFormat: "1,234.56",
        weekStart: "Monday",
        defaultWorkspace: "Support",
        userImage: "",
        phone: "+44 20 1234",
        mobileNo: "+44 7000",
        location: "London",
        bio: "Analytical engine notes"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(profile.status).toBe(303);
    await expect(services.userProfiles.get(admin, owner.id)).resolves.toMatchObject({
      version: 1,
      profile: {
        fullName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada",
        language: "en",
        timeZone: "Europe/London",
        deskTheme: "dark",
        dateFormat: "yyyy-MM-dd",
        timeFormat: "HH:mm",
        numberFormat: "1,234.56",
        weekStart: "Monday",
        defaultWorkspace: "Support",
        phone: "+44 20 1234",
        mobileNo: "+44 7000",
        location: "London",
        bio: "Analytical engine notes"
      }
    });

    const profiled = await app.request("/desk/admin/users?user=owner%40example.com");
    expect(profiled.status).toBe(200);
    const profiledHtml = await profiled.text();
    expect(profiledHtml).toContain("Ada Lovelace");
    expect(profiledHtml).toContain("Desk Theme");
    expect(profiledHtml).toContain('name="defaultWorkspace" value="Support"');
    expect(profiledHtml).toContain('action="/desk/admin/users/profile"');

    const staleProfile = await app.request("/desk/admin/users/profile", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        expectedVersion: "0",
        fullName: "Grace Hopper"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(staleProfile.status).toBe(409);
    const staleProfileHtml = await staleProfile.text();
    expect(staleProfileHtml).toContain("Expected user profile &#39;owner@example.com&#39; at version 0, found 1");
    expect(staleProfileHtml).toContain('name="expectedVersion" value="1"');
    expect(staleProfileHtml).toContain("Ada Lovelace");

    const roles = await app.request("/desk/admin/users/roles", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        roles: "Support, User",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(roles.status).toBe(303);
    await expect(services.userAccounts.get(admin, owner.id)).resolves.toMatchObject({
      version: 2,
      roles: ["Support", "User"]
    });

    const stale = await app.request("/desk/admin/users/roles", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        roles: "User",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected user account &#39;owner@example.com&#39; at version 1, found 2");
    expect(staleHtml).toContain('name="expectedVersion" value="2"');

    const password = await app.request("/desk/admin/users/password", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        password: "secret-456",
        expectedVersion: "2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(password.status).toBe(303);
    await expect(services.userAccounts.authenticate({
      tenantId: "acme",
      userId: owner.id,
      password: "secret-456"
    })).resolves.toMatchObject({ id: owner.id, roles: ["Support", "User"] });
    await expect(services.userAccounts.get(admin, owner.id)).resolves.toMatchObject({ version: 3 });

    const disabled = await app.request("/desk/admin/users/disable", {
      method: "POST",
      body: new URLSearchParams({ user: owner.id, expectedVersion: "3" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(disabled.status).toBe(303);
    await expect(services.userAccounts.get(admin, owner.id)).resolves.toMatchObject({
      version: 4,
      enabled: false
    });

    const disabledPage = await app.request("/desk/admin/users?user=owner%40example.com");
    expect(disabledPage.status).toBe(200);
    await expect(disabledPage.text()).resolves.toContain('action="/desk/admin/users/enable"');

    const enabled = await app.request("/desk/admin/users/enable", {
      method: "POST",
      body: new URLSearchParams({ user: owner.id, expectedVersion: "4" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(enabled.status).toBe(303);
    await expect(services.userAccounts.get(admin, owner.id)).resolves.toMatchObject({
      version: 5,
      enabled: true
    });
  });

  it("requires user-account administrators for the Desk account surface", async () => {
    const { app } = makeAccountDesk(owner);

    const response = await app.request("/desk/admin/users");

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("cannot manage user accounts");
    expect(html).toContain("cf-frappe Desk");
  });

  it("authorizes Desk account posts before parsing malformed forms", async () => {
    const { app } = makeAccountDesk(owner);

    const response = await app.request("/desk/admin/users", {
      method: "POST",
      body: new URLSearchParams({
        user: "owner@example.com",
        password: "secret-123",
        roles: "User",
        enabled: "maybe"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("cannot manage user accounts");
    expect(html).not.toContain("Create User");

    const profile = await app.request("/desk/admin/users/profile", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(profile.status).toBe(403);
    const profileHtml = await profile.text();
    expect(profileHtml).toContain("cannot manage user accounts");
    expect(profileHtml).not.toContain("Save Profile");
  });

  it("renders job definitions and execution history from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const executionLog = new InMemoryJobExecutionLog();
    const queue = new InMemoryJobQueue();
    const jobs = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobs: new JobHistoryService({ registry: jobs, executionLog }),
      jobRetry: new JobRetryService({
        executionLog,
        dispatcher: new JobDispatcher({
          registry: jobs,
          queue,
          clock: fixedClock(now),
          ids: deterministicIds(["retry-001"])
        }),
        clock: fixedClock(now)
      }),
      actor: () => admin
    });
    const message = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload: {},
      runId: "job_001",
      idempotencyKey: "reports.daily:job_001",
      enqueuedAt: now,
      metadata: {}
    };
    await executionLog.begin(message, now);
    await executionLog.complete(message, "2026-01-01T00:01:00.000Z", { rows: 3 });
    const failedMessage = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload: { stale: true },
      runId: "job_002",
      idempotencyKey: "reports.daily:job_002",
      enqueuedAt: now,
      metadata: {}
    };
    await executionLog.begin(failedMessage, "2026-01-01T00:02:00.000Z");
    await executionLog.fail(failedMessage, "2026-01-01T00:03:00.000Z", "down");

    const response = await app.request("/desk/admin/jobs?status=failed");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Jobs");
    expect(html).toContain("reports.daily");
    expect(html).toContain("Build reports");
    expect(html).toContain("reports.daily:job_002");
    expect(html).toContain("failed");
    expect(html).toContain('formaction="/desk/admin/jobs/reports.daily%3Ajob_002/retry"');

    const retried = await app.request("/desk/admin/jobs/reports.daily%3Ajob_002/retry", {
      method: "POST"
    });
    expect(retried.status).toBe(303);
    expect(retried.headers.get("location")).toBe("/desk/admin/jobs?status=failed");
    expect(queue.queued()[0]?.message).toMatchObject({
      tenantId: "acme",
      runId: "job_retry-001",
      idempotencyKey: "reports.daily:job_002"
    });
  });

  it("renders and applies data patches from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const resources = { touched: [] as string[] };
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources,
        patches: [
          defineDataPatch<typeof resources>({
            id: "core.first",
            checksum: "v1",
            run: ({ resources }) => {
              resources.touched.push("first");
              return { touched: resources.touched.length };
            }
          }),
          defineDataPatch<typeof resources>({
            id: "crm.second",
            checksum: "v1",
            run: ({ resources }) => {
              resources.touched.push("second");
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-first", "claim-second"])
      }),
      actor: () => admin
    });

    const empty = await app.request("/desk/admin/data-patches");

    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Data Patches");
    expect(emptyHtml).toContain("core.first");
    expect(emptyHtml).toContain("crm.second");
    expect(emptyHtml).toContain('action="/desk/admin/data-patches/apply"');
    expect(emptyHtml).toContain('formaction="/desk/admin/data-patches/core.first/apply"');

    const blocked = await app.request("/desk/admin/data-patches/crm.second/apply", { method: "POST" });
    expect(blocked.status).toBe(409);
    await expect(blocked.text()).resolves.toContain("cannot run before earlier patch");

    const first = await app.request("/desk/admin/data-patches/apply", {
      method: "POST",
      body: new URLSearchParams({ limit: "1" })
    });
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.touched).toEqual(["first"]);

    const second = await app.request("/desk/admin/data-patches/crm.second/apply", { method: "POST" });
    expect(second.status).toBe(303);
    expect(second.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.touched).toEqual(["first", "second"]);

    const applied = await app.request("/desk/admin/data-patches");
    const appliedHtml = await applied.text();
    expect(appliedHtml).toContain("applied");
    expect(appliedHtml).toContain("{&quot;touched&quot;:1}");
  });

  it("renders failed data patch retry actions in the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const resources = { attempts: 0 };
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources,
        patches: [
          defineDataPatch<typeof resources>({
            id: "core.retry",
            checksum: "v1",
            run: ({ resources }) => {
              resources.attempts += 1;
              if (resources.attempts === 1) {
                throw new Error("boom");
              }
              return { attempts: resources.attempts };
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-failed", "claim-retry"])
      }),
      actor: () => admin
    });

    const failed = await app.request("/desk/admin/data-patches/apply", { method: "POST" });
    expect(failed.status).toBe(500);
    const failedHtml = await failed.text();
    expect(failedHtml).toContain("boom");
    expect(failedHtml).toContain('formaction="/desk/admin/data-patches/core.retry/retry"');

    const retried = await app.request("/desk/admin/data-patches/core.retry/retry", { method: "POST" });
    expect(retried.status).toBe(303);
    expect(retried.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.attempts).toBe(2);

    const applied = await app.request("/desk/admin/data-patches");
    const appliedHtml = await applied.text();
    expect(appliedHtml).toContain("applied");
    expect(appliedHtml).not.toContain('formaction="/desk/admin/data-patches/core.retry/retry"');
  });

  it("renders enabled admin surfaces in the Desk navigation", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [defineDataPatch({ id: "core.seed", checksum: "v1", run: () => undefined })]
    });
    const customFields = new CustomFieldService({ registry: services.registry, events: services.store });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      userPermissions: services.userPermissions,
      roles: new RoleService({ events: services.store }),
      customFields,
      dataPatches,
      jobSchedules: new JobScheduleService({
        registry: createJobRegistry({
          jobs: [{ name: "reports.daily", handler: () => undefined }]
        }),
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }]
      }),
      actor: () => admin
    });

    const home = await app.request("/desk");
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain('<p class="nav-heading">Admin</p>');
    expect(homeHtml).toContain('href="/desk/admin/user-permissions"');
    expect(homeHtml).toContain('href="/desk/admin/roles"');
    expect(homeHtml).toContain('href="/desk/admin/custom-fields"');
    expect(homeHtml).toContain('href="/desk/admin/data-patches"');
    expect(homeHtml).toContain('href="/desk/admin/jobs/schedules"');
    expect(homeHtml).not.toContain('href="/desk/admin/users"');

    const dataPatchPage = await app.request("/desk/admin/data-patches");
    expect(dataPatchPage.status).toBe(200);
    await expect(dataPatchPage.text()).resolves.toContain(
      '<a class="nav-link is-active" href="/desk/admin/data-patches">Data Patches</a>'
    );

    const userApp = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches,
      actor: () => guest
    });
    const userHome = await userApp.request("/desk");
    expect(userHome.status).toBe(200);
    await expect(userHome.text()).resolves.not.toContain('<p class="nav-heading">Admin</p>');

    const failingActorApp = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches,
      actor: () => {
        throw new Error("missing actor");
      }
    });
    const failed = await failingActorApp.request("/desk/admin/data-patches");
    expect(failed.status).toBe(500);
    await expect(failed.text()).resolves.not.toContain('<p class="nav-heading">Admin</p>');
  });

  it("renders Desk data patch admin route errors", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [defineDataPatch({ id: "core.seed", checksum: "v1", run: () => undefined })]
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches,
      actor: () => admin
    });

    const invalidLimit = await app.request("/desk/admin/data-patches/apply", {
      method: "POST",
      body: new URLSearchParams({ limit: "0" })
    });
    expect(invalidLimit.status).toBe(400);
    await expect(invalidLimit.text()).resolves.toContain("Data patch apply limit must be a positive integer");

    const disabled = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => admin
    });
    const missing = await disabled.request("/desk/admin/data-patches");
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain("Data patches are not enabled");
  });

  it("renders and dispatches job schedules from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const jobs = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const runner = vi.fn(async () => ({
      tenantId: "acme",
      jobName: "reports.daily",
      payload: {},
      runId: "job_manual-001",
      idempotencyKey: "manual:0 2 * * *:1767225600000:reports.daily",
      enqueuedAt: now,
      metadata: { dispatchSource: "manual" }
    }));
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules: new JobScheduleService({
        registry: jobs,
        schedules: [
          {
            cron: "0 2 * * *",
            jobName: "reports.daily",
            tenantId: "acme",
            payload: () => ({ scope: "daily" })
          },
          {
            cron: "0 3 * * *",
            jobName: "reports.daily",
            tenantId: "acme",
            enabled: false
          }
        ],
        runner: { run: runner }
      }),
      actor: () => admin
    });

    const response = await app.request("/desk/admin/jobs/schedules?job=reports.daily");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Job Schedules");
    expect(html).toContain("0 2 * * *");
    expect(html).toContain("reports.daily");
    expect(html).toContain("acme");
    expect(html).toContain("<th>Enabled</th>");
    expect(html).toContain("payload");
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/1/run"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/2/run"');
    expect(html).not.toContain('href="/desk/admin/jobs"');

    const dispatched = await app.request("/desk/admin/jobs/schedules/1/run", { method: "POST" });
    expect(dispatched.status).toBe(303);
    expect(dispatched.headers.get("location")).toBe("/desk/admin/jobs/schedules");
    expect(runner).toHaveBeenCalledOnce();
  });

  it("renders and updates job schedule overrides from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const jobs = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules: new JobScheduleService({
        registry: jobs,
        schedules: [
          { id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" },
          { id: "digest", cron: "0 3 * * *", jobName: "reports.daily", tenantId: "acme", enabled: false },
          { id: "dynamic", cron: "0 4 * * *", jobName: "reports.daily", tenantId: "acme", enabled: () => true }
        ],
        events: new InMemoryEventStore(),
        clock: fixedClock(now),
        ids: deterministicIds(["disable-1", "reset-2", "enable-3", "reset-4"])
      }),
      actor: () => admin
    });

    const response = await app.request("/desk/admin/jobs/schedules");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<th>Override</th>");
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/daily/disable"');
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/digest/enable"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/dynamic/disable"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/dynamic/enable"');

    const disabled = await app.request("/desk/admin/jobs/schedules/daily/disable", { method: "POST" });
    expect(disabled.status).toBe(303);
    expect(disabled.headers.get("location")).toBe("/desk/admin/jobs/schedules");

    const afterDisable = await app.request("/desk/admin/jobs/schedules");
    const disabledHtml = await afterDisable.text();
    expect(disabledHtml).toContain("disabled");
    expect(disabledHtml).toContain('formaction="/desk/admin/jobs/schedules/daily/enable"');
    expect(disabledHtml).toContain('formaction="/desk/admin/jobs/schedules/daily/reset"');

    const resetDaily = await app.request("/desk/admin/jobs/schedules/daily/reset", { method: "POST" });
    expect(resetDaily.status).toBe(303);
    expect(resetDaily.headers.get("location")).toBe("/desk/admin/jobs/schedules");

    const afterResetDaily = await app.request("/desk/admin/jobs/schedules");
    const resetDailyHtml = await afterResetDaily.text();
    expect(resetDailyHtml).not.toContain('formaction="/desk/admin/jobs/schedules/daily/reset"');

    const enabled = await app.request("/desk/admin/jobs/schedules/digest/enable", { method: "POST" });
    expect(enabled.status).toBe(303);
    expect(enabled.headers.get("location")).toBe("/desk/admin/jobs/schedules");

    const afterEnable = await app.request("/desk/admin/jobs/schedules");
    const enabledHtml = await afterEnable.text();
    expect(enabledHtml).toContain("enabled");
    expect(enabledHtml).toContain('formaction="/desk/admin/jobs/schedules/digest/disable"');
    expect(enabledHtml).toContain('formaction="/desk/admin/jobs/schedules/digest/reset"');

    const resetDigest = await app.request("/desk/admin/jobs/schedules/digest/reset", { method: "POST" });
    expect(resetDigest.status).toBe(303);
    expect(resetDigest.headers.get("location")).toBe("/desk/admin/jobs/schedules");

    const afterResetDigest = await app.request("/desk/admin/jobs/schedules");
    const resetDigestHtml = await afterResetDigest.text();
    expect(resetDigestHtml).not.toContain('formaction="/desk/admin/jobs/schedules/digest/reset"');
  });

  it("creates, updates, and deletes runtime job schedules from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const jobs = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules: new JobScheduleService({
        registry: jobs,
        schedules: [],
        events: new InMemoryEventStore(),
        clock: fixedClock(now),
        ids: deterministicIds(["save-runtime", "update-runtime", "delete-runtime"])
      }),
      actor: () => admin
    });

    const empty = await app.request("/desk/admin/jobs/schedules");
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain('action="/desk/admin/jobs/schedules"');
    expect(emptyHtml).toContain("Save runtime schedule");

    const created = await app.request("/desk/admin/jobs/schedules", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        delaySeconds: "30",
        enabled: "true"
      }).toString()
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/jobs/schedules");

    const afterCreate = await app.request("/desk/admin/jobs/schedules");
    const createdHtml = await afterCreate.text();
    expect(createdHtml).toContain("runtime-daily");
    expect(createdHtml).toContain("15 4 * * *");
    expect(createdHtml).toContain("<td>runtime</td>");
    expect(createdHtml).toContain('formaction="/desk/admin/jobs/schedules/runtime-daily/delete"');

    const updated = await app.request("/desk/admin/jobs/schedules", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: "runtime-daily",
        cron: "30 5 * * *",
        jobName: "reports.daily"
      }).toString()
    });
    expect(updated.status).toBe(303);

    const afterUpdate = await app.request("/desk/admin/jobs/schedules");
    const updatedHtml = await afterUpdate.text();
    expect(updatedHtml).toContain("30 5 * * *");
    expect(updatedHtml).toContain("<td>no</td>");

    const deleted = await app.request("/desk/admin/jobs/schedules/runtime-daily/delete", { method: "POST" });
    expect(deleted.status).toBe(303);
    const afterDelete = await app.request("/desk/admin/jobs/schedules");
    await expect(afterDelete.text()).resolves.not.toContain("runtime-daily");
  });

  it("preserves API-only runtime schedule fields when updating from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const jobs = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const jobSchedules = new JobScheduleService({
      registry: jobs,
      schedules: [],
      events: new InMemoryEventStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime", "update-runtime"])
    });
    await jobSchedules.save(admin, {
      id: "runtime-daily",
      cron: "15 4 * * *",
      jobName: "reports.daily",
      payload: { scope: "api" },
      metadata: { source: "api" },
      idempotencyKey: "runtime-key",
      delaySeconds: 30
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules,
      actor: () => admin
    });

    const updated = await app.request("/desk/admin/jobs/schedules", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: "runtime-daily",
        cron: "30 5 * * *",
        jobName: "reports.daily"
      }).toString()
    });

    expect(updated.status).toBe(303);
    await expect(jobSchedules.schedulesForCron("30 5 * * *")).resolves.toMatchObject([
      {
        id: "runtime-daily",
        payload: { scope: "api" },
        metadata: { source: "api" },
        idempotencyKey: "runtime-key"
      }
    ]);
  });

  it("hides schedule run actions when dispatch is not configured", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules: new JobScheduleService({
        registry: createJobRegistry({
          jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
        }),
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }]
      }),
      actor: () => admin
    });

    const response = await app.request("/desk/admin/jobs/schedules");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("reports.daily");
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/1/run"');
  });

  it("uses the Desk error boundary for non-admin user-permission access", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/admin/user-permissions?user=owner%40example.com");

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("cannot manage user permissions");
  });

  it("renders expectedVersion in edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('name="expectedVersion" value="1"');
    expect(html).toContain("/desk/print/Note%20Standard/My%20Note");
  });

  it("renders document timeline entries on edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.update({ actor: owner, doctype: "Note", name: "My Note", patch: { body: "Edited" } });
    await services.documents.recordActivity({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      activityType: "email",
      subject: "Follow-up sent",
      expectedVersion: 2
    });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h2 id="document-timeline">Timeline</h2>');
    expect(html).toContain("Created document");
    expect(html).toContain("Updated body");
    expect(html).toContain("Email: Follow-up sent");
    expect(html).toContain("NoteUpdated");
    expect(html).toContain("NoteActivityRecorded");
    expect(html).toContain("timeline-changes");
    expect(html).toContain("<span>body</span>");
    expect(html).toContain("<span>Body</span>");
    expect(html).toContain("<span>Edited</span>");
    expect(html).toContain('formaction="/desk/Note/My%20Note/comments"');
    expect(html).toContain('name="comment_text"');
  });

  it("adds comments from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note/comments", {
      method: "POST",
      body: new URLSearchParams({ comment_text: "Desk note", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/desk/Note/My%20Note");
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const edit = await app.request("/desk/Note/My%20Note");
    expect(edit.status).toBe(200);
    await expect(edit.text()).resolves.toContain("Commented: Desk note");
  });

  it("renders and submits assignment controls from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const initial = await app.request("/desk/Note/My%20Note");
    expect(initial.status).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain('<h3 id="document-assignments">Assignments</h3>');
    expect(initialHtml).toContain('formaction="/desk/Note/My%20Note/assignments"');
    expect(initialHtml).toContain('name="assignee"');

    const assigned = await app.request("/desk/Note/My%20Note/assignments", {
      method: "POST",
      body: new URLSearchParams({ assignee: "support@example.com", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(assigned.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const withAssignee = await app.request("/desk/Note/My%20Note");
    expect(withAssignee.status).toBe(200);
    const assignedHtml = await withAssignee.text();
    expect(assignedHtml).toContain("support@example.com");
    expect(assignedHtml).toContain('formaction="/desk/Note/My%20Note/assignments/support%40example.com/remove"');

    const unassigned = await app.request("/desk/Note/My%20Note/assignments/support%40example.com/remove", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(unassigned.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 3 });
  });

  it("renders and submits tag controls from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const initial = await app.request("/desk/Note/My%20Note");
    expect(initial.status).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain('<h3 id="document-tags">Tags</h3>');
    expect(initialHtml).toContain('formaction="/desk/Note/My%20Note/tags"');
    expect(initialHtml).toContain('name="tag"');

    const tagged = await app.request("/desk/Note/My%20Note/tags", {
      method: "POST",
      body: new URLSearchParams({ tag: "Urgent", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(tagged.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const withTag = await app.request("/desk/Note/My%20Note");
    expect(withTag.status).toBe(200);
    const taggedHtml = await withTag.text();
    expect(taggedHtml).toContain("Urgent");
    expect(taggedHtml).toContain('formaction="/desk/Note/My%20Note/tags/Urgent/remove"');

    const untagged = await app.request("/desk/Note/My%20Note/tags/Urgent/remove", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(untagged.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 3 });
  });

  it("hides tag mutation controls from read-only generated edit forms", async () => {
    const { app, services } = makeDesk(guest);
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.tag({ actor: owner, doctype: "Note", name: "My Note", tag: "Urgent", expectedVersion: 1 });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h3 id="document-tags">Tags</h3>');
    expect(html).toContain("Urgent");
    expect(html).not.toContain('name="tag"');
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/tags"');
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/tags/Urgent/remove"');
  });

  it("renders and submits follower controls from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const initial = await app.request("/desk/Note/My%20Note");
    expect(initial.status).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain('<h3 id="document-followers">Followers</h3>');
    expect(initialHtml).toContain('formaction="/desk/Note/My%20Note/followers"');

    const followed = await app.request("/desk/Note/My%20Note/followers", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(followed.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const withFollower = await app.request("/desk/Note/My%20Note");
    expect(withFollower.status).toBe(200);
    const followedHtml = await withFollower.text();
    expect(followedHtml).toContain(owner.id);
    expect(followedHtml).toContain('formaction="/desk/Note/My%20Note/followers/owner%40example.com/remove"');

    const unfollowed = await app.request("/desk/Note/My%20Note/followers/owner%40example.com/remove", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(unfollowed.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 3 });
  });

  it("hides follower mutation controls from read-only generated edit forms", async () => {
    const { app, services } = makeDesk(guest);
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.follow({ actor: owner, doctype: "Note", name: "My Note", expectedVersion: 1 });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h3 id="document-followers">Followers</h3>');
    expect(html).toContain(owner.id);
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/followers"');
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/followers/owner%40example.com/remove"');
  });

  it("renders and submits document share controls from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const initial = await app.request("/desk/Note/My%20Note");
    expect(initial.status).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain('<h3 id="document-shares">Shares</h3>');
    expect(initialHtml).toContain('formaction="/desk/Note/My%20Note/shares"');
    expect(initialHtml).toContain('name="user"');
    expect(initialHtml).toContain('name="permission" value="read" checked');

    const permissions = new URLSearchParams({ user: "collab@example.com", expectedVersion: "1" });
    permissions.append("permission", "read");
    permissions.append("permission", "update");
    const shared = await app.request("/desk/Note/My%20Note/shares", {
      method: "POST",
      body: permissions,
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(shared.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const withShare = await app.request("/desk/Note/My%20Note");
    expect(withShare.status).toBe(200);
    const sharedHtml = await withShare.text();
    expect(sharedHtml).toContain("collab@example.com");
    expect(sharedHtml).toContain("read, update");
    expect(sharedHtml).toContain('formaction="/desk/Note/My%20Note/shares/collab%40example.com/remove"');

    const revoked = await app.request("/desk/Note/My%20Note/shares/collab%40example.com/remove", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(revoked.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 3 });
  });

  it("hides document share controls from read-only generated edit forms", async () => {
    const { app, services } = makeDesk(guest);
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.share({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      userId: "collab@example.com",
      permissions: ["read"],
      expectedVersion: 1
    });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('<h3 id="document-shares">Shares</h3>');
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/shares"');
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/shares/collab%40example.com/remove"');
  });

  it("does not mount document share form routes when Desk sharing is disabled", async () => {
    const { app, services } = makeDesk(owner, { documentShares: false });
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const page = await app.request("/desk/Note/My%20Note");
    expect(page.status).toBe(200);
    await expect(page.text()).resolves.not.toContain('<h3 id="document-shares">Shares</h3>');

    const posted = await app.request("/desk/Note/My%20Note/shares", {
      method: "POST",
      body: new URLSearchParams({ user: "collab@example.com", permission: "read", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(posted.status).toBe(404);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 1 });
  });

  it("renders only delegable share permissions for share-derived managers", async () => {
    const collaborator = { id: "collab@example.com", roles: ["Guest"], tenantId: "acme" };
    const { app, services } = makeDesk(collaborator);
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.share({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      userId: collaborator.id,
      permissions: ["share"],
      expectedVersion: 1
    });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h3 id="document-shares">Shares</h3>');
    expect(html).toContain('name="permission" value="read" checked');
    expect(html).toContain('name="permission" value="share"');
    expect(html).not.toContain('name="permission" value="update"');
  });

  it("submits and cancels documents from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const draft = await app.request("/desk/Note/My%20Note");
    expect(draft.status).toBe(200);
    const draftHtml = await draft.text();
    expect(draftHtml).toContain('formaction="/desk/Note/My%20Note/submit"');
    expect(draftHtml).not.toContain('formaction="/desk/Note/My%20Note/cancel"');

    const submitted = await app.request("/desk/Note/My%20Note/submit", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(submitted.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      docstatus: "submitted",
      version: 2
    });

    const submittedForm = await app.request("/desk/Note/My%20Note");
    expect(submittedForm.status).toBe(200);
    const submittedHtml = await submittedForm.text();
    expect(submittedHtml).toContain("submitted");
    expect(submittedHtml).toContain('formaction="/desk/Note/My%20Note/cancel"');
    expect(submittedHtml).not.toContain(">Save</button>");
    expect(submittedHtml).not.toContain("/command/archive");

    const cancelled = await app.request("/desk/Note/My%20Note/cancel", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(cancelled.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      docstatus: "cancelled",
      version: 3
    });
  });

  it("duplicates documents from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ body: "Original" }) });

    const edit = await app.request("/desk/Note/My%20Note");
    expect(edit.status).toBe(200);
    await expect(edit.text()).resolves.toContain('formaction="/desk/Note/My%20Note/duplicate"');

    const duplicated = await app.request("/desk/Note/My%20Note/duplicate", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note Copy", body: "Copied", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(duplicated.status).toBe(303);
    expect(duplicated.headers.get("location")).toBe("/desk/Note/My%20Note%20Copy");
    await expect(services.queries.getDocument(owner, "Note", "My Note Copy")).resolves.toMatchObject({
      docstatus: "draft",
      data: { title: "My Note Copy", body: "Copied", created_by: owner.id }
    });
  });

  it("amends cancelled documents from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ body: "Original" }) });
    await services.documents.submit({ actor: owner, doctype: "Note", name: "My Note", expectedVersion: 1 });
    await services.documents.cancel({ actor: owner, doctype: "Note", name: "My Note", expectedVersion: 2 });

    const edit = await app.request("/desk/Note/My%20Note");
    expect(edit.status).toBe(200);
    const html = await edit.text();
    expect(html).toContain("cancelled");
    expect(html).toContain('formaction="/desk/Note/My%20Note/amend"');
    expect(html).not.toContain(">Save</button>");

    const amended = await app.request("/desk/Note/My%20Note/amend", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note Rev 1", body: "Amended", expectedVersion: "3" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(amended.status).toBe(303);
    expect(amended.headers.get("location")).toBe("/desk/Note/My%20Note%20Rev%201");
    await expect(services.queries.getDocument(owner, "Note", "My Note Rev 1")).resolves.toMatchObject({
      docstatus: "draft",
      data: { title: "My Note Rev 1", body: "Amended", created_by: owner.id }
    });
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      docstatus: "cancelled"
    });
  });

  it("renders printable documents from Desk", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Print", priority: "High", body: "Print body" })
    });

    const response = await app.request("/desk/print/Note%20Standard/Desk%20Print");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Desk Print");
    expect(html).toContain("Print body");
  });

  it("creates documents from generated forms", async () => {
    const { app, services } = makeDesk();

    const response = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({ title: "Desk Note", body: "From form" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/desk/Note/Desk%20Note");
    await expect(services.queries.getDocument(owner, "Note", "Desk Note")).resolves.toMatchObject({
      data: { body: "From form", created_by: owner.id }
    });
    await expect(services.events.readStream("acme:Note:Desk%20Note")).resolves.toMatchObject([
      { metadata: { method: "POST", url: "http://localhost/desk/Note" } }
    ]);
  });

  it("renders link fields as target-backed select options", async () => {
    const { app, services } = makeLinkedDesk();
    await services.documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await services.documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });

    const form = await app.request("/desk/Task/new");

    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('name="project"');
    expect(html).toContain('<option value="Apollo">Apollo</option>');
    expect(html).toContain('<option value="Zeus">Zeus</option>');

    await services.documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Launch", project: "Apollo" }
    });

    const edit = await app.request("/desk/Task/Launch");
    expect(edit.status).toBe(200);
    await expect(edit.text()).resolves.toContain('<option value="Apollo" selected>Apollo</option>');
  });

  it("renders and parses child table fields from generated forms", async () => {
    const { app, services } = makeChildTableDesk();
    await services.documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });

    const form = await app.request("/desk/Sales%20Invoice/new");

    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("<legend>items *</legend>");
    expect(html).toContain('name="items[0].product"');
    expect(html).toContain('<option value="SKU-1">Widget</option>');
    expect(html).toContain('name="items[0].quantity"');
    expect(html).not.toContain("/desk/Sales%20Invoice%20Item");

    const created = await app.request("/desk/Sales%20Invoice", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-DESK",
        "items[0].product": "SKU-1",
        "items[0].quantity": "2",
        "items[0].rate": "10",
        "items[1].product": "",
        "items[1].quantity": ""
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/Sales%20Invoice/INV-DESK");
    await expect(services.queries.getDocument(owner, "Sales Invoice", "INV-DESK")).resolves.toMatchObject({
      data: {
        items: [{ product: "SKU-1", quantity: 2, rate: 10 }]
      }
    });

    const edit = await app.request("/desk/Sales%20Invoice/INV-DESK");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain('name="items[0].product"');
    expect(editHtml).toContain('<option value="SKU-1" selected>Widget</option>');
    expect(editHtml).toContain(`name="items[0].${CHILD_TABLE_ROW_INDEX_FIELD}" value="0"`);
    expect(editHtml).toContain('name="items[1].product"');
  });

  it("keeps read-only child values with the correct Desk row after deleting an earlier row", async () => {
    const { app, services } = makeChildTableDesk();
    await services.documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });
    await services.documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-2", title: "Gadget" } });
    await services.documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-DESK",
        items: [
          { product: "SKU-1", quantity: 1, line_id: "line-1" },
          { product: "SKU-2", quantity: 2, rate: 20, line_id: "line-2" }
        ]
      }
    });

    const edit = await app.request("/desk/Sales%20Invoice/INV-DESK");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain(`name="items[0].${CHILD_TABLE_ROW_INDEX_FIELD}" value="0"`);
    expect(editHtml).toContain(`name="items[1].${CHILD_TABLE_ROW_INDEX_FIELD}" value="1"`);

    const updated = await app.request("/desk/Sales%20Invoice/INV-DESK", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-DESK",
        expectedVersion: "1",
        [`items[0].${CHILD_TABLE_ROW_INDEX_FIELD}`]: "0",
        "items[0].product": "",
        "items[0].quantity": "",
        [`items[1].${CHILD_TABLE_ROW_INDEX_FIELD}`]: "1",
        "items[1].product": "SKU-2",
        "items[1].quantity": "3",
        "items[1].rate": "20"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(updated.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Sales Invoice", "INV-DESK")).resolves.toMatchObject({
      data: {
        items: [{ product: "SKU-2", quantity: 3, rate: 20, line_id: "line-2" }]
      },
      version: 2
    });
    const stream = await services.events.readStream("acme:Sales%20Invoice:INV-DESK");
    expect(JSON.stringify(stream)).not.toContain(CHILD_TABLE_ROW_INDEX_FIELD);
  });

  it("does not submit omitted form-view boolean fields as unchecked", async () => {
    const Flag = defineDocType({
      name: "Flag",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "enabled", type: "boolean", defaultValue: true }
      ],
      formView: {
        sections: [{ fields: ["title"] }]
      },
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });
    const registry = createRegistry({ doctypes: [Flag] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["flag-1", "flag-2"])
    });
    const queries = new QueryService({ registry, projections: store });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      actor: () => owner
    });

    const created = await app.request("/desk/Flag", {
      method: "POST",
      body: new URLSearchParams({ title: "Feature Flag" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    await expect(queries.getDocument(owner, "Flag", "Feature Flag")).resolves.toMatchObject({
      data: { enabled: true }
    });

    const updated = await app.request("/desk/Flag/Feature%20Flag", {
      method: "POST",
      body: new URLSearchParams({ title: "Feature Flag", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(updated.status).toBe(303);
    await expect(queries.getDocument(owner, "Flag", "Feature Flag")).resolves.toMatchObject({
      data: { enabled: true },
      version: 2
    });
  });

  it("ignores read-only fields submitted on create", async () => {
    const { app, services } = makeDesk();

    const response = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({ title: "Desk Note", body: "From form", created_by: "attacker" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "Desk Note")).resolves.toMatchObject({
      data: { created_by: owner.id }
    });
  });

  it("updates documents and executes model commands from generated forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const update = await app.request("/desk/Note/My%20Note", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Edited", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(update.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { body: "Edited" }
    });

    const command = await app.request("/desk/Note/My%20Note/command/archive", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Edited", expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(command.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { workflow_state: "Closed" }
    });
    await expect(services.events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      { metadata: { method: "POST", url: "http://localhost/desk/Note/My%20Note" } },
      { metadata: { method: "POST", url: "http://localhost/desk/Note/My%20Note/command/archive" } }
    ]);
  });

  it("renders and runs metadata-defined workflow transitions from generated forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const edit = await app.request("/desk/Note/My%20Note");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain('aria-label="Workflow actions"');
    expect(editHtml).toContain('formaction="/desk/Note/My%20Note/transition/close"');

    const transitioned = await app.request("/desk/Note/My%20Note/transition/close", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(transitioned.status).toBe(303);
    expect(transitioned.headers.get("location")).toBe("/desk/Note/My%20Note");
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      version: 2,
      data: { workflow_state: "Closed" }
    });
    await expect(services.events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      { metadata: { method: "POST", url: "http://localhost/desk/Note/My%20Note/transition/close" } }
    ]);

    const closed = await app.request("/desk/Note/My%20Note");
    expect(closed.status).toBe(200);
    await expect(closed.text()).resolves.not.toContain("/transition/close");
  });

  it("rejects stale generated form posts instead of appending over newer events", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.update({ actor: owner, doctype: "Note", name: "My Note", patch: { body: "Newer" } });

    const stale = await app.request("/desk/Note/My%20Note", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Stale", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(stale.status).toBe(409);
    const html = await stale.text();
    expect(html).toContain("Expected version 1, found 2");
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { body: "Newer" }
    });
  });

  it("renders validation errors next to the generated form", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({ title: "No" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain("Validation failed");
    expect(html).toContain('role="alert"');
  });

  it("uses the Desk error boundary for GET failures", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk/Missing");

    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("DocType &#39;Missing&#39; is not registered");
    expect(html).toContain("cf-frappe Desk");
  });
});

function deterministicPasswords(): PasswordHasher {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hash:${password}`;
    }
  };
}
