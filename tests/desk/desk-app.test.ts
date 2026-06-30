import {
  AssignmentRuleService,
  CHILD_TABLE_ROW_INDEX_FIELD,
  CalendarService,
  CustomFieldService,
  createDeskApp,
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createDataPatchRollbackRetryJob,
  createRegistry,
  DashboardService,
  DataPatchService,
  DataPatchQueueService,
  defineClientScript,
  defineDataPatch,
  defineDashboard,
  defineCalendar,
  defineKanban,
  defineDocType,
  defineReport,
  defineWorkspace,
  deterministicIds,
  DocumentService,
  fileDocType,
  FileService,
  FieldPropertyService,
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
  KanbanService,
  jobScheduleDefinitionsStream,
  NotificationRuleService,
  QueryService,
  ReportService,
  REPORT_FORMULA_MAX_DEPTH,
  RoleService,
  SavedReportService,
  SavedListFilterService,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  UserNotificationService,
  UserProfileService,
  WorkflowService,
  type DocTypeDefinition,
  type FileStorage,
  type PrintPdfRenderer,
  type PutFileObjectCommand,
  type RenderPrintPdfCommand,
  type RenderedPrintPdf,
  type PasswordHasher
} from "../../src";
import {
  createChildTableServices,
  createLinkedServices,
  createSeriesServices,
  createServices,
  data,
  deepListFilterExpressionJson,
  guest,
  manager,
  noteDocType,
  now,
  openNotesReport,
  owner
} from "../helpers";

class RecordingPrintPdfRenderer implements PrintPdfRenderer {
  readonly calls: RenderPrintPdfCommand[] = [];

  constructor(private readonly result: RenderedPrintPdf = { body: new Uint8Array([37, 80, 68, 70]) }) {}

  async render(command: RenderPrintPdfCommand): Promise<RenderedPrintPdf> {
    this.calls.push(command);
    return this.result;
  }
}

class BufferedOnlyFileStorage implements FileStorage {
  readonly multipartUploads: NonNullable<FileStorage["multipartUploads"]>;

  constructor(private readonly storage: FileStorage & { readonly multipartUploads: NonNullable<FileStorage["multipartUploads"]> }) {
    this.multipartUploads = storage.multipartUploads;
  }

  put(command: PutFileObjectCommand) {
    return this.storage.put(command);
  }

  head(key: string) {
    return this.storage.head(key);
  }

  get(key: string) {
    return this.storage.get(key);
  }

  delete(key: string) {
    return this.storage.delete(key);
  }
}

describe("Desk app", () => {
  function makeDesk(
    actor = owner,
    options: {
      readonly realtime?: boolean;
      readonly documentShares?: boolean;
      readonly printPdfRenderer?: PrintPdfRenderer;
      readonly prints?: boolean;
      readonly reports?: boolean;
      readonly savedFilters?: boolean;
      readonly savedReports?: boolean;
    } = {}
  ) {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      ...(options.prints === false ? {} : { prints: services.prints }),
      printSettings: services.printSettings,
      ...(options.printPdfRenderer === undefined ? {} : { printPdfRenderer: options.printPdfRenderer }),
      queries: services.queries,
      ...(options.documentShares === false ? {} : { documentShares: services.documentShares }),
      ...(options.reports === false ? {} : { reports: services.reports }),
      timeline: services.history,
      ...(options.savedFilters === false ? {} : { savedFilters: services.savedFilters }),
      ...(options.savedReports === false ? {} : { savedReports: services.savedReports }),
      userPermissions: services.userPermissions,
      ...(options.realtime === undefined ? {} : { realtime: options.realtime }),
      actor: () => actor
    });
    return { app, services };
  }

  function makeFilterCollisionDesk() {
    const FilterCollision = defineDocType({
      name: "FilterCollision",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "count__between", type: "integer" },
        { name: "count__not_between", type: "integer" },
        { name: "body__is", type: "text" },
        { name: "title__like", type: "text" }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }]
    });
    const registry = createRegistry({ doctypes: [FilterCollision] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["collision-1", "collision-2"])
    });
    const queries = new QueryService({ registry, projections: store });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      actor: () => owner
    });
    return { app, documents };
  }

  function makeImportPermissionDesk(actor: { readonly id: string; readonly roles: readonly string[]; readonly tenantId: string }) {
    const ImportPermissionNote = defineDocType({
      name: "ImportPermissionNote",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "longText" }
      ],
      listView: {
        columns: ["title"],
        filterFields: ["title"]
      },
      permissions: [
        { roles: ["Import Creator"], actions: ["read", "create"] },
        { roles: ["Import Updater"], actions: ["read", "update"] }
      ]
    });
    const registry = createRegistry({ doctypes: [ImportPermissionNote] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["import-permission-1", "import-permission-2"])
    });
    const queries = new QueryService({ registry, projections: store });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      actor: () => actor
    });
    return { app, documents, queries };
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

  function makeWorkflowDesk(actor = owner) {
    const services = createServices(["base-1", "base-2"]);
    const workflows = new WorkflowService({
      registry: services.registry,
      events: services.store,
      ids: deterministicIds(["workflow-1", "workflow-2"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      workflows.effectiveDocType(base.name, context.tenantId, base);
    const documents = new DocumentService({
      registry: services.registry,
      store: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      userPermissions: services.userPermissions,
      ids: deterministicIds(["workflow-doc-1", "workflow-doc-2"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({
      registry: services.registry,
      projections: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      userPermissions: services.userPermissions
    });
    const app = createDeskApp({
      registry: services.registry,
      documents,
      prints: services.prints,
      queries,
      documentShares: services.documentShares,
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      savedReports: services.savedReports,
      workflows,
      userPermissions: services.userPermissions,
      actor: () => actor
    });
    return { app, services: { ...services, documents, queries, workflows } };
  }

  function makeFieldPropertyDesk(actor = owner) {
    const services = createServices(["base-1", "base-2"]);
    const fieldProperties = new FieldPropertyService({
      registry: services.registry,
      events: services.store,
      ids: deterministicIds(["property-1", "property-2"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      fieldProperties.effectiveDocType(base.name, context.tenantId, base);
    const documents = new DocumentService({
      registry: services.registry,
      store: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      userPermissions: services.userPermissions,
      ids: deterministicIds(["property-doc-1", "property-doc-2"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({
      registry: services.registry,
      projections: services.store,
      doctypeResolver,
      documentShares: services.documentShares,
      userPermissions: services.userPermissions
    });
    const app = createDeskApp({
      registry: services.registry,
      documents,
      prints: services.prints,
      queries,
      documentShares: services.documentShares,
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      savedReports: services.savedReports,
      fieldProperties,
      userPermissions: services.userPermissions,
      actor: () => actor
    });
    return { app, services: { ...services, documents, queries, fieldProperties } };
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
      readonly appMaxFileBytes?: number;
      readonly ids?: readonly string[];
      readonly fileIds?: readonly string[];
      readonly doctypes?: readonly DocTypeDefinition[];
      readonly directUploads?: boolean;
    } = {}
  ) {
    const registry = createRegistry({ doctypes: options.doctypes ?? [fileDocType] });
    const store = new InMemoryDocumentStore();
    const storage = new InMemoryFileStorage();
    const fileStorage = options.directUploads === false ? new BufferedOnlyFileStorage(storage) : storage;
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
      storage: fileStorage,
      clock: fixedClock(now),
      ids: deterministicIds(options.fileIds ?? ["object"]),
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes })
    });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      files,
      ...(options.appMaxFileBytes === undefined && options.maxFileBytes === undefined
        ? {}
        : { maxFileBytes: options.appMaxFileBytes ?? options.maxFileBytes }),
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

  it("renders global search through the query service boundary", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Launch Plan", body: "Coordinate the release" })
    });

    const empty = await app.request("/desk/search");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain('action="/desk/search"');
    expect(emptyHtml).toContain("Enter a search query.");
    expect(emptyHtml).toContain("Global Search");

    const escaped = await app.request("/desk/search?q=%22%3E%3Cscript%3E&tenant=acme%22%3E");
    expect(escaped.status).toBe(200);
    const escapedHtml = await escaped.text();
    expect(escapedHtml).toContain('value="&quot;&gt;&lt;script&gt;"');
    expect(escapedHtml).toContain('name="tenant" value="acme&quot;&gt;"');
    expect(escapedHtml).not.toContain('value=""><script>');

    const response = await app.request("/desk/search?q=launch&limit=5");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('value="launch"');
    expect(html).toContain("/desk/Note/Desk%20Launch%20Plan");
    expect(html).toContain("Desk Launch Plan");
    expect(html).toContain("<td>Note</td>");
    expect(html).toContain("<td>name</td>");
    expect(html).toContain("1 matches");
  });

  it("renders metadata-defined workspaces with permissioned shortcuts", async () => {
    const ReadOnlyLog = defineDocType({
      name: "ReadOnlyLog",
      fields: [{ name: "title", type: "text" }],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const CreateOnlyLog = defineDocType({
      name: "CreateOnlyLog",
      fields: [{ name: "title", type: "text" }],
      permissions: [{ roles: ["User"], actions: ["create"] }]
    });
    const registry = createRegistry({
      doctypes: [noteDocType, ReadOnlyLog, CreateOnlyLog],
      reports: [openNotesReport],
      dashboards: [
        defineDashboard({
          name: "Operations Dashboard",
          label: "Ops Dashboard",
          roles: ["User"],
          cards: [{ name: "open_notes", source: { kind: "documentCount", doctype: "Note" } }]
        }),
        defineDashboard({
          name: "Management Dashboard",
          label: "Management Dashboard",
          roles: ["Task Manager"],
          cards: [{ name: "managed_notes", source: { kind: "documentCount", doctype: "Note" } }]
        })
      ],
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
                { name: "new-note", kind: "newDoc", target: "Note" },
                { name: "read-only-log", label: "Read only logs", kind: "doctype", target: "ReadOnlyLog" },
                { name: "new-read-only-log", kind: "newDoc", target: "ReadOnlyLog" },
                { name: "create-only-log", label: "Create-only logs", kind: "doctype", target: "CreateOnlyLog" },
                { name: "new-create-only-log", kind: "newDoc", target: "CreateOnlyLog" },
                { name: "open-notes", label: "Open Notes", kind: "report", target: "Open Notes" },
                { name: "ops-dashboard", kind: "dashboard", target: "Operations Dashboard" },
                { name: "management-dashboard", kind: "dashboard", target: "Management Dashboard" },
                { name: "inbox", label: "Inbox", kind: "notifications" },
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
      ids: deterministicIds(["workspace-test", "workspace-create"])
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      reports,
      dashboards,
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
    expect(html).toContain('href="/desk/Note/new"');
    expect(html).toContain("New Note");
    expect(html).toContain('href="/desk/ReadOnlyLog"');
    expect(html).not.toContain('href="/desk/ReadOnlyLog/new"');
    expect(html).not.toContain("new-read-only-log");
    expect(html).not.toContain('href="/desk/CreateOnlyLog"');
    expect(html).toContain('href="/desk/CreateOnlyLog/new"');
    expect(html).toContain("New CreateOnlyLog");
    expect(html).toContain('href="/desk/reports/Open%20Notes"');
    expect(html).toContain('href="/desk/dashboards/Operations%20Dashboard"');
    expect(html).toContain("Ops Dashboard");
    expect(html).not.toContain('href="/desk/notifications"');
    expect(html).not.toContain("Management Dashboard");
    expect(html).not.toContain("Manager Only");

    const appWithNotifications = createDeskApp({
      registry,
      documents,
      queries,
      reports,
      dashboards,
      notifications: new UserNotificationService({ events: store }),
      actor: () => owner
    });
    const notificationsWorkspace = await appWithNotifications.request("/desk/workspaces/Operations");
    expect(notificationsWorkspace.status).toBe(200);
    await expect(notificationsWorkspace.text()).resolves.toContain('href="/desk/notifications"');

    const createOnlyNew = await app.request("/desk/CreateOnlyLog/new");
    expect(createOnlyNew.status).toBe(200);
    await expect(createOnlyNew.text()).resolves.toContain('action="/desk/CreateOnlyLog"');

    const created = await app.request("/desk/CreateOnlyLog", {
      method: "POST",
      body: new URLSearchParams({ title: "Desk Create Only" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/CreateOnlyLog/new?created=doc_workspace-test");
    const createOnlyCreated = await app.request(created.headers.get("location") ?? "");
    expect(createOnlyCreated.status).toBe(200);
    await expect(createOnlyCreated.text()).resolves.toContain("Created CreateOnlyLog/doc_workspace-test");
  });

  it("renders metadata-defined dashboards in Desk", async () => {
    const noteStateReport = defineReport({
      ...openNotesReport,
      name: "Note States",
      filters: [
        ...(openNotesReport.filters ?? []),
        { name: "workflow_state", label: "Workflow State", field: "workflow_state", type: "select" }
      ],
      groups: [
        {
          name: "by_state",
          label: "By State",
          field: "workflow_state",
          summaries: [{ name: "note_count", label: "Notes", aggregate: "count" }]
        }
      ],
      charts: [{ name: "notes_by_state", label: "Notes by State", type: "bar", group: "by_state", summary: "note_count" }]
    });
    const registry = createRegistry({
      doctypes: [noteDocType],
      reports: [openNotesReport, noteStateReport],
      dashboards: [
        defineDashboard({
          name: "Operations",
          label: "Operations",
          description: "Operational KPIs",
          roles: ["User"],
          cards: [
            {
              name: "open_notes",
              label: "Open Notes",
              description: "Readable open notes",
              indicator: "blue",
              source: { kind: "documentCount", doctype: "Note", filters: [{ field: "workflow_state", value: "Open" }] }
            },
            {
              name: "open_count_sum",
              label: "Open Count Sum",
              indicatorRules: [
                { operator: "gte", value: 10, indicator: "green" },
                { operator: "lt", value: 10, indicator: "amber" }
              ],
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "sum",
                field: "count",
                filters: [{ field: "workflow_state", value: "Open" }]
              }
            },
            {
              name: "high_total",
              label: "High Count",
              source: {
                kind: "reportSummary",
                report: "Open Notes",
                summary: "total_count",
                filters: { priority: "High" }
              }
            },
            {
              name: "priority_chart",
              label: "Priority Mix",
              description: "Readable notes by priority",
              source: {
                kind: "reportChart",
                report: "Note States",
                chart: "notes_by_state",
                filters: { priority: "High" }
              }
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
      ids: deterministicIds(["dash-1", "dash-2", "dash-3"])
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      reports,
      dashboards,
      actor: () => owner
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Open", priority: "High", workflow_state: "Open", count: 7 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Open", priority: "Low", workflow_state: "Open", count: 3 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Closed", priority: "High", workflow_state: "Closed", count: 5 })
    });

    const home = await app.request("/desk");
    expect(home.status).toBe(200);
    await expect(home.text()).resolves.toContain('href="/desk/dashboards/Operations"');

    const list = await app.request("/desk/dashboards");
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain("Operational KPIs");
    expect(listHtml).toContain("<td>4</td>");

    const page = await app.request("/desk/dashboards/Operations");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Readable open notes");
    expect(html).toContain(
      '<a class="dashboard-card-link" href="/desk/Note?default_filters=0&amp;filter_workflow_state=Open">'
    );
    expect(html).toContain("<strong>2</strong>");
    expect(html).toContain("Open Count Sum");
    expect(html).toContain("<strong>10</strong>");
    expect(html).toContain("<em>green</em>");
    expect(html).toContain("Note sum(count)");
    expect(html).toContain("High Count");
    expect(html).toContain('<a class="dashboard-card-link" href="/desk/reports/Open%20Notes?filter_priority=High">');
    expect(html).toContain("<strong>12</strong>");
    expect(html).toContain("Open Notes / total_count");
    expect(html).toContain("Priority Mix");
    expect(html).toContain("Readable notes by priority");
    expect(html).toContain("chart-svg chart-bar");
    expect(html).toContain("Note States / notes_by_state");
    expect(html).toContain(
      '<a class="chart-drilldown" href="/desk/reports/Note%20States?filter_priority=High&amp;filter_workflow_state=Open"><g>'
    );
  });

  it("uses the dashboard policy error for Desk dashboard routes when dashboards are disabled", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/dashboards/Operations");

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("Dashboards are not enabled");
  });

  it("renders metadata-defined kanban boards in Desk", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      kanbans: [
        defineKanban({
          name: "Notes Board",
          label: "Notes Board",
          description: "Work by state",
          roles: ["User"],
          doctype: "Note",
          columnField: "workflow_state",
          titleField: "title",
          columns: [
            { value: "Open", label: "Open" },
            { value: "Closed", label: "Closed" }
          ]
        })
      ],
      workspaces: [
        defineWorkspace({
          name: "Operations",
          sections: [
            {
              name: "main",
              shortcuts: [{ name: "notes-board", kind: "kanban", target: "Notes Board" }]
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
      ids: deterministicIds(["kanban-1", "kanban-2"])
    });
    const queries = new QueryService({ registry, projections: store });
    const kanbans = new KanbanService({ registry, queries });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      kanbans,
      actor: () => owner
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Kanban Open", priority: "High", workflow_state: "Open", count: 1 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Kanban Closed", priority: "High", workflow_state: "Closed", count: 2 })
    });

    const home = await app.request("/desk");
    expect(home.status).toBe(200);
    await expect(home.text()).resolves.toContain('href="/desk/kanbans/Notes%20Board"');

    const workspace = await app.request("/desk/workspaces/Operations");
    expect(workspace.status).toBe(200);
    await expect(workspace.text()).resolves.toContain('href="/desk/kanbans/Notes%20Board"');

    const list = await app.request("/desk/kanbans");
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain("Work by state");
    expect(listHtml).toContain("<td>workflow_state</td>");

    const page = await app.request("/desk/kanbans/Notes%20Board");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Work by state");
    expect(html).toContain("kanban-column");
    expect(html).toContain("Kanban Open");
    expect(html).toContain('href="/desk/Note/Kanban%20Open"');
    expect(html).toContain("Kanban Closed");
  });

  it("uses the kanban policy error for Desk kanban routes when kanbans are disabled", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/kanbans/Notes%20Board");

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("Kanbans are not enabled");
  });

  it("renders metadata-defined calendars in Desk", async () => {
    const Event = defineDocType({
      name: "Event",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "starts_on", type: "date" },
        { name: "category", type: "select", options: ["Customer", "Internal"] },
        { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
      ],
      permissions: [
        {
          roles: ["User"],
          actions: ["read", "create"],
          when: ({ actor, document }) => !document || document.data.created_by === actor.id
        }
      ]
    });
    const registry = createRegistry({
      doctypes: [Event],
      calendars: [
        defineCalendar({
          name: "Events Calendar",
          label: "Events Calendar",
          description: "Events by date",
          roles: ["User"],
          doctype: "Event",
          startField: "starts_on",
          titleField: "title",
          colorField: "category"
        })
      ],
      workspaces: [
        defineWorkspace({
          name: "Operations",
          sections: [
            {
              name: "main",
              shortcuts: [{ name: "events-calendar", kind: "calendar", target: "Events Calendar" }]
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
      ids: deterministicIds(["event-1"])
    });
    const queries = new QueryService({ registry, projections: store });
    const calendars = new CalendarService({ registry, queries });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      calendars,
      actor: () => owner
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: { title: "Calendar Event", starts_on: "2026-01-10", category: "Customer" }
    });

    const home = await app.request("/desk");
    expect(home.status).toBe(200);
    await expect(home.text()).resolves.toContain('href="/desk/calendars/Events%20Calendar"');

    const workspace = await app.request("/desk/workspaces/Operations");
    expect(workspace.status).toBe(200);
    await expect(workspace.text()).resolves.toContain('href="/desk/calendars/Events%20Calendar"');

    const list = await app.request("/desk/calendars");
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain("Events by date");
    expect(listHtml).toContain("<td>starts_on</td>");

    const page = await app.request("/desk/calendars/Events%20Calendar?from=2026-01-01&to=2026-01-31");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Events by date");
    expect(html).toContain("calendar-event");
    expect(html).toContain("Calendar Event");
    expect(html).toContain('href="/desk/Event/Calendar%20Event"');
  });

  it("uses the calendar policy error for Desk calendar routes when calendars are disabled", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/calendars/Events%20Calendar");

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("Calendars are not enabled");
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
    expect(html).toContain("/desk/reports/Open%20Notes/print?filter_priority=High&amp;order_by=title&amp;order=desc");

    const expression = encodeURIComponent(JSON.stringify({
      kind: "group",
      match: "all",
      filters: [{ filter: "priority", value: "High" }]
    }));
    const pagedReport = await app.request(
      `/desk/reports/Open%20Notes?filter_expression=${expression}&order_by=title&order=desc&limit=1&offset=1`
    );
    expect(pagedReport.status).toBe(200);
    const pagedHtml = await pagedReport.text();
    expect(pagedHtml).toContain("Alpha Report");
    expect(pagedHtml).not.toContain("Report Note");
    expect(pagedHtml).not.toContain("For reporting");
    expect(pagedHtml).toContain(
      `/desk/reports/Open%20Notes/export.csv?filter_expression=${expression}&amp;order_by=title&amp;order=desc&amp;limit=1&amp;offset=1`
    );

    const csv = await app.request("/desk/reports/Open%20Notes/export.csv?filter_priority=High&order_by=title&order=desc");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Open-Notes.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-exported")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-export-truncated")).toBe("false");
    await expect(csv.text()).resolves.toBe("Title,Priority,Body\nReport Note,High,For reporting\nAlpha Report,High,Earlier title");

    const expressionCsv = await app.request(
      `/desk/reports/Open%20Notes/export.csv?filter_expression=${expression}&order_by=title&order=desc&limit=1`
    );
    expect(expressionCsv.status).toBe(200);
    expect(expressionCsv.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(expressionCsv.headers.get("x-cf-frappe-exported")).toBe("1");
    expect(expressionCsv.headers.get("x-cf-frappe-export-truncated")).toBe("true");
    await expect(expressionCsv.text()).resolves.toBe("Title,Priority,Body\nReport Note,High,For reporting");

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

    const printable = await app.request("/desk/reports/Open%20Notes/print?filter_priority=High&order_by=title&order=desc");
    expect(printable.status).toBe(200);
    const printHtml = await printable.text();
    expect(printHtml).toContain("@page { size: A4 landscape; margin: 12mm 10mm 14mm 10mm; }");
    expect(printHtml).toContain('--print-font-family: "Inter", ui-serif, Georgia, Cambria, "Times New Roman", serif;');
    expect(printHtml).toContain("--print-font-size: 10pt;");
    expect(printHtml).toContain('<main class="print-page report-print-page">');
    expect(printHtml).toContain("<h1>Open Notes</h1>");
    expect(printHtml).toContain("<dt>Priority</dt><dd>High</dd>");
    expect(printHtml).toContain("<th>Title</th><th>Priority</th><th>Body</th>");
    expect(printHtml).toContain("<td>Report Note</td>");
    expect(printHtml.indexOf("Report Note")).toBeLessThan(printHtml.indexOf("Alpha Report"));
  });

  it("renders report PDF links and routes in Desk when a renderer is configured", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const renderer = new RecordingPrintPdfRenderer({ body: pdf, contentLength: pdf.byteLength });
    const { app, services } = makeDesk(owner, { printPdfRenderer: renderer });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Beta Report", priority: "High", body: "Later", count: 2 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Alpha Report", priority: "High", body: "First", count: 5 })
    });
    await services.printSettings.change({
      actor: { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] },
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 }
        }
      }
    });

    const page = await app.request("/desk/reports/Open%20Notes?filter_priority=High&order_by=title&order=asc");
    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain(
      "/desk/reports/Open%20Notes/pdf?filter_priority=High&amp;order_by=title&amp;order=asc"
    );

    const response = await app.request("/desk/reports/Open%20Notes/pdf?filter_priority=High&order_by=title&order=asc");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Open-Notes.report.pdf"');
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
        margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 }
      }
    });
    expect(renderer.calls[0]?.html).toContain("@page { size: A4 landscape; margin: 12mm 10mm 14mm 10mm; }");
    expect(renderer.calls[0]?.html.indexOf("Alpha Report")).toBeLessThan(
      renderer.calls[0]?.html.indexOf("Beta Report") ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("uses the print policy error for Desk report PDFs without a renderer", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/reports/Open%20Notes/pdf");

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("PDF print rendering is not configured");
  });

  it("uses the report policy error for Desk report routes when reports are disabled", async () => {
    const { app } = makeDesk(owner, { reports: false, printPdfRenderer: new RecordingPrintPdfRenderer() });
    const paths = [
      "/desk/reports/Open%20Notes",
      "/desk/reports/Open%20Notes/print",
      "/desk/reports/Open%20Notes/pdf",
      "/desk/reports/Open%20Notes/export.csv"
    ];

    for (const path of paths) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toContain("Reports are not enabled");
    }
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
    expect(builderHtml).toContain('name="filterOperator:priority"');
    expect(builderHtml).toContain('name="filterDefault:priority"');
    expect(builderHtml).toContain('name="filterRequired:priority"');
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
    expect(builderHtml).toContain("data-cf-frappe-report-formula-builder");
    expect(builderHtml).toContain(`data-formula-max-depth="${REPORT_FORMULA_MAX_DEPTH}"`);
    expect(builderHtml).toContain('name="formulaLeftKind"');
    expect(builderHtml).toContain('name="formulaLeftLiteral" type="number" step="any"');
    expect(builderHtml).toContain('data-formula-prefix="formulaLeft"');
    expect(builderHtml).not.toContain('name="formulaLeftLeftKind"');
    expect(builderHtml).toContain('<select name="formulaOperator">');
    expect(builderHtml).toContain('name="formulaRightKind"');
    expect(builderHtml).toContain('name="formulaRightLiteral" type="number" step="any"');

    const body = new URLSearchParams();
    body.set("label", "High count desk report");
    body.append("column", "title");
    body.append("column", "count");
    body.set("formulaLabel", "Double Count");
    body.set("formulaLeft", "count");
    body.set("formulaOperator", "multiply");
    body.set("formulaRightKind", "literal");
    body.set("formulaRightLiteral", "2");
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
    expect(html).toContain("/desk/report-builder/Note/report_saved-report-1/print?filter_priority=High&amp;order_by=count&amp;order=desc");
    expect(html).toContain('action="/desk/report-builder/Note/report_saved-report-1/delete"');

    const expression = encodeURIComponent(JSON.stringify({
      kind: "group",
      match: "all",
      filters: [{ filter: "priority", value: "High" }]
    }));
    const pagedRun = await app.request(
      `/desk/report-builder/Note/report_saved-report-1?filter_expression=${expression}&order_by=count&order=desc&limit=1&offset=1`
    );
    expect(pagedRun.status).toBe(200);
    const pagedHtml = await pagedRun.text();
    expect(pagedHtml).toContain("High Count A");
    expect(pagedHtml).not.toContain("High Count B");
    expect(pagedHtml).toContain(
      `/desk/report-builder/Note/report_saved-report-1/export.csv?filter_expression=${expression}&amp;order_by=count&amp;order=desc&amp;limit=1&amp;offset=1`
    );
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
            formula: { operator: "multiply", left: "count", right: 2 }
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

    const expressionCsv = await app.request(
      `/desk/report-builder/Note/report_saved-report-1/export.csv?filter_expression=${expression}&order_by=count&order=desc&limit=1`
    );
    expect(expressionCsv.status).toBe(200);
    await expect(expressionCsv.text()).resolves.toBe("title,count,Double Count\nHigh Count B,7,14");

    await services.printSettings.change({
      actor: { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] },
      settings: {
        defaultLayout: {
          pageSize: { widthMm: 210, heightMm: 297 },
          margins: { topMm: 8, rightMm: 8, bottomMm: 12, leftMm: 8 }
        }
      }
    });

    const printable = await app.request(
      "/desk/report-builder/Note/report_saved-report-1/print?filter_priority=High&order_by=count&order=desc"
    );
    expect(printable.status).toBe(200);
    const printHtml = await printable.text();
    expect(printHtml).toContain("@page { size: 210mm 297mm; margin: 8mm 8mm 12mm 8mm; }");
    expect(printHtml).toContain("<h1>High count desk report</h1>");
    expect(printHtml).toContain("<dt>Priority</dt><dd>High</dd>");
    expect(printHtml).toContain("<th>title</th><th>count</th><th>Double Count</th>");
    expect(printHtml).toContain("<td>High Count B</td><td>7</td><td>14</td>");

    const deleted = await app.request("/desk/report-builder/Note/report_saved-report-1/delete", {
      method: "POST"
    });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/desk/report-builder/Note");
    const afterDelete = await app.request("/desk/report-builder/Note");
    await expect(afterDelete.text()).resolves.toContain("No saved reports.");
  });

  it("renders saved report PDF links and routes in Desk when a renderer is configured", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const renderer = new RecordingPrintPdfRenderer({ body: pdf, contentLength: pdf.byteLength });
    const { app, services } = makeDesk(owner, { printPdfRenderer: renderer });
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
    await services.printSettings.change({
      actor: { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] },
      settings: {
        defaultLayout: {
          pageSize: { widthMm: 210, heightMm: 297 },
          margins: { topMm: 8, rightMm: 8, bottomMm: 12, leftMm: 8 }
        }
      }
    });

    const body = new URLSearchParams();
    body.set("label", "High count desk report");
    body.append("column", "title");
    body.append("column", "count");
    body.append("filter", "priority");
    body.set("orderBy", "count");
    body.set("order", "desc");
    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    expect(saved.status).toBe(303);

    const page = await app.request(
      "/desk/report-builder/Note/report_saved-report-1?filter_priority=High&order_by=count&order=desc"
    );
    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain(
      "/desk/report-builder/Note/report_saved-report-1/pdf?filter_priority=High&amp;order_by=count&amp;order=desc"
    );

    const response = await app.request(
      "/desk/report-builder/Note/report_saved-report-1/pdf?filter_priority=High&order_by=count&order=desc"
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Saved-Report-report_saved-report-1.report.pdf"');
    await expect(response.arrayBuffer()).resolves.toEqual(pdf.buffer);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0]).toMatchObject({
      actorId: owner.id,
      tenantId: owner.tenantId,
      formatName: "Report",
      documentName: "Saved Report report_saved report 1",
      documentDoctype: "Note",
      title: "High count desk report - Report",
      layout: {
        pageSize: { widthMm: 210, heightMm: 297 },
        margins: { topMm: 8, rightMm: 8, bottomMm: 12, leftMm: 8 }
      }
    });
    expect(renderer.calls[0]?.html).toContain("<h1>High count desk report</h1>");
    expect(renderer.calls[0]?.html).toContain("<td>High Count B</td><td>7</td>");
  });

  it("uses the print policy error for Desk saved report PDFs without a renderer", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/report-builder/Note/report_saved-report-1/pdf");

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("PDF print rendering is not configured");
  });

  it("uses the saved-report policy error for Desk report-builder routes when saved reports are disabled", async () => {
    const { app } = makeDesk(owner, { savedReports: false, printPdfRenderer: new RecordingPrintPdfRenderer() });
    const requests: readonly [string, RequestInit | undefined][] = [
      ["/desk/report-builder/Note", undefined],
      ["/desk/report-builder/Note", {
        method: "POST",
        body: new URLSearchParams({ label: "High notes" }),
        headers: { "content-type": "application/x-www-form-urlencoded" }
      }],
      ["/desk/report-builder/Note/report_saved-report-1", undefined],
      ["/desk/report-builder/Note/report_saved-report-1/export.csv", undefined],
      ["/desk/report-builder/Note/report_saved-report-1/print", undefined],
      ["/desk/report-builder/Note/report_saved-report-1/pdf", undefined],
      ["/desk/report-builder/Note/report_saved-report-1/delete", { method: "POST" }]
    ];

    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toContain("Saved reports are not enabled");
    }
  });

  it("builds saved report filter presets from visual Desk report-builder controls", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Filter Preset", priority: "Low", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Filter Preset", priority: "High", count: 5 })
    });

    const body = new URLSearchParams();
    body.set("label", "Preset filter report");
    body.append("column", "title");
    body.append("column", "priority");
    body.append("filter", "priority");
    body.set("filterOperator:priority", "eq");
    body.set("filterDefault:priority", "High");
    body.set("filterRequired:priority", "1");

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/report-builder/Note/report_saved-report-1");
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        filters: [
          expect.objectContaining({
            name: "priority",
            defaultValue: "High",
            required: true
          })
        ]
      }
    });

    const defaultRun = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(defaultRun.status).toBe(200);
    const defaultHtml = await defaultRun.text();
    expect(defaultHtml).toContain("High Filter Preset");
    expect(defaultHtml).not.toContain("Low Filter Preset");
    expect(defaultHtml).toContain('<option value="High" selected>High</option>');

    const overrideRun = await app.request("/desk/report-builder/Note/report_saved-report-1?filter_priority=Low");
    expect(overrideRun.status).toBe(200);
    const overrideHtml = await overrideRun.text();
    expect(overrideHtml).toContain("Low Filter Preset");
    expect(overrideHtml).not.toContain("High Filter Preset");
  });

  it("builds saved report filter expressions from visual Desk report-builder controls", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Expression", priority: "Low", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Expression", priority: "High", count: 5 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Count Expression", priority: "Medium", count: 7 })
    });

    const builder = await app.request("/desk/report-builder/Note");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain('src="/desk/client.js" data-cf-frappe-runtime="desk"');
    expect(builderHtml).toContain('data-scope="report-builder"');
    expect(builderHtml).toContain('data-filter-expression-kind="report"');
    expect(builderHtml).toContain('name="filter_expression"');

    const body = new URLSearchParams();
    body.set("label", "Expression report");
    body.append("column", "title");
    body.append("column", "priority");
    body.append("column", "count");
    body.set("filter_expression", JSON.stringify({
      kind: "group",
      match: "any",
      filters: [
        { filter: "priority", value: "High" },
        { filter: "count", value: 7 }
      ]
    }));

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/report-builder/Note/report_saved-report-1");
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        filters: [
          expect.objectContaining({ name: "priority" }),
          expect.objectContaining({ name: "count" })
        ],
        filterExpression: {
          match: "any",
          filters: [
            { filter: "priority", value: "High" },
            { filter: "count", value: 7 }
          ]
        }
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("High Expression");
    expect(html).toContain("Count Expression");
    expect(html).not.toContain("Low Expression");
  });

  it("keeps link filter presets as exact-match controls by default", async () => {
    const services = createLinkedServices(["project-1", "task-1"]);
    const reports = new ReportService({ registry: services.registry, queries: services.queries });
    const savedReports = new SavedReportService({
      registry: services.registry,
      events: services.events,
      reports,
      clock: fixedClock(now),
      ids: deterministicIds(["saved-report-1", "saved-report-event-1"])
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports,
      savedReports,
      actor: () => owner
    });

    const builder = await app.request("/desk/report-builder/Task");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain('name="filterOperator:project"');
    expect(builderHtml).toContain('<option value="eq" selected>Equals</option>');
    expect(builderHtml).toContain('<option value="ne">Not equals</option>');

    const body = new URLSearchParams();
    body.set("label", "Task project report");
    body.append("column", "title");
    body.append("filter", "project");
    const saved = await app.request("/desk/report-builder/Task", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    const report = await savedReports.get(owner, "Task", "report_saved-report-1");
    expect(report.definition.filters?.[0]).toMatchObject({ name: "project", field: "project", type: "link" });
    expect(report.definition.filters?.[0]).not.toHaveProperty("operator");
  });

  it("builds saved report not-equals filters from visual Desk report-builder controls", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Filter Preset", priority: "Low", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Filter Preset", priority: "High", count: 5 })
    });

    const builder = await app.request("/desk/report-builder/Note");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain('name="filterOperator:priority"');
    expect(builderHtml).toContain('<option value="ne">Not equals</option>');

    const body = new URLSearchParams();
    body.set("label", "Not high report");
    body.append("column", "title");
    body.append("column", "priority");
    body.append("filter", "priority");
    body.set("filterOperator:priority", "ne");
    body.set("filterDefault:priority", "High");

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        filters: [
          expect.objectContaining({
            name: "priority",
            operator: "ne",
            defaultValue: "High"
          })
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("Low Filter Preset");
    expect(html).not.toContain("High Filter Preset");
    expect(html).toContain('<option value="High" selected>High</option>');
  });

  it("builds nested saved report formulas from visual Desk report-builder controls", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Nested Count", priority: "High", count: 7 })
    });

    const body = new URLSearchParams();
    body.set("label", "Nested formula report");
    body.append("column", "title");
    body.append("column", "count");
    body.set("formulaLabel", "Adjusted Count");
    body.set("formulaLeftKind", "nested");
    body.set("formulaLeftOperator", "multiply");
    body.set("formulaLeftLeftKind", "field");
    body.set("formulaLeftLeft", "count");
    body.set("formulaLeftRightKind", "literal");
    body.set("formulaLeftRightLiteral", "2");
    body.set("formulaOperator", "add");
    body.set("formulaRightKind", "literal");
    body.set("formulaRightLiteral", "1");

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/report-builder/Note/report_saved-report-1");
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        columns: [
          expect.objectContaining({ name: "title" }),
          expect.objectContaining({ name: "count" }),
          expect.objectContaining({
            name: "adjusted_count",
            label: "Adjusted Count",
            formula: {
              operator: "add",
              left: { operator: "multiply", left: "count", right: 2 },
              right: 1
            }
          })
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("<th>Adjusted Count</th>");
    expect(html).toContain("<td>15</td>");
  });

  it("builds two-level nested saved report formulas from visual Desk report-builder controls", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Deep Nested Count", priority: "High", count: 5 })
    });

    const builder = await app.request("/desk/report-builder/Note");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain("data-cf-frappe-report-formula-builder");
    expect(builderHtml).toContain(`data-formula-max-depth="${REPORT_FORMULA_MAX_DEPTH}"`);
    expect(builderHtml).not.toContain('name="formulaLeftLeftOperator"');

    const body = new URLSearchParams();
    body.set("label", "Deep nested formula report");
    body.append("column", "title");
    body.append("column", "count");
    body.set("formulaLabel", "Deep Score");
    body.set("formulaLeftKind", "nested");
    body.set("formulaLeftOperator", "subtract");
    body.set("formulaLeftLeftKind", "nested");
    body.set("formulaLeftLeftOperator", "multiply");
    body.set("formulaLeftLeftLeftKind", "field");
    body.set("formulaLeftLeftLeft", "count");
    body.set("formulaLeftLeftRightKind", "literal");
    body.set("formulaLeftLeftRightLiteral", "2");
    body.set("formulaLeftRightKind", "literal");
    body.set("formulaLeftRightLiteral", "3");
    body.set("formulaOperator", "add");
    body.set("formulaRightKind", "literal");
    body.set("formulaRightLiteral", "1");

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        columns: [
          expect.objectContaining({ name: "title" }),
          expect.objectContaining({ name: "count" }),
          expect.objectContaining({
            name: "deep_score",
            label: "Deep Score",
            formula: {
              operator: "add",
              left: {
                operator: "subtract",
                left: { operator: "multiply", left: "count", right: 2 },
                right: 3
              },
              right: 1
            }
          })
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("<th>Deep Score</th>");
    expect(html).toContain("<td>8</td>");
  });

  it("builds core-depth saved report formulas from visual Desk report-builder control names", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Core Depth Count", priority: "High", count: 4 })
    });

    const body = new URLSearchParams();
    body.set("label", "Core depth formula report");
    body.append("column", "title");
    body.append("column", "count");
    body.set("formulaLabel", "Core Depth Score");
    body.set("formulaOperator", "add");
    body.set("formulaRightKind", "literal");
    body.set("formulaRightLiteral", "1");
    addLeftNestedFormulaPath(body, REPORT_FORMULA_MAX_DEPTH);

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        columns: [
          expect.objectContaining({ name: "title" }),
          expect.objectContaining({ name: "count" }),
          expect.objectContaining({
            name: "core_depth_score",
            label: "Core Depth Score",
            formula: {
              operator: "add",
              left: coreDepthFormulaExpectation(REPORT_FORMULA_MAX_DEPTH),
              right: 1
            }
          })
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain("<th>Core Depth Score</th>");
    expect(html).toContain("<td>20</td>");
  });

  it("rejects invalid Desk report-builder formula literal operands without persisting them", async () => {
    const { app } = makeDesk();
    const invalidLiteral = new URLSearchParams();
    invalidLiteral.set("label", "Invalid literal report");
    invalidLiteral.append("column", "title");
    invalidLiteral.set("formulaLabel", "Bad Score");
    invalidLiteral.set("formulaLeft", "count");
    invalidLiteral.set("formulaOperator", "multiply");
    invalidLiteral.set("formulaRightKind", "literal");
    invalidLiteral.set("formulaRightLiteral", "NaN");

    const response = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidLiteral
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Report formula right number must be finite");

    const builder = await app.request("/desk/report-builder/Note");
    await expect(builder.text()).resolves.toContain("No saved reports.");
  });

  it("rejects invalid Desk report-builder filter preset values without persisting them", async () => {
    const { app } = makeDesk();
    const invalidDefault = new URLSearchParams();
    invalidDefault.set("label", "Invalid preset report");
    invalidDefault.append("column", "title");
    invalidDefault.append("filter", "count");
    invalidDefault.set("filterOperator:count", "gte");
    invalidDefault.set("filterDefault:count", "many");

    const response = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: invalidDefault
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Report filter count default must be an integer");

    const builder = await app.request("/desk/report-builder/Note");
    await expect(builder.text()).resolves.toContain("No saved reports.");
  });

  it("rejects required Desk report-builder filter presets without defaults", async () => {
    const { app } = makeDesk();
    const missingDefault = new URLSearchParams();
    missingDefault.set("label", "Missing default report");
    missingDefault.append("column", "title");
    missingDefault.append("filter", "priority");
    missingDefault.set("filterRequired:priority", "1");

    const response = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: missingDefault
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Report filter priority default is required when the filter is required");

    const builder = await app.request("/desk/report-builder/Note");
    await expect(builder.text()).resolves.toContain("No saved reports.");
  });

  it("builds saved report numeric range filters from visual Desk report-builder controls", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Low Range Count", priority: "Low", count: 2 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Middle Range Count", priority: "Medium", count: 5 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "High Range Count", priority: "High", count: 9 })
    });

    const builder = await app.request("/desk/report-builder/Note");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain('name="filterRangeMin" value="count"');
    expect(builderHtml).toContain('name="filterRangeMinDefault:count" type="number"');
    expect(builderHtml).toContain('name="filterRangeMax" value="count"');
    expect(builderHtml).toContain('name="filterRangeMaxDefault:count" type="number"');

    const body = new URLSearchParams();
    body.set("label", "Count range report");
    body.append("column", "title");
    body.append("column", "count");
    body.append("filterRangeMin", "count");
    body.set("filterRangeMinDefault:count", "3");
    body.append("filterRangeMax", "count");
    body.set("filterRangeMaxDefault:count", "7");

    const saved = await app.request("/desk/report-builder/Note", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    await expect(services.savedReports.get(owner, "Note", "report_saved-report-1")).resolves.toMatchObject({
      definition: {
        filters: [
          {
            name: "count_min",
            label: "count from",
            field: "count",
            type: "integer",
            operator: "gte",
            defaultValue: 3
          },
          {
            name: "count_max",
            label: "count to",
            field: "count",
            type: "integer",
            operator: "lte",
            defaultValue: 7
          }
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain('<input id="filter-count-min" name="filter_count_min" type="number" value="3">');
    expect(html).toContain('<input id="filter-count-max" name="filter_count_max" type="number" value="7">');
    expect(html).toContain("Middle Range Count");
    expect(html).not.toContain("Low Range Count");
    expect(html).not.toContain("High Range Count");

    const expanded = await app.request(
      "/desk/report-builder/Note/report_saved-report-1?filter_count_min=1&filter_count_max=10"
    );
    expect(expanded.status).toBe(200);
    const expandedHtml = await expanded.text();
    expect(expandedHtml).toContain("Low Range Count");
    expect(expandedHtml).toContain("Middle Range Count");
    expect(expandedHtml).toContain("High Range Count");
  });

  it("renders saved report not-between range filters with repeated inputs", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Report Low", priority: "Low", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Report Middle", priority: "Medium", count: 5 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Report High", priority: "High", count: 9 })
    });
    await services.savedReports.save({
      actor: owner,
      doctype: "Note",
      label: "Outside count report",
      definition: {
        columns: [{ name: "title" }, { name: "count" }],
        filters: [{ name: "outside_count", field: "count", operator: "not_between", defaultValue: [2, 8] }]
      }
    });

    const run = await app.request("/desk/report-builder/Note/report_saved-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain('<input id="filter-outside-count-min" name="filter_outside_count" type="number" value="2">');
    expect(html).toContain('<input id="filter-outside-count-max" name="filter_outside_count" type="number" value="8">');
    expect(html).toContain("Desk Report Low");
    expect(html).toContain("Desk Report High");
    expect(html).not.toContain("Desk Report Middle");

    const narrowed = await app.request(
      "/desk/report-builder/Note/report_saved-report-1?filter_outside_count=0&filter_outside_count=10"
    );
    expect(narrowed.status).toBe(200);
    const narrowedHtml = await narrowed.text();
    expect(narrowedHtml).not.toContain("Desk Report Low");
    expect(narrowedHtml).not.toContain("Desk Report Middle");
    expect(narrowedHtml).not.toContain("Desk Report High");
  });

  it("builds saved report date and datetime range filters from visual Desk report-builder controls", async () => {
    const Event = defineDocType({
      name: "Event",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "event_date", label: "Event Date", type: "date" },
        { name: "starts_at", label: "Starts At", type: "datetime" }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });
    const registry = createRegistry({ doctypes: [Event] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["event-1", "event-2", "event-3", "event-4"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const savedReports = new SavedReportService({
      registry,
      events: store,
      reports,
      ids: deterministicIds(["event-report-1", "event-report-event-1"]),
      clock: fixedClock(now)
    });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      reports,
      savedReports,
      actor: () => owner
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: { title: "Too Early", event_date: "2026-01-01", starts_at: "2026-01-03T08:30" }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: { title: "Inside Morning", event_date: "2026-01-03", starts_at: "2026-01-03T09:30" }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: { title: "Inside Evening", event_date: "2026-01-05", starts_at: "2026-01-05T17:45" }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: { title: "Too Late", event_date: "2026-01-07", starts_at: "2026-01-05T18:30" }
    });

    const builder = await app.request("/desk/report-builder/Event");
    expect(builder.status).toBe(200);
    const builderHtml = await builder.text();
    expect(builderHtml).toContain('name="filterRangeMin" value="event_date"');
    expect(builderHtml).toContain('name="filterRangeMinDefault:event_date" type="date"');
    expect(builderHtml).toContain('name="filterRangeMax" value="event_date"');
    expect(builderHtml).toContain('name="filterRangeMaxDefault:event_date" type="date"');
    expect(builderHtml).toContain('name="filterRangeMin" value="starts_at"');
    expect(builderHtml).toContain('name="filterRangeMinDefault:starts_at" type="datetime-local"');
    expect(builderHtml).toContain('name="filterRangeMax" value="starts_at"');
    expect(builderHtml).toContain('name="filterRangeMaxDefault:starts_at" type="datetime-local"');

    const body = new URLSearchParams();
    body.set("label", "Event schedule report");
    body.append("column", "title");
    body.append("column", "event_date");
    body.append("column", "starts_at");
    body.append("filterRangeMin", "event_date");
    body.set("filterRangeMinDefault:event_date", "2026-01-02");
    body.append("filterRangeMax", "event_date");
    body.set("filterRangeMaxDefault:event_date", "2026-01-06");
    body.append("filterRangeMin", "starts_at");
    body.set("filterRangeMinDefault:starts_at", "2026-01-03T09:00");
    body.append("filterRangeMax", "starts_at");
    body.set("filterRangeMaxDefault:starts_at", "2026-01-05T18:00");

    const saved = await app.request("/desk/report-builder/Event", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    await expect(savedReports.get(owner, "Event", "report_event-report-1")).resolves.toMatchObject({
      definition: {
        filters: [
          {
            name: "event_date_min",
            label: "Event Date from",
            field: "event_date",
            type: "date",
            operator: "gte",
            defaultValue: "2026-01-02"
          },
          {
            name: "starts_at_min",
            label: "Starts At from",
            field: "starts_at",
            type: "datetime",
            operator: "gte",
            defaultValue: "2026-01-03T09:00"
          },
          {
            name: "event_date_max",
            label: "Event Date to",
            field: "event_date",
            type: "date",
            operator: "lte",
            defaultValue: "2026-01-06"
          },
          {
            name: "starts_at_max",
            label: "Starts At to",
            field: "starts_at",
            type: "datetime",
            operator: "lte",
            defaultValue: "2026-01-05T18:00"
          }
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Event/report_event-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain(
      '<input id="filter-event-date-min" name="filter_event_date_min" type="date" value="2026-01-02">'
    );
    expect(html).toContain(
      '<input id="filter-event-date-max" name="filter_event_date_max" type="date" value="2026-01-06">'
    );
    expect(html).toContain(
      '<input id="filter-starts-at-min" name="filter_starts_at_min" type="datetime-local" value="2026-01-03T09:00">'
    );
    expect(html).toContain(
      '<input id="filter-starts-at-max" name="filter_starts_at_max" type="datetime-local" value="2026-01-05T18:00">'
    );
    expect(html).toContain("Inside Morning");
    expect(html).toContain("Inside Evening");
    expect(html).not.toContain("Too Early");
    expect(html).not.toContain("Too Late");

    const expanded = await app.request(
      "/desk/report-builder/Event/report_event-report-1?filter_event_date_min=2026-01-01&filter_starts_at_min=2026-01-03T08:00&filter_event_date_max=2026-01-07&filter_starts_at_max=2026-01-05T19:00"
    );
    expect(expanded.status).toBe(200);
    const expandedHtml = await expanded.text();
    expect(expandedHtml).toContain("Too Early");
    expect(expandedHtml).toContain("Inside Morning");
    expect(expandedHtml).toContain("Inside Evening");
    expect(expandedHtml).toContain("Too Late");
  });

  it("allocates collision-free saved report range filter names", async () => {
    const Metric = defineDocType({
      name: "Metric",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "count", type: "integer" },
        { name: "count_min", type: "integer" }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });
    const registry = createRegistry({ doctypes: [Metric] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["metric-1"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const savedReports = new SavedReportService({
      registry,
      events: store,
      reports,
      ids: deterministicIds(["metric-report-1", "metric-report-event-1"]),
      clock: fixedClock(now)
    });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      reports,
      savedReports,
      actor: () => owner
    });

    const body = new URLSearchParams();
    body.set("label", "Metric collision report");
    body.append("column", "title");
    body.append("filter", "count_min");
    body.append("filterRangeMin", "count");
    body.set("filterRangeMinDefault:count", "3");

    const saved = await app.request("/desk/report-builder/Metric", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    expect(saved.status).toBe(303);
    await expect(savedReports.get(owner, "Metric", "report_metric-report-1")).resolves.toMatchObject({
      definition: {
        filters: [
          expect.objectContaining({ name: "count_min", field: "count_min" }),
          expect.objectContaining({ name: "count_min_2", field: "count", operator: "gte", defaultValue: 3 })
        ]
      }
    });

    const run = await app.request("/desk/report-builder/Metric/report_metric-report-1");
    expect(run.status).toBe(200);
    const html = await run.text();
    expect(html).toContain('name="filter_count_min"');
    expect(html).toContain('name="filter_count_min_2"');
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
    body.set("formulaLeftKind", "field");
    body.set("formulaLeft", "");
    body.set("formulaLeftOperator", "");
    body.set("formulaLeftLeftKind", "field");
    body.set("formulaLeftLeft", "");
    body.set("formulaLeftLeftLiteral", "");
    body.set("formulaLeftRightKind", "field");
    body.set("formulaLeftRight", "");
    body.set("formulaLeftRightLiteral", "");
    body.set("formulaOperator", "");
    body.set("formulaRightKind", "field");
    body.set("formulaRight", "");
    body.set("formulaRightOperator", "");
    body.set("formulaRightLeftKind", "field");
    body.set("formulaRightLeft", "");
    body.set("formulaRightLeftLiteral", "");
    body.set("formulaRightRightKind", "field");
    body.set("formulaRightRight", "");
    body.set("formulaRightRightLiteral", "");
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
    expect(html).toContain('class="panel form file-upload"');
    expect(html).toContain('data-upload-mode="direct"');
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

  it("renders buffered Desk file forms when storage cannot create direct upload targets", async () => {
    const { app, documents } = makeFileDesk(owner, {
      directUploads: false,
      doctypes: [noteDocType, fileDocType],
      ids: ["note-create"]
    });

    const response = await app.request("/desk/files");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('class="panel form file-upload"');
    expect(html).toContain('method="post"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('data-max-file-bytes="26214400"');
    expect(html).not.toContain('data-upload-mode="direct"');

    await documents.create({ actor: owner, doctype: "Note", data: data() });
    const documentResponse = await app.request("/desk/Note/My%20Note");
    expect(documentResponse.status).toBe(200);
    const documentHtml = await documentResponse.text();
    expect(documentHtml).toContain('class="form attachment-upload"');
    expect(documentHtml).toContain('data-attached-to-doctype="Note"');
    expect(documentHtml).not.toContain('data-upload-mode="direct"');
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
    expect(emptyHtml).toContain('data-upload-mode="direct"');
    expect(emptyHtml).toContain('data-attached-to-doctype="Note"');
    expect(emptyHtml).toContain('data-attached-to-name="My Note"');
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

  it("uses the FileService upload limit for Desk preflight even when adapter options drift", async () => {
    const { app, storage } = makeFileDesk(owner, { maxFileBytes: 4, appMaxFileBytes: 99 });

    const response = await app.request("/desk/files", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=oversized",
        "content-length": "5"
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

  it("renders Desk file upload limit metadata for browser-side preflight", async () => {
    const { app, documents } = makeFileDesk(owner, {
      doctypes: [noteDocType, fileDocType],
      ids: ["note-create"],
      maxFileBytes: 4
    });
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const manager = await app.request("/desk/files");
    expect(manager.status).toBe(200);
    await expect(manager.text()).resolves.toContain('data-max-file-bytes="4"');

    const document = await app.request("/desk/Note/My%20Note");
    expect(document.status).toBe(200);
    await expect(document.text()).resolves.toContain('data-max-file-bytes="4"');
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

  it("hides Desk file upload controls from actors without File create permission", async () => {
    const services = makeFileDesk(owner, {
      doctypes: [noteDocType, fileDocType],
      ids: ["note-create"],
      fileIds: ["blocked-manager", "blocked-attachment"]
    });
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    const guestApp = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      files: services.files,
      actor: () => guest
    });

    const manager = await guestApp.request("/desk/files");
    expect(manager.status).toBe(200);
    const managerHtml = await manager.text();
    expect(managerHtml).not.toContain('class="panel form file-upload"');
    expect(managerHtml).not.toContain('action="/desk/files" enctype="multipart/form-data"');

    const managerUpload = new FormData();
    managerUpload.append("file", new Blob(["blocked"], { type: "text/plain" }), "blocked.txt");
    const managerPosted = await guestApp.request("/desk/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: managerUpload
    });
    expect(managerPosted.status).toBe(403);
    const managerError = await managerPosted.text();
    expect(managerError).toContain("cannot create File");
    expect(managerError).not.toContain('class="panel form file-upload"');

    const document = await guestApp.request("/desk/Note/My%20Note");
    expect(document.status).toBe(200);
    const documentHtml = await document.text();
    expect(documentHtml).toContain("Attachments");
    expect(documentHtml).not.toContain('class="form attachment-upload"');
    expect(documentHtml).not.toContain('action="/desk/Note/My%20Note/files"');

    const attachmentUpload = new FormData();
    attachmentUpload.append("file", new Blob(["blocked"], { type: "text/plain" }), "blocked.txt");
    const attachmentPosted = await guestApp.request("/desk/Note/My%20Note/files", {
      method: "POST",
      headers: { "content-length": "512" },
      body: attachmentUpload
    });
    expect(attachmentPosted.status).toBe(403);
    const attachmentError = await attachmentPosted.text();
    expect(attachmentError).toContain("cannot create File");
    expect(attachmentError).not.toContain('class="form attachment-upload"');
    expect(services.storage.has("acme/files/file_blocked-manager-blocked.txt")).toBe(false);
    expect(services.storage.has("acme/files/file_blocked-attachment-blocked.txt")).toBe(false);
  });

  it("renders list and create form pages", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const list = await app.request("/desk/Note");
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain("My Note");
    expect(listHtml).toContain('href="/desk/Note/new"');

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

  it("renders generated CSV import controls for actors who can create or update documents", async () => {
    const { app } = makeDesk(owner);

    const list = await app.request("/desk/Note?filter_priority=High&order_by=count&order=asc");

    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain('action="/desk/Note/import.csv"');
    expect(html).toContain('href="/desk/Note/import-template.csv"');
    expect(html).toContain('name="returnTo" value="/desk/Note?filter_priority=High&amp;order_by=count&amp;order=asc"');
    expect(html).toContain('name="mode"');
    expect(html).toContain('<option value="create" selected>Create</option>');
    expect(html).toContain('<option value="update">Update</option>');
    expect(html).toContain('name="csv"');
    expect(html).toContain("Import CSV");
  });

  it("downloads generated CSV import templates from Desk", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/Note/import-template.csv");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Note-import-template.csv"');
    await expect(response.text()).resolves.toBe(
      "name,expectedVersion,title,body,priority,count,workflow_state\n,,,,Medium,0,Open"
    );
  });

  it("rejects direct generated CSV import template downloads from read-only actors", async () => {
    const { app } = makeDesk(guest);

    const response = await app.request("/desk/Note/import-template.csv");

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain("Actor &#39;guest&#39; cannot import Note");
  });

  it("renders only generated CSV import modes allowed for the actor", async () => {
    const createOnly = { id: "creator@example.com", roles: ["Import Creator"], tenantId: "acme" };
    const updateOnly = { id: "updater@example.com", roles: ["Import Updater"], tenantId: "acme" };
    const { app: createApp } = makeImportPermissionDesk(createOnly);
    const { app: updateApp } = makeImportPermissionDesk(updateOnly);

    const createList = await createApp.request("/desk/ImportPermissionNote");
    const updateList = await updateApp.request("/desk/ImportPermissionNote");

    expect(createList.status).toBe(200);
    const createHtml = await createList.text();
    expect(createHtml).toContain('action="/desk/ImportPermissionNote/import.csv"');
    expect(createHtml).toContain('<option value="create" selected>Create</option>');
    expect(createHtml).not.toContain('<option value="update"');

    expect(updateList.status).toBe(200);
    const updateHtml = await updateList.text();
    expect(updateHtml).toContain('action="/desk/ImportPermissionNote/import.csv"');
    expect(updateHtml).toContain('<option value="update" selected>Update</option>');
    expect(updateHtml).not.toContain('<option value="create"');
  });

  it("hides generated CSV import controls from read-only actors", async () => {
    const { app, services } = makeDesk(guest);
    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Readable Note" }) });

    const list = await app.request("/desk/Note");

    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain("Readable Note");
    expect(html).toContain('href="/desk/Note/export.csv"');
    expect(html).toContain("Filter");
    expect(html).not.toContain('href="/desk/Note/new"');
    expect(html).not.toContain("/desk/Note/import.csv");
    expect(html).not.toContain("/desk/Note/import-template.csv");
    expect(html).not.toContain("Import CSV");
  });

  it("rejects direct generated CSV import posts from read-only actors", async () => {
    const { app, services } = makeDesk(guest);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        csv: ["title,priority,body", "Guest Import,Medium,No write access"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain("Actor &#39;guest&#39; cannot create Note");
    await expect(services.queries.listDocuments(owner, "Note")).resolves.toMatchObject({ total: 0 });
  });

  it("imports generated list CSV posts through the document command boundary", async () => {
    const { app, services } = makeDesk(owner, {});

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        mode: "create",
        csv: ["title,priority,count,body", "Desk Import One,Medium,2,First body", "Desk Import Two,Low,5,Second body"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Imported 2 of 2 Note rows.");
    expect(html).toContain("Desk Import One");
    expect(html).toContain("Desk Import Two");
    await expect(services.queries.getDocument(owner, "Note", "Desk Import One")).resolves.toMatchObject({
      version: 1,
      data: expect.objectContaining({ count: 2, created_by: owner.id })
    });
    await expect(services.events.readStream("acme:Note:Desk%20Import%20One")).resolves.toMatchObject([
      { metadata: { method: "POST", url: "http://localhost/desk/Note/import.csv" } }
    ]);
  });

  it("preserves generated list filters and ordering after CSV imports", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "/desk/Note?default_filters=0&filter_priority=High&order_by=count&order=asc",
        csv: ["title,priority,count,body", "Desk Filtered Import,High,8,Visible", "Desk Hidden Import,Low,1,Hidden"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Imported 2 of 2 Note rows.");
    expect(html).toContain("Desk Filtered Import");
    expect(html).not.toContain("Desk Hidden Import");
    expect(html).toContain('<option value="High" selected>High</option>');
    expect(html).toContain('<option value="count" selected>count</option>');
    expect(html).toContain('<option value="asc" selected>Ascending</option>');
    expect(html).toContain("/desk/Note/export.csv?default_filters=0&amp;filter_priority=High&amp;order_by=count&amp;order=asc");
    expect(html).toContain(
      'name="returnTo" value="/desk/Note?default_filters=0&amp;filter_priority=High&amp;order_by=count&amp;order=asc"'
    );
  });

  it("rejects CSV import return targets outside the current Desk list", async () => {
    const { app, services } = makeDesk(owner);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "/desk/admin/jobs",
        csv: ["title,priority,body", "Bad Return,Medium,Blocked"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("CSV import returnTo must target the current Desk list");
    await expect(services.events.readStream("acme:Note:Bad%20Return")).resolves.toEqual([]);
  });

  it("rejects CSV import return targets on another origin", async () => {
    const { app, services } = makeDesk(owner);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "https://example.test/desk/Note?filter_priority=High",
        csv: ["title,priority,body", "Cross Origin Return,High,Blocked"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("CSV import returnTo must target the current Desk list");
    await expect(services.events.readStream("acme:Note:Cross%20Origin%20Return")).resolves.toEqual([]);
  });

  it("rejects CSV import return targets for a different Desk DocType", async () => {
    const { app, services } = makeDesk(owner);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "/desk/File?filter_name=note",
        csv: ["title,priority,body", "Wrong DocType Return,Medium,Blocked"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("CSV import returnTo must target the current Desk list");
    await expect(services.events.readStream("acme:Note:Wrong%20DocType%20Return")).resolves.toEqual([]);
  });

  it("rejects malformed CSV import return targets before writing events", async () => {
    const { app, services } = makeDesk(owner);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "http://%",
        csv: ["title,priority,body", "Malformed Return,Medium,Blocked"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("CSV import returnTo must target the current Desk list");
    await expect(services.events.readStream("acme:Note:Malformed%20Return")).resolves.toEqual([]);
  });

  it("updates generated list CSV posts through the document command boundary", async () => {
    const { app, services } = makeDesk(owner);
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Import Target", priority: "Low", count: 1 })
    });

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        mode: "update",
        csv: ["name,expectedVersion,priority,count,body", "Desk Import Target,1,High,4,Updated by import"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Imported 1 of 1 Note rows.");
    expect(html).toContain('<option value="update" selected>Update</option>');
    await expect(services.queries.getDocument(owner, "Note", "Desk Import Target")).resolves.toMatchObject({
      version: 2,
      data: expect.objectContaining({ priority: "High", count: 4, body: "Updated by import" })
    });
    await expect(services.events.readStream("acme:Note:Desk%20Import%20Target")).resolves.toMatchObject([
      expect.anything(),
      { metadata: { method: "POST", url: "http://localhost/desk/Note/import.csv" } }
    ]);
  });

  it("reports generated list CSV import failures while preserving successful rows", async () => {
    const { app, services } = makeDesk(owner);

    const response = await app.request("/desk/Note/import.csv", {
      method: "POST",
      body: new URLSearchParams({
        csv: ["title,priority,body", "No,Medium,Too short", "Desk Partial Import,Medium,Created"].join("\n")
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Imported 1 of 2 Note rows.");
    expect(html).toContain("Row 2");
    expect(html).toContain("Validation failed");
    expect(html).toContain("Desk Partial Import");
    await expect(services.queries.getDocument(owner, "Note", "Desk Partial Import")).resolves.toMatchObject({
      version: 1
    });
    await expect(services.queries.getDocument(owner, "Note", "No")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
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
    expect(createHtml).not.toContain("data-document-status=");
    expect(createHtml).not.toContain("data-document-version=");

    const update = await app.request(`/desk/Note/${encodeURIComponent(document.name)}`);
    expect(update.status).toBe(200);
    const updateHtml = await update.text();
    expect(updateHtml).toContain('src="/assets/note-&quot;&lt;form&gt;.js"');
    expect(updateHtml).toContain('data-cf-frappe-script="note-&quot;&lt;form&gt;"');
    expect(updateHtml).toContain('data-document-name="Script &quot; &lt;Note&gt;"');
    expect(updateHtml).toContain('data-document-status="draft"');
    expect(updateHtml).toContain('data-document-version="1"');
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
    expect(html).toContain('data-document-status="draft"');
    expect(html).toContain('data-document-version="1"');
    expect(html).toContain('data-realtime-route="/api/realtime"');
    expect(html).toContain('data-tenant-id="acme"');
    expect(html).toContain("Checking active collaborators.");
    expect(html).toContain("Viewing latest saved version.");
    expect(html).toContain("No shared draft proposals.");
    expect(html).toContain('data-cf-frappe-merge-save hidden');
    expect(html).toContain('data-cf-frappe-apply-shared-draft hidden');

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
    expect(source).toContain("audit: Object.freeze");
    expect(source).toContain("auth: Object.freeze");
    expect(source).toContain("customFields: Object.freeze");
    expect(source).toContain("dataPatches: Object.freeze");
    expect(source).toContain("form: Object.freeze");
    expect(source).toContain("files: Object.freeze");
    expect(source).toContain("jobs: Object.freeze");
    expect(source).toContain("notifications: Object.freeze");
    expect(source).toContain("notificationRules: Object.freeze");
    expect(source).toContain("assignmentRules: Object.freeze");
    expect(source).toContain("print: Object.freeze");
    expect(source).toContain("profiles: Object.freeze");
    expect(source).toContain("reportBuilder: Object.freeze");
    expect(source).toContain("roles: Object.freeze");
    expect(source).toContain("userPermissions: Object.freeze");
    expect(source).toContain("documentTopic(tenantId, doctype, name)");
    expect(source).toContain("userTopic(tenantId, userId)");
    expect(source).toContain("resourcePath(doctype, name) + \"/transition/\"");
    expect(source).toContain("resourcePath(doctype) + \"/bulk-transition/\"");
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
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Empty Body", priority: "Low", body: "", count: 4 })
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
    expect(html).toContain("/desk/Note/export.csv?filter_priority=High");

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

    const compoundExpression = encodeURIComponent(JSON.stringify({
      kind: "group",
      match: "any",
      filters: [
        { field: "priority", value: "High" },
        { field: "count", operator: "between", value: [1, 1] }
      ]
    }));
    const compound = await app.request(`/desk/Note?default_filters=0&filter_expression=${compoundExpression}`);
    expect(compound.status).toBe(200);
    const compoundHtml = await compound.text();
    expect(compoundHtml).toContain("Desk High");
    expect(compoundHtml).toContain("Desk Closed High");
    expect(compoundHtml).toContain("Desk Low");
    expect(compoundHtml).not.toContain("Desk Empty Body");
    expect(compoundHtml).toContain('name="filter_expression"');
    expect(compoundHtml).toContain("data-cf-frappe-compound-filter-builder");
    expect(compoundHtml).toContain("data-cf-frappe-filter-row");
    expect(compoundHtml).toContain('data-cf-frappe-filter-field><option value=""></option><option value="title">title</option><option value="priority" selected>priority</option>');
    expect(compoundHtml).toContain('data-cf-frappe-filter-operator><option value="eq" selected>equals</option>');
    expect(compoundHtml).toContain('data-cf-frappe-filter-value type="text" value="High"');
    expect(compoundHtml).toContain('<option value="count" selected>count</option>');
    expect(compoundHtml).toContain('<option value="between" selected>between</option>');
    expect(compoundHtml).toContain('<option value="not_between">not between</option>');
    expect(compoundHtml).toContain('data-cf-frappe-filter-value type="text" value="1, 1"');
    expect(compoundHtml).toContain('data-cf-frappe-add-filter>Add condition</button>');
    expect(compoundHtml).toContain('data-cf-frappe-filter-match><option value="all">All</option><option value="any" selected>Any</option>');
    expect(compoundHtml).toContain("&quot;match&quot;: &quot;any&quot;");
    expect(compoundHtml).toContain("<strong>Any</strong>");
    expect(compoundHtml).toContain("priority eq High");
    expect(compoundHtml).toContain("/desk/Note/export.csv?default_filters=0&amp;filter_expression=");

    const nestedCompoundExpression = encodeURIComponent(JSON.stringify({
      kind: "group",
      match: "all",
      filters: [
        { field: "priority", value: "High" },
        {
          kind: "group",
          match: "any",
          filters: [
            { field: "count", operator: "between", value: [1, 1] },
            { field: "priority", operator: "ne", value: "Low" }
          ]
        }
      ]
    }));
    const nestedCompound = await app.request(`/desk/Note?default_filters=0&filter_expression=${nestedCompoundExpression}`);
    expect(nestedCompound.status).toBe(200);
    const nestedCompoundHtml = await nestedCompound.text();
    const nestedCompoundVisualHtml = nestedCompoundHtml.split("<template")[0] ?? nestedCompoundHtml;
    expect(nestedCompoundVisualHtml.match(/data-cf-frappe-filter-group>/g)?.length).toBe(2);
    expect(nestedCompoundVisualHtml).toContain("data-cf-frappe-add-filter-group>Add group</button>");
    expect(nestedCompoundVisualHtml).toContain("data-cf-frappe-remove-filter-group>Remove group</button>");
    expect(nestedCompoundVisualHtml).toContain('data-cf-frappe-filter-match><option value="all">All</option><option value="any" selected>Any</option>');
    expect(nestedCompoundVisualHtml).toContain('<option value="priority" selected>priority</option>');
    expect(nestedCompoundVisualHtml).toContain('<option value="ne" selected>is not</option>');
    expect(nestedCompoundVisualHtml).toContain('data-cf-frappe-filter-value type="text" value="Low"');
    expect(nestedCompoundHtml).toContain("<strong>Any</strong>");

    const between = await app.request("/desk/Note?filter_count__between=6&filter_count__between=8");
    expect(between.status).toBe(200);
    const betweenHtml = await between.text();
    expect(betweenHtml).toContain("Desk High");
    expect(betweenHtml).not.toContain("Desk Low");
    expect(betweenHtml).not.toContain("Desk Closed High");

    const notBetween = await app.request("/desk/Note?filter_count__not_between=2&filter_count__not_between=6");
    expect(notBetween.status).toBe(200);
    const notBetweenHtml = await notBetween.text();
    expect(notBetweenHtml).toContain("Desk High");
    expect(notBetweenHtml).toContain("Desk Low");
    expect(notBetweenHtml).not.toContain("Desk Empty Body");
    expect(notBetweenHtml).not.toContain("Desk Closed High");

    const like = await app.request("/desk/Note?filter_body__like=Hidden%25");
    expect(like.status).toBe(200);
    const likeHtml = await like.text();
    expect(likeHtml).toContain("Desk High");
    expect(likeHtml).not.toContain("Desk Low");
    expect(likeHtml).not.toContain("Desk Closed High");

    const notLike = await app.request("/desk/Note?filter_priority=High&filter_body__not_like=%25Routine%25");
    expect(notLike.status).toBe(200);
    const notLikeHtml = await notLike.text();
    expect(notLikeHtml).toContain("Desk High");
    expect(notLikeHtml).not.toContain("Desk Low");
    expect(notLikeHtml).not.toContain("Desk Closed High");

    const set = await app.request("/desk/Note?filter_body__is=set");
    expect(set.status).toBe(200);
    const setHtml = await set.text();
    expect(setHtml).toContain("Desk High");
    expect(setHtml).toContain("Desk Low");
    expect(setHtml).toContain("Desk Empty Body");
    expect(setHtml).not.toContain("Desk Closed High");

    const membership = await app.request("/desk/Note?filter_priority__in=High&filter_priority__in=Low");
    expect(membership.status).toBe(200);
    const membershipHtml = await membership.text();
    expect(membershipHtml).toContain("Desk High");
    expect(membershipHtml).toContain("Desk Low");
    expect(membershipHtml).toContain("Desk Empty Body");
    expect(membershipHtml).not.toContain("Desk Closed High");

    const byName = await app.request("/desk/Note?filter_system.name__contains=High");
    expect(byName.status).toBe(200);
    const byNameHtml = await byName.text();
    expect(byNameHtml).toContain("Desk High");
    expect(byNameHtml).not.toContain("Desk Low");
    expect(byNameHtml).not.toContain("Desk Closed High");

    const ordered = await app.request("/desk/Note?default_filters=0&order_by=count&order=asc");
    expect(ordered.status).toBe(200);
    const orderedHtml = await ordered.text();
    expect(orderedHtml).toContain('<select id="list-order-by" name="order_by">');
    expect(orderedHtml).toContain('<option value="count" selected>count</option>');
    expect(orderedHtml).toContain('<select id="list-order" name="order">');
    expect(orderedHtml).toContain('<option value="asc" selected>Ascending</option>');
    expect(orderedHtml).toContain("/desk/Note/export.csv?default_filters=0&amp;order_by=count&amp;order=asc");
    expect(orderedHtml.indexOf("Desk Low")).toBeLessThan(orderedHtml.indexOf("Desk Closed High"));
    expect(orderedHtml.indexOf("Desk Closed High")).toBeLessThan(orderedHtml.indexOf("Desk High"));

    const csv = await app.request("/desk/Note/export.csv?default_filters=0&order_by=count&order=asc");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Note.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("4");
    await expect(csv.text()).resolves.toBe([
      "Name,title,priority,workflow_state,Version,Updated",
      "Desk Low,Desk Low,Low,Open,1,2026-01-01T00:00:00.000Z",
      "Desk Closed High,Desk Closed High,High,Closed,1,2026-01-01T00:00:00.000Z",
      "Desk Empty Body,Desk Empty Body,Low,Open,1,2026-01-01T00:00:00.000Z",
      "Desk High,Desk High,High,Open,1,2026-01-01T00:00:00.000Z"
    ].join("\n"));

    const emptyCsv = await app.request("/desk/Note/export.csv?default_filters=0&filter_body=&empty_filter=filter_body");
    expect(emptyCsv.status).toBe(200);
    expect(emptyCsv.headers.get("x-cf-frappe-export-total")).toBe("1");
    await expect(emptyCsv.text()).resolves.toBe([
      "Name,title,priority,workflow_state,Version,Updated",
      "Desk Empty Body,Desk Empty Body,Low,Open,1,2026-01-01T00:00:00.000Z"
    ].join("\n"));
  });

  it("rejects over-deep Desk compound list filter expressions without overflowing the parser", async () => {
    const { app } = makeDesk();
    const expression = encodeURIComponent(deepListFilterExpressionJson(6000));

    const response = await app.request(`/desk/Note?filter_expression=${expression}`);

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("List filter expression cannot exceed 5 levels");
  });

  it("lists Desk resources with presence filters for missing fields", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: { title: "Desk Body Set", priority: "High", body: "Visible" }
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: { title: "Desk Body Missing", priority: "Medium" }
    });

    const response = await app.request("/desk/Note?filter_body__is=not+set");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Desk Body Missing");
    expect(html).not.toContain("Desk Body Set");
  });

  it("keeps Desk equality filters for fields ending with operator suffixes", async () => {
    const { app, documents } = makeFilterCollisionDesk();
    await documents.create({
      actor: owner,
      doctype: "FilterCollision",
      data: {
        title: "Desk Collision Match",
        count__between: 7,
        count__not_between: 7,
        body__is: "literal",
        title__like: "literal"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "FilterCollision",
      data: {
        title: "Desk Collision Miss",
        count__between: 3,
        count__not_between: 3,
        body__is: "other",
        title__like: "other"
      }
    });

    const response = await app.request("/desk/FilterCollision?filter_count__between=7");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Desk Collision Match");
    expect(html).not.toContain("Desk Collision Miss");

    const notBetweenCollision = await app.request("/desk/FilterCollision?filter_count__not_between=7");
    expect(notBetweenCollision.status).toBe(200);
    const notBetweenCollisionHtml = await notBetweenCollision.text();
    expect(notBetweenCollisionHtml).toContain("Desk Collision Match");
    expect(notBetweenCollisionHtml).not.toContain("Desk Collision Miss");

    const presenceCollision = await app.request("/desk/FilterCollision?filter_body__is=literal");
    expect(presenceCollision.status).toBe(200);
    const presenceCollisionHtml = await presenceCollision.text();
    expect(presenceCollisionHtml).toContain("Desk Collision Match");
    expect(presenceCollisionHtml).not.toContain("Desk Collision Miss");

    const patternCollision = await app.request("/desk/FilterCollision?filter_title__like=literal");
    expect(patternCollision.status).toBe(200);
    const patternCollisionHtml = await patternCollision.text();
    expect(patternCollisionHtml).toContain("Desk Collision Match");
    expect(patternCollisionHtml).not.toContain("Desk Collision Miss");
  });

  it("renders and submits generated list bulk document deletes", async () => {
    const { app, services } = makeDesk(manager);
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Selected", priority: "High" })
    });
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Keep", priority: "Low" })
    });

    const list = await app.request("/desk/Note?default_filters=0&filter_priority=High&order_by=title&order=asc");

    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain('formaction="/desk/Note/bulk-delete"');
    expect(html).toContain(
      'name="returnTo" value="/desk/Note?default_filters=0&amp;filter_priority=High&amp;order_by=title&amp;order=asc"'
    );
    expect(html).toContain('name="document" type="checkbox" value="Desk Bulk Selected"');
    expect(html).toContain('name="expectedVersion:Desk Bulk Selected" type="hidden" value="1"');

    const deleted = await app.request("/desk/Note/bulk-delete", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "/desk/Note?default_filters=0&filter_priority=High&order_by=title&order=asc",
        document: "Desk Bulk Selected",
        "expectedVersion:Desk Bulk Selected": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe(
      "/desk/Note?default_filters=0&filter_priority=High&order_by=title&order=asc"
    );

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

  it("rejects generated list bulk action return targets outside the current Desk list", async () => {
    const { app, services } = makeDesk(manager);
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Bad Return" })
    });

    const response = await app.request("/desk/Note/bulk-delete", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "/desk/admin/jobs",
        document: "Desk Bulk Bad Return",
        "expectedVersion:Desk Bulk Bad Return": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Desk bulk action returnTo must target the current Desk list");
    await expect(services.queries.getDocument(manager, "Note", "Desk Bulk Bad Return")).resolves.toMatchObject({
      docstatus: "draft"
    });
  });

  it("rejects malformed generated list bulk action return targets before deleting documents", async () => {
    const { app, services } = makeDesk(manager);
    await services.documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Desk Bulk Malformed Return" })
    });

    const response = await app.request("/desk/Note/bulk-delete", {
      method: "POST",
      body: new URLSearchParams({
        returnTo: "http://%",
        document: "Desk Bulk Malformed Return",
        "expectedVersion:Desk Bulk Malformed Return": "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Desk bulk action returnTo must target the current Desk list");
    await expect(services.queries.getDocument(manager, "Note", "Desk Bulk Malformed Return")).resolves.toMatchObject({
      docstatus: "draft"
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
      body: new URLSearchParams({
        saved_filter_label: "High notes",
        filter_expression: JSON.stringify({
          kind: "group",
          match: "any",
          filters: [{ field: "priority", value: "High" }]
        })
      }),
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
    expect(html).toContain("<strong>Any</strong>");
    expect(html).toContain("/desk/Note/saved-filters/");
    expect(html).toContain("/delete");

    const id = new URL(`http://localhost${location}`).searchParams.get("saved_filter");
    const deleted = await app.request(`/desk/Note/saved-filters/${id}/delete`, { method: "POST" });

    expect(deleted.status).toBe(303);
    await expect(services.savedFilters.list(owner, "Note")).resolves.toEqual([]);
  });

  it("uses the saved-list-filter policy error for Desk saved-filter routes when saved filters are disabled", async () => {
    const { app } = makeDesk(owner, { savedFilters: false });

    const save = await app.request("/desk/Note/saved-filters", {
      method: "POST",
      body: new URLSearchParams({ saved_filter_label: "High notes" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(save.status).toBe(404);
    await expect(save.text()).resolves.toContain("Saved filters are not enabled");

    const deleted = await app.request("/desk/Note/saved-filters/filter-1/delete", { method: "POST" });
    expect(deleted.status).toBe(404);
    await expect(deleted.text()).resolves.toContain("Saved filters are not enabled");
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
    expect(emptyHtml).toContain('name="description"');
    expect(emptyHtml).toContain('name="placeholder"');
    expect(emptyHtml).toContain('name="mandatoryDependsOn"');
    expect(emptyHtml).toContain('name="readOnlyDependsOn"');
    expect(emptyHtml).toContain('name="hiddenDependsOn"');
    expect(emptyHtml).toContain('name="printHide"');
    expect(emptyHtml).toContain('name="printHideIfNoValue"');
    expect(emptyHtml).toContain('name="fetchFrom"');
    expect(emptyHtml).toContain('name="fetchIfEmpty"');
    expect(emptyHtml).toContain('name="defaultValue"');
    expect(emptyHtml).toContain("No custom fields configured.");

    const created = await app.request("/desk/admin/custom-fields", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "reviewed",
        label: "Reviewed",
        description: "Visible after quality review.",
        placeholder: "Reviewed by QA",
        type: "boolean",
        mandatoryDependsOn: JSON.stringify({ field: "priority", value: "High" }),
        readOnlyDependsOn: JSON.stringify({ field: "priority", value: "Low" }),
        hiddenDependsOn: JSON.stringify({ field: "priority", operator: "is", value: "not set" }),
        printHide: "1",
        printHideIfNoValue: "1",
        unique: "1",
        noCopy: "1",
        allowOnSubmit: "1",
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
      fields: [
        {
          field: {
            name: "reviewed",
            label: "Reviewed",
            description: "Visible after quality review.",
            placeholder: "Reviewed by QA",
            type: "boolean",
            mandatoryDependsOn: { field: "priority", value: "High" },
            readOnlyDependsOn: { field: "priority", value: "Low" },
            hiddenDependsOn: { field: "priority", operator: "is", value: "not set" },
            printHide: true,
            printHideIfNoValue: true,
            unique: true,
            noCopy: true,
            allowOnSubmit: true,
            defaultValue: false
          },
          enabled: true
        }
      ]
    });

    const current = await app.request("/desk/admin/custom-fields?doctype=Note");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("reviewed");
    expect(currentHtml).toContain("Reviewed");
    expect(currentHtml).toContain("description: Visible after quality review.");
    expect(currentHtml).toContain("placeholder: Reviewed by QA");
    expect(currentHtml).toContain("mandatory depends on");
    expect(currentHtml).toContain("read only depends on");
    expect(currentHtml).toContain("hidden depends on");
    expect(currentHtml).toContain("print hide");
    expect(currentHtml).toContain("print hide if empty");
    expect(currentHtml).toContain("unique");
    expect(currentHtml).toContain("no copy");
    expect(currentHtml).toContain("allow on submit");
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

  it("renders and mutates workflow definitions from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"] };
    const { app, services } = makeWorkflowDesk(admin);

    const empty = await app.request("/desk/admin/workflows?doctype=Note");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Workflows");
    expect(emptyHtml).toContain('name="stateField" value="workflow_state"');
    expect(emptyHtml).toContain("No workflow override configured.");

    const created = await app.request("/desk/admin/workflows", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        stateField: "workflow_state",
        initialState: "Open",
        states: "Open\nClosed",
        transitions: "approve | Open | Closed | User | NoteApproved",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/workflows?doctype=Note");
    await expect(services.workflows.list(admin, "Note")).resolves.toMatchObject({
      version: 1,
      workflow: {
        initialState: "Open",
        states: ["Open", "Closed"],
        transitions: [{ action: "approve", from: "Open", to: "Closed", roles: ["User"], eventType: "NoteApproved" }]
      }
    });

    const current = await app.request("/desk/admin/workflows?doctype=Note");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("approve");
    expect(currentHtml).toContain("NoteApproved");
    expect(currentHtml).toContain('formaction="/desk/admin/workflows/Note/clear"');
    expect(currentHtml).toContain('name="expectedVersion" value="1"');

    const stale = await app.request("/desk/admin/workflows", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        initialState: "Open",
        states: "Open\nClosed",
        transitions: "review | Open | Closed",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected workflow definitions at version 0, found 1");
    expect(staleHtml).toContain("approve");

    const cleared = await app.request("/desk/admin/workflows/Note/clear", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(cleared.status).toBe(303);
    await expect(services.workflows.list(admin, "Note")).resolves.toMatchObject({ version: 2 });
    expect((await services.workflows.list(admin, "Note")).workflow).toBeUndefined();
  });

  it("renders and mutates notification rules from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const notificationRules = new NotificationRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["notification-rule-event-1", "notification-rule-event-2", "notification-rule-event-3"])
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notificationRules,
      actor: () => admin
    });

    const empty = await app.request("/desk/admin/notification-rules?doctype=Note");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Notification Rules");
    expect(emptyHtml).toContain('action="/desk/admin/notification-rules"');
    expect(emptyHtml).toContain('name="expectedVersion" value="0"');
    expect(emptyHtml).toContain("No notification rules configured.");

    const saved = await app.request("/desk/admin/notification-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Managers on changes",
        events: "DocumentUpdated\nDocumentCommentAdded",
        recipients: "field:created_by",
        channels: "inbox",
        condition: "{\"field\":\"priority\",\"value\":\"High\"}",
        subject: "{{ actor }} updated {{ doctype }} {{ name }}",
        enabled: "true",
        excludeActor: "false",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(
      "/desk/admin/notification-rules?doctype=Note&rule=Managers%20on%20changes"
    );
    await expect(notificationRules.list(admin, "Note")).resolves.toMatchObject({
      version: 1,
      rules: [
        {
          rule: {
            name: "Managers on changes",
            events: ["DocumentUpdated", "DocumentCommentAdded"],
            recipients: [{ kind: "field", field: "created_by" }],
            channels: ["inbox"],
            condition: { field: "priority", value: "High" },
            excludeActor: false
          }
        }
      ]
    });

    const current = await app.request("/desk/admin/notification-rules?doctype=Note");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("Managers on changes");
    expect(currentHtml).toContain("DocumentCommentAdded");
    expect(currentHtml).toContain("field:created_by");
    expect(currentHtml).toContain(
      'href="/desk/admin/notification-rules?doctype=Note&amp;rule=Managers%20on%20changes"'
    );
    expect(currentHtml).toContain('action="/desk/admin/notification-rules/Note/Managers%20on%20changes/clear"');
    expect(currentHtml).toContain('name="expectedVersion" value="1"');

    const edit = await app.request("/desk/admin/notification-rules?doctype=Note&rule=Managers%20on%20changes");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain("Edit Notification Rule");
    expect(editHtml).toContain('name="name" value="Managers on changes"');
    expect(editHtml).toContain("<textarea name=\"events\">DocumentUpdated\nDocumentCommentAdded</textarea>");
    expect(editHtml).toContain("<textarea name=\"recipients\">field:created_by</textarea>");
    expect(editHtml).toContain('name="channels" value="inbox"');
    expect(editHtml).toContain("&quot;field&quot;: &quot;priority&quot;");
    expect(editHtml).toContain('name="subject" value="{{ actor }} updated {{ doctype }} {{ name }}"');
    expect(editHtml).toContain('<option value="false" selected>No</option>');

    const updated = await app.request("/desk/admin/notification-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Managers on changes",
        events: "DocumentAssigned",
        recipients: "documentOwner",
        channels: "inbox,email",
        condition: "{\"field\":\"system.docstatus\",\"value\":\"draft\"}",
        subject: "Assignment changed",
        enabled: "false",
        excludeActor: "true",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(updated.status).toBe(303);
    expect(updated.headers.get("location")).toBe(
      "/desk/admin/notification-rules?doctype=Note&rule=Managers%20on%20changes"
    );
    await expect(notificationRules.list(admin, "Note")).resolves.toMatchObject({
      version: 2,
      rules: [
        {
          enabled: false,
          rule: {
            name: "Managers on changes",
            events: ["DocumentAssigned"],
            recipients: [{ kind: "documentOwner" }],
            channels: ["inbox", "email"],
            condition: { field: "system.docstatus", value: "draft" },
            subject: "Assignment changed",
            enabled: false,
            excludeActor: true
          }
        }
      ]
    });

    const stale = await app.request("/desk/admin/notification-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Stale",
        events: "DocumentUpdated",
        recipients: "documentOwner",
        channels: "inbox",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected notification rules at version 1, found 2");
    expect(staleHtml).toContain("Managers on changes");

    const malformedRecipient = await app.request("/desk/admin/notification-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Bad recipient",
        events: "DocumentUpdated",
        recipients: "bad",
        channels: "inbox",
        expectedVersion: "2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(malformedRecipient.status).toBe(400);
    const malformedHtml = await malformedRecipient.text();
    expect(malformedHtml).toContain(
      "Notification rule recipients must use field:&lt;field&gt;, user:&lt;user&gt;, or documentOwner"
    );
    expect(malformedHtml).toContain("Managers on changes");

    const malformedCondition = await app.request("/desk/admin/notification-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Bad condition",
        events: "DocumentUpdated",
        recipients: "documentOwner",
        channels: "inbox",
        condition: "[]",
        expectedVersion: "2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(malformedCondition.status).toBe(400);
    await expect(malformedCondition.text()).resolves.toContain("Notification rule condition must be a JSON object");

    const cleared = await app.request("/desk/admin/notification-rules/Note/Managers%20on%20changes/clear", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(cleared.status).toBe(303);
    expect(cleared.headers.get("location")).toBe("/desk/admin/notification-rules?doctype=Note");
    await expect(notificationRules.list(admin, "Note")).resolves.toMatchObject({ version: 3, rules: [] });

    const disabled = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => admin
    });
    const missing = await disabled.request("/desk/admin/notification-rules");
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain("Notification rules are not enabled");
  });

  it("round-trips sparse notification rules without materializing default fields", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const notificationRules = new NotificationRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["notification-rule-event-1", "notification-rule-event-2"])
    });
    await notificationRules.save({
      actor: admin,
      doctype: "Note",
      expectedVersion: 0,
      rule: {
        name: "Sparse",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }]
      }
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notificationRules,
      actor: () => admin
    });

    const edit = await app.request("/desk/admin/notification-rules?doctype=Note&rule=Sparse");
    expect(edit.status).toBe(200);
    const html = await edit.text();
    expect(html).toContain('name="channels" value="" placeholder="inbox"');
    expect(html).toContain('<option value="" selected>Default</option>');
    expect(html).toContain("<textarea name=\"condition\" rows=\"5\"></textarea>");
    expect(html).not.toContain('name="channels" value="inbox"');

    const unchanged = await app.request("/desk/admin/notification-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Sparse",
        events: "DocumentUpdated",
        recipients: "user:manager@example.com",
        channels: "",
        condition: "",
        subject: "",
        enabled: "",
        excludeActor: "",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(unchanged.status).toBe(303);
    await expect(notificationRules.list(admin, "Note")).resolves.toEqual({
      tenantId: "acme",
      doctypeName: "Note",
      version: 1,
      rules: [
        expect.objectContaining({
          rule: {
            name: "Sparse",
            events: ["DocumentUpdated"],
            recipients: [{ kind: "user", userId: "manager@example.com" }]
          }
        })
      ]
    });
  });

  it("toggles notification rules from Desk row actions", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const notificationRules = new NotificationRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["notification-rule-event-1", "notification-rule-event-2", "notification-rule-event-3"])
    });
    await notificationRules.save({
      actor: admin,
      doctype: "Note",
      expectedVersion: 0,
      rule: {
        name: "Escalations",
        enabled: false,
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }],
        channels: ["inbox"],
        condition: { field: "priority", value: "High" }
      }
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notificationRules,
      actor: () => admin
    });

    const disabledPage = await app.request("/desk/admin/notification-rules?doctype=Note");
    expect(disabledPage.status).toBe(200);
    await expect(disabledPage.text()).resolves.toContain(
      'action="/desk/admin/notification-rules/Note/Escalations/enable"'
    );

    const enabled = await app.request("/desk/admin/notification-rules/Note/Escalations/enable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(enabled.status).toBe(303);
    expect(enabled.headers.get("location")).toBe("/desk/admin/notification-rules?doctype=Note&rule=Escalations");
    await expect(notificationRules.list(admin, "Note")).resolves.toMatchObject({
      version: 2,
      rules: [
        {
          enabled: true,
          rule: { name: "Escalations", enabled: true, condition: { field: "priority", value: "High" } }
        }
      ]
    });

    const enabledPage = await app.request("/desk/admin/notification-rules?doctype=Note");
    expect(enabledPage.status).toBe(200);
    await expect(enabledPage.text()).resolves.toContain(
      'action="/desk/admin/notification-rules/Note/Escalations/disable"'
    );

    const disabled = await app.request("/desk/admin/notification-rules/Note/Escalations/disable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(disabled.status).toBe(303);
    await expect(notificationRules.list(admin, "Note")).resolves.toMatchObject({
      version: 3,
      rules: [
        {
          enabled: false,
          rule: { name: "Escalations", enabled: false, condition: { field: "priority", value: "High" } }
        }
      ]
    });
  });

  it("returns notification rule version conflicts before missing-rule errors on stale row actions", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const notificationRules = new NotificationRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["notification-rule-event-1", "notification-rule-event-2"])
    });
    await notificationRules.save({
      actor: admin,
      doctype: "Note",
      expectedVersion: 0,
      rule: {
        name: "Stale toggle",
        enabled: false,
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }]
      }
    });
    await notificationRules.clear({
      actor: admin,
      doctype: "Note",
      ruleName: "Stale toggle",
      expectedVersion: 1
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notificationRules,
      actor: () => admin
    });

    const stale = await app.request("/desk/admin/notification-rules/Note/Stale%20toggle/enable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(stale.status).toBe(409);
    await expect(stale.text()).resolves.toContain("Expected notification rules at version 1, found 2");
  });

  it("renders and mutates assignment rules from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const assignmentRules = new AssignmentRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["assignment-rule-event-1", "assignment-rule-event-2", "assignment-rule-event-3"])
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      assignmentRules,
      actor: () => admin
    });

    const empty = await app.request("/desk/admin/assignment-rules?doctype=Note");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Assignment Rules");
    expect(emptyHtml).toContain('action="/desk/admin/assignment-rules"');
    expect(emptyHtml).toContain('name="expectedVersion" value="0"');
    expect(emptyHtml).toContain("No assignment rules configured.");

    const saved = await app.request("/desk/admin/assignment-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "High priority triage",
        events: "DocumentCreated\nDocumentUpdated",
        assignees: "field:created_by\nuser:manager@example.com",
        condition: "{\"field\":\"priority\",\"value\":\"High\"}",
        enabled: "true",
        excludeActor: "false",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(
      "/desk/admin/assignment-rules?doctype=Note&rule=High%20priority%20triage"
    );
    await expect(assignmentRules.list(admin, "Note")).resolves.toMatchObject({
      version: 1,
      rules: [
        {
          rule: {
            name: "High priority triage",
            events: ["DocumentCreated", "DocumentUpdated"],
            assignees: [
              { kind: "field", field: "created_by" },
              { kind: "user", userId: "manager@example.com" }
            ],
            condition: { field: "priority", value: "High" },
            excludeActor: false
          }
        }
      ]
    });

    const current = await app.request("/desk/admin/assignment-rules?doctype=Note");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("High priority triage");
    expect(currentHtml).toContain("DocumentUpdated");
    expect(currentHtml).toContain("field:created_by");
    expect(currentHtml).toContain("user:manager@example.com");
    expect(currentHtml).toContain(
      'href="/desk/admin/assignment-rules?doctype=Note&amp;rule=High%20priority%20triage"'
    );
    expect(currentHtml).toContain('action="/desk/admin/assignment-rules/Note/High%20priority%20triage/clear"');
    expect(currentHtml).toContain('name="expectedVersion" value="1"');

    const edit = await app.request("/desk/admin/assignment-rules?doctype=Note&rule=High%20priority%20triage");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain("Edit Assignment Rule");
    expect(editHtml).toContain('name="name" value="High priority triage"');
    expect(editHtml).toContain("<textarea name=\"events\">DocumentCreated\nDocumentUpdated</textarea>");
    expect(editHtml).toContain("<textarea name=\"assignees\">field:created_by\nuser:manager@example.com</textarea>");
    expect(editHtml).toContain("&quot;field&quot;: &quot;priority&quot;");
    expect(editHtml).toContain('<option value="false" selected>No</option>');

    const updated = await app.request("/desk/admin/assignment-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "High priority triage",
        events: "DocumentSubmitted",
        assignees: "user:manager@example.com",
        condition: "{\"field\":\"system.docstatus\",\"value\":\"draft\"}",
        enabled: "false",
        excludeActor: "true",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(updated.status).toBe(303);
    expect(updated.headers.get("location")).toBe(
      "/desk/admin/assignment-rules?doctype=Note&rule=High%20priority%20triage"
    );
    await expect(assignmentRules.list(admin, "Note")).resolves.toMatchObject({
      version: 2,
      rules: [
        {
          enabled: false,
          rule: {
            name: "High priority triage",
            events: ["DocumentSubmitted"],
            assignees: [{ kind: "user", userId: "manager@example.com" }],
            condition: { field: "system.docstatus", value: "draft" },
            enabled: false,
            excludeActor: true
          }
        }
      ]
    });

    const stale = await app.request("/desk/admin/assignment-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Stale",
        events: "DocumentUpdated",
        assignees: "user:manager@example.com",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected assignment rules at version 1, found 2");
    expect(staleHtml).toContain("High priority triage");

    const malformedAssignee = await app.request("/desk/admin/assignment-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Bad assignee",
        events: "DocumentUpdated",
        assignees: "bad",
        expectedVersion: "2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(malformedAssignee.status).toBe(400);
    const malformedHtml = await malformedAssignee.text();
    expect(malformedHtml).toContain("Assignment rule assignees must use field:&lt;field&gt; or user:&lt;user&gt;");
    expect(malformedHtml).toContain("High priority triage");

    const malformedCondition = await app.request("/desk/admin/assignment-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Bad condition",
        events: "DocumentUpdated",
        assignees: "user:manager@example.com",
        condition: "[]",
        expectedVersion: "2"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(malformedCondition.status).toBe(400);
    await expect(malformedCondition.text()).resolves.toContain("Assignment rule condition must be a JSON object");

    const cleared = await app.request("/desk/admin/assignment-rules/Note/High%20priority%20triage/clear", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(cleared.status).toBe(303);
    expect(cleared.headers.get("location")).toBe("/desk/admin/assignment-rules?doctype=Note");
    await expect(assignmentRules.list(admin, "Note")).resolves.toMatchObject({ version: 3, rules: [] });

    const disabled = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => admin
    });
    const missing = await disabled.request("/desk/admin/assignment-rules");
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain("Assignment rules are not enabled");
  });

  it("round-trips sparse assignment rules without materializing default fields", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const assignmentRules = new AssignmentRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["assignment-rule-event-1", "assignment-rule-event-2"])
    });
    await assignmentRules.save({
      actor: admin,
      doctype: "Note",
      expectedVersion: 0,
      rule: {
        name: "Sparse",
        events: ["DocumentUpdated"],
        assignees: [{ kind: "user", userId: "manager@example.com" }]
      }
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      assignmentRules,
      actor: () => admin
    });

    const edit = await app.request("/desk/admin/assignment-rules?doctype=Note&rule=Sparse");
    expect(edit.status).toBe(200);
    const html = await edit.text();
    expect(html).toContain('<option value="" selected>Default</option>');
    expect(html).toContain("<textarea name=\"condition\" rows=\"5\"></textarea>");

    const unchanged = await app.request("/desk/admin/assignment-rules", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        name: "Sparse",
        events: "DocumentUpdated",
        assignees: "user:manager@example.com",
        condition: "",
        enabled: "",
        excludeActor: "",
        expectedVersion: "1"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(unchanged.status).toBe(303);
    await expect(assignmentRules.list(admin, "Note")).resolves.toEqual({
      tenantId: "acme",
      doctypeName: "Note",
      version: 1,
      rules: [
        expect.objectContaining({
          rule: {
            name: "Sparse",
            events: ["DocumentUpdated"],
            assignees: [{ kind: "user", userId: "manager@example.com" }]
          }
        })
      ]
    });
  });

  it("toggles assignment rules from Desk row actions", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const assignmentRules = new AssignmentRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["assignment-rule-event-1", "assignment-rule-event-2", "assignment-rule-event-3"])
    });
    await assignmentRules.save({
      actor: admin,
      doctype: "Note",
      expectedVersion: 0,
      rule: {
        name: "Escalations",
        enabled: false,
        events: ["DocumentUpdated"],
        assignees: [{ kind: "user", userId: "manager@example.com" }],
        condition: { field: "priority", value: "High" }
      }
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      assignmentRules,
      actor: () => admin
    });

    const disabledPage = await app.request("/desk/admin/assignment-rules?doctype=Note");
    expect(disabledPage.status).toBe(200);
    await expect(disabledPage.text()).resolves.toContain(
      'action="/desk/admin/assignment-rules/Note/Escalations/enable"'
    );

    const enabled = await app.request("/desk/admin/assignment-rules/Note/Escalations/enable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(enabled.status).toBe(303);
    expect(enabled.headers.get("location")).toBe("/desk/admin/assignment-rules?doctype=Note&rule=Escalations");
    await expect(assignmentRules.list(admin, "Note")).resolves.toMatchObject({
      version: 2,
      rules: [
        {
          enabled: true,
          rule: { name: "Escalations", enabled: true, condition: { field: "priority", value: "High" } }
        }
      ]
    });

    const enabledPage = await app.request("/desk/admin/assignment-rules?doctype=Note");
    expect(enabledPage.status).toBe(200);
    await expect(enabledPage.text()).resolves.toContain(
      'action="/desk/admin/assignment-rules/Note/Escalations/disable"'
    );

    const disabled = await app.request("/desk/admin/assignment-rules/Note/Escalations/disable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(disabled.status).toBe(303);
    await expect(assignmentRules.list(admin, "Note")).resolves.toMatchObject({
      version: 3,
      rules: [
        {
          enabled: false,
          rule: { name: "Escalations", enabled: false, condition: { field: "priority", value: "High" } }
        }
      ]
    });
  });

  it("uses configured admin roles for Desk assignment rule discovery and authorization", async () => {
    const deskAdmin = { ...owner, id: "desk-admin@example.com", roles: ["Desk Admin", "User"], tenantId: "acme" };
    const services = createServices();
    const assignmentRules = new AssignmentRuleService({
      registry: services.registry,
      events: services.store,
      adminRoles: ["Desk Admin"]
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      adminRoles: ["Desk Admin"],
      assignmentRules,
      actor: () => deskAdmin
    });

    const response = await app.request("/desk/admin/assignment-rules?doctype=Note");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Assignment Rules");
    expect(html).toContain('href="/desk/admin/assignment-rules"');
  });

  it("denies Desk assignment rule administration for non-admin actors", async () => {
    const user = { ...owner, id: "user@example.com", roles: ["User"], tenantId: "acme" };
    const services = createServices();
    const assignmentRules = new AssignmentRuleService({
      registry: services.registry,
      events: services.store
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      assignmentRules,
      actor: () => user
    });

    const response = await app.request("/desk/admin/assignment-rules?doctype=Note");
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain("cannot manage assignment rules");
  });

  it("returns assignment rule version conflicts before missing-rule errors on stale row actions", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" };
    const services = createServices();
    const assignmentRules = new AssignmentRuleService({
      registry: services.registry,
      events: services.store,
      clock: fixedClock(now),
      ids: deterministicIds(["assignment-rule-event-1", "assignment-rule-event-2"])
    });
    await assignmentRules.save({
      actor: admin,
      doctype: "Note",
      expectedVersion: 0,
      rule: {
        name: "Stale toggle",
        enabled: false,
        events: ["DocumentUpdated"],
        assignees: [{ kind: "user", userId: "manager@example.com" }]
      }
    });
    await assignmentRules.clear({
      actor: admin,
      doctype: "Note",
      ruleName: "Stale toggle",
      expectedVersion: 1
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      assignmentRules,
      actor: () => admin
    });

    const stale = await app.request("/desk/admin/assignment-rules/Note/Stale%20toggle/enable", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(stale.status).toBe(409);
    await expect(stale.text()).resolves.toContain("Expected assignment rules at version 1, found 2");
  });

  it("renders and mutates field property overrides from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"] };
    const { app, services } = makeFieldPropertyDesk(admin);

    const empty = await app.request("/desk/admin/field-properties?doctype=Note&field=priority");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("Field Properties");
    expect(emptyHtml).toContain('name="field"');
    expect(emptyHtml).toContain('name="description"');
    expect(emptyHtml).toContain('name="placeholder"');
    expect(emptyHtml).toContain('name="mandatoryDependsOn"');
    expect(emptyHtml).toContain('name="readOnlyDependsOn"');
    expect(emptyHtml).toContain('name="hiddenDependsOn"');
    expect(emptyHtml).toContain('name="printHide"');
    expect(emptyHtml).toContain('name="printHideIfNoValue"');
    expect(emptyHtml).toContain('name="fetchFrom"');
    expect(emptyHtml).toContain('name="fetchIfEmpty"');
    expect(emptyHtml).toContain("No field property overrides configured.");

    const created = await app.request("/desk/admin/field-properties", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        fieldName: "priority",
        label: "Urgency",
        description: "Pick the operational urgency.",
        placeholder: "Choose a priority",
        mandatoryDependsOn: JSON.stringify({ field: "title", operator: "is", value: "set" }),
        readOnlyDependsOn: JSON.stringify({ field: "workflow_state", value: "Closed" }),
        hiddenDependsOn: JSON.stringify({ field: "title", operator: "is", value: "not set" }),
        printHide: "true",
        printHideIfNoValue: "true",
        noCopy: "true",
        allowOnSubmit: "true",
        inListFilter: "true",
        options: "Low, High",
        defaultValue: JSON.stringify("High"),
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/field-properties?doctype=Note&field=priority");
    await expect(services.fieldProperties.list(admin, "Note")).resolves.toMatchObject({
      version: 1,
      fields: [
        {
            fieldName: "priority",
            overrides: {
              label: "Urgency",
              description: "Pick the operational urgency.",
              placeholder: "Choose a priority",
              mandatoryDependsOn: { field: "title", operator: "is", value: "set" },
            readOnlyDependsOn: { field: "workflow_state", value: "Closed" },
            hiddenDependsOn: { field: "title", operator: "is", value: "not set" },
            printHide: true,
            printHideIfNoValue: true,
            noCopy: true,
            allowOnSubmit: true,
            inListFilter: true,
            options: ["Low", "High"]
          }
        }
      ]
    });

    const current = await app.request("/desk/admin/field-properties?doctype=Note&field=priority");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("Urgency");
    expect(currentHtml).toContain("description: Pick the operational urgency.");
    expect(currentHtml).toContain("placeholder: Choose a priority");
    expect(currentHtml).toContain("mandatory depends on");
    expect(currentHtml).toContain("read only depends on");
    expect(currentHtml).toContain("hidden depends on");
    expect(currentHtml).toContain("print hide: true");
    expect(currentHtml).toContain("print hide if empty: true");
    expect(currentHtml).toContain("no copy: true");
    expect(currentHtml).toContain("allow on submit: true");
    expect(currentHtml).toContain("options: Low, High");
    expect(currentHtml).toContain('formaction="/desk/admin/field-properties/Note/priority/clear"');
    expect(currentHtml).toContain('name="expectedVersion" value="1"');

    const noteForm = await app.request("/desk/Note/new");
    expect(noteForm.status).toBe(200);
    const noteFormHtml = await noteForm.text();
    expect(noteFormHtml).toContain("Pick the operational urgency.");
    expect(noteFormHtml).toContain("data-cf-frappe-hidden-depends-on");

    const stale = await app.request("/desk/admin/field-properties", {
      method: "POST",
      body: new URLSearchParams({
        doctype: "Note",
        fieldName: "body",
        label: "Details",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected field property overrides at version 0, found 1");
    expect(staleHtml).toContain("Urgency");

    const cleared = await app.request("/desk/admin/field-properties/Note/priority/clear", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(cleared.status).toBe(303);
    await expect(services.fieldProperties.list(admin, "Note")).resolves.toMatchObject({ version: 2, fields: [] });
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
        description: "Visible after quality review.",
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
    expect(formHtml).toContain("Visible after quality review.");
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

  it("applies nested child table custom fields to generated Desk child-table forms", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"] };
    const { app, services } = makeChildTableCustomFieldDesk(admin);
    await services.customFields.saveField({
      actor: admin,
      doctype: "Sales Invoice Item",
      field: {
        name: "bonus_products",
        label: "Bonus Products",
        type: "table",
        tableOf: "Product"
      }
    });
    await services.documents.create({ actor: admin, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });

    const form = await app.request("/desk/Sales%20Invoice/new");
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("<th>Bonus Products</th>");
    expect(html).toContain("<legend>Bonus Products</legend>");
    expect(html).toContain('name="items[0].bonus_products[0].sku"');
    expect(html).toContain('name="items[0].bonus_products[0].title"');

    const created = await app.request("/desk/Sales%20Invoice", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-NESTED-CHILD-CUSTOM-DESK",
        "items[0].product": "SKU-1",
        "items[0].quantity": "1",
        "items[0].bonus_products[0].sku": "BONUS-1",
        "items[0].bonus_products[0].title": "Bonus Widget"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/Sales%20Invoice/INV-NESTED-CHILD-CUSTOM-DESK");
    await expect(services.queries.getDocument(admin, "Sales Invoice", "INV-NESTED-CHILD-CUSTOM-DESK")).resolves.toMatchObject({
      data: {
        items: [
          {
            product: "SKU-1",
            quantity: 1,
            bonus_products: [{ sku: "BONUS-1", title: "Bonus Widget" }]
          }
        ]
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

  it("syncs auth-provider accounts from the Desk account admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const { app, services } = makeAccountDesk(admin);

    const page = await app.request("/desk/admin/users?user=owner%40example.com");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Sync Auth Provider");
    expect(html).toContain('action="/desk/admin/users/provider-sync"');

    const synced = await app.request("/desk/admin/users/provider-sync", {
      method: "POST",
      body: new URLSearchParams({
        user: owner.id,
        provider: "cloudflare-access",
        subject: "access-subject-1",
        email: "OWNER@EXAMPLE.COM",
        roles: "User, Task Manager",
        enabled: "true",
        emailVerified: "true",
        expectedVersion: "0"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(synced.status).toBe(303);
    expect(synced.headers.get("location")).toBe("/desk/admin/users?user=owner%40example.com");
    await expect(services.userAccounts.get(admin, owner.id)).resolves.toMatchObject({
      version: 2,
      email: "owner@example.com",
      emailVerifiedAt: now,
      roles: ["Task Manager", "User"],
      providers: [
        {
          provider: "cloudflare-access",
          subject: "access-subject-1"
        }
      ],
      enabled: true
    });
    await expect(
      services.userAccounts.authenticate({ tenantId: "acme", userId: owner.id, password: "secret-123" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
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
    const resources = { touched: [] as string[], rolledBack: [] as string[] };
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
            },
            rollback: {
              label: "Undo First",
              run: ({ resources }) => {
                resources.rolledBack.push("first");
              }
            }
          }),
          defineDataPatch<typeof resources>({
            id: "crm.second",
            checksum: "v1",
            run: ({ resources }) => {
              resources.touched.push("second");
            },
            rollback: {
              run: ({ resources }) => {
                resources.rolledBack.push("second");
              }
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-first", "claim-second", "rollback-second", "rollback-first"])
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
    expect(appliedHtml).toContain('formaction="/desk/admin/data-patches/core.first/rollback-plan"');
    expect(appliedHtml).toContain('formaction="/desk/admin/data-patches/crm.second/rollback-plan"');
    expect(appliedHtml).toContain('formaction="/desk/admin/data-patches/rollback-plan"');
    expect(appliedHtml).toContain('formaction="/desk/admin/data-patches/crm.second/rollback"');
    expect(appliedHtml).toContain('formaction="/desk/admin/data-patches/rollback"');

    const rollbackPlan = await app.request("/desk/admin/data-patches/rollback-plan", {
      method: "POST",
      body: new URLSearchParams({ limit: "2" })
    });
    expect(rollbackPlan.status).toBe(200);
    const rollbackPlanHtml = await rollbackPlan.text();
    expect(rollbackPlanHtml).toContain("Planned Rollback");
    expect(rollbackPlanHtml).toContain("crm.second, core.first");
    expect(rollbackPlanHtml).toContain("Limit: 2");

    const singleRollbackPlan = await app.request("/desk/admin/data-patches/crm.second/rollback-plan", { method: "POST" });
    expect(singleRollbackPlan.status).toBe(200);
    await expect(singleRollbackPlan.text()).resolves.toContain("Requested: crm.second");
    expect(resources.rolledBack).toEqual([]);

    const singleRollback = await app.request("/desk/admin/data-patches/crm.second/rollback", { method: "POST" });
    expect(singleRollback.status).toBe(303);
    expect(singleRollback.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.rolledBack).toEqual(["second"]);

    const partialRollbackHtml = await (await app.request("/desk/admin/data-patches")).text();
    expect(partialRollbackHtml).toContain("rolled_back");
    expect(partialRollbackHtml).toContain('formaction="/desk/admin/data-patches/core.first/rollback"');

    const batchRollback = await app.request("/desk/admin/data-patches/rollback", {
      method: "POST",
      body: new URLSearchParams({ limit: "1" })
    });
    expect(batchRollback.status).toBe(303);
    expect(batchRollback.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.rolledBack).toEqual(["second", "first"]);
  });

  it("enqueues data patch apply jobs from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const resources = { touched: [] as string[] };
    const dataPatches = new DataPatchService({
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
    });
    const queue = new InMemoryJobQueue();
    const dataPatchQueue = new DataPatchQueueService({
      dataPatches,
      dispatcher: new JobDispatcher({
        registry: createJobRegistry({ jobs: [createDataPatchApplyJob()] }),
        queue,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-001", "patch-002"])
      })
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches,
      dataPatchQueue,
      actor: () => admin
    });

    const page = await app.request("/desk/admin/data-patches");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('formaction="/desk/admin/data-patches/enqueue"');
    expect(html).toContain('action="/desk/admin/data-patches/core.first/enqueue"');
    expect(html).toContain('name="idempotencyKey"');
    expect(html).toContain('maxlength="256"');
    expect(html).toContain('name="delaySeconds"');
    expect(html).toContain('max="86400"');
    expect(html).not.toContain('formaction="/desk/admin/data-patches/rollback-enqueue"');

    const invalidDelay = await app.request("/desk/admin/data-patches/enqueue", {
      method: "POST",
      body: new URLSearchParams({ delaySeconds: "-1" })
    });
    expect(invalidDelay.status).toBe(400);
    await expect(invalidDelay.text()).resolves.toContain(
      "Data patch enqueue delaySeconds must be an integer between 0 and 86400"
    );
    expect(queue.queued()).toEqual([]);

    const tooLongDelay = await app.request("/desk/admin/data-patches/enqueue", {
      method: "POST",
      body: new URLSearchParams({ delaySeconds: "86401" })
    });
    expect(tooLongDelay.status).toBe(400);
    await expect(tooLongDelay.text()).resolves.toContain(
      "Data patch enqueue delaySeconds must be an integer between 0 and 86400"
    );
    expect(queue.queued()).toEqual([]);

    const tooLongKey = await app.request("/desk/admin/data-patches/enqueue", {
      method: "POST",
      body: new URLSearchParams({ idempotencyKey: "x".repeat(257) })
    });
    expect(tooLongKey.status).toBe(400);
    await expect(tooLongKey.text()).resolves.toContain(
      "Data patch enqueue idempotencyKey must be at most 256 characters"
    );
    expect(queue.queued()).toEqual([]);

    const batch = await app.request("/desk/admin/data-patches/enqueue", {
      method: "POST",
      body: new URLSearchParams({ limit: "1", idempotencyKey: "patches:first", delaySeconds: "30" })
    });
    expect(batch.status).toBe(303);
    const batchLocation = batch.headers.get("location");
    expect(batchLocation).toContain("/desk/admin/data-patches?");
    expect(queue.queued()[0]).toMatchObject({
      delaySeconds: 30,
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.apply",
        runId: "job_patch-001",
        idempotencyKey: "patches:first",
        payload: { patchIds: ["core.first"] },
        metadata: { dispatchSource: "data-patches", requestedBy: "admin@example.com" }
      }
    });
    expect(resources.touched).toEqual([]);
    const batchHtml = await (await app.request(batchLocation!)).text();
    expect(batchHtml).toContain("Enqueued data patch job cf-frappe.data-patches.apply / job_patch-001");

    const single = await app.request("/desk/admin/data-patches/core.first/enqueue", {
      method: "POST",
      body: new URLSearchParams({ idempotencyKey: "patches:single-first", delaySeconds: "5" })
    });
    expect(single.status).toBe(303);
    expect(queue.queued()[1]).toMatchObject({
      delaySeconds: 5,
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.apply",
        runId: "job_patch-002",
        idempotencyKey: "patches:single-first",
        payload: { patchIds: ["core.first"] }
      }
    });
    expect(resources.touched).toEqual([]);
  });

  it("enqueues data patch rollback jobs from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const resources = { applied: [] as string[], rolledBack: [] as string[] };
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("first");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("first");
            }
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("second");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("second");
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second"])
    });
    const queue = new InMemoryJobQueue();
    const dataPatchRollbackQueue = new DataPatchQueueService({
      dataPatches,
      dispatcher: new JobDispatcher({
        registry: createJobRegistry({ jobs: [createDataPatchRollbackJob()] }),
        queue,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-rollback-001", "patch-rollback-002"])
      })
    });
    await dataPatches.apply(admin);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches,
      dataPatchRollbackQueue,
      actor: () => admin
    });

    const page = await app.request("/desk/admin/data-patches");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('formaction="/desk/admin/data-patches/rollback-enqueue"');
    expect(html).toContain('action="/desk/admin/data-patches/crm.second/rollback-enqueue"');
    expect(html).toContain('name="idempotencyKey"');
    expect(html).toContain('name="delaySeconds"');
    expect(html).not.toContain('formaction="/desk/admin/data-patches/enqueue"');

    const batch = await app.request("/desk/admin/data-patches/rollback-enqueue", {
      method: "POST",
      body: new URLSearchParams({ limit: "1", idempotencyKey: "patches:rollback-second", delaySeconds: "45" })
    });
    expect(batch.status).toBe(303);
    const batchLocation = batch.headers.get("location");
    expect(batchLocation).toContain("/desk/admin/data-patches?");
    expect(queue.queued()[0]).toMatchObject({
      delaySeconds: 45,
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.rollback",
        runId: "job_patch-rollback-001",
        idempotencyKey: "patches:rollback-second",
        payload: { patchIds: ["crm.second"] },
        metadata: { dispatchSource: "data-patches", requestedBy: "admin@example.com" }
      }
    });
    expect(resources.rolledBack).toEqual([]);
    const batchHtml = await (await app.request(batchLocation!)).text();
    expect(batchHtml).toContain("Enqueued data patch rollback job cf-frappe.data-patches.rollback / job_patch-rollback-001");

    const single = await app.request("/desk/admin/data-patches/crm.second/rollback-enqueue", {
      method: "POST",
      body: new URLSearchParams({ idempotencyKey: "patches:rollback-single", delaySeconds: "15" })
    });
    expect(single.status).toBe(303);
    expect(queue.queued()[1]).toMatchObject({
      delaySeconds: 15,
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.rollback",
        runId: "job_patch-rollback-002",
        idempotencyKey: "patches:rollback-single",
        payload: { patchIds: ["crm.second"] }
      }
    });
    expect(resources.rolledBack).toEqual([]);
  });

  it("enqueues failed rollback retry jobs from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };
    const services = createServices();
    const resources = { attempts: 0, rolledBack: [] as string[] };
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.rollback",
          checksum: "v1",
          run: () => undefined,
          rollback: {
            run: ({ resources }) => {
              resources.attempts += 1;
              if (resources.attempts === 1) {
                throw new Error("rollback boom");
              }
              resources.rolledBack.push("core");
              return { attempts: resources.attempts };
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-apply", "rollback-failed"])
    });
    const queue = new InMemoryJobQueue();
    const dataPatchRollbackRetryQueue = new DataPatchQueueService({
      dataPatches,
      dispatcher: new JobDispatcher({
        registry: createJobRegistry({ jobs: [createDataPatchRollbackRetryJob()] }),
        queue,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-rollback-retry-001"])
      })
    });
    await dataPatches.apply(admin);
    await expect(dataPatches.rollback(admin, { patchIds: ["core.rollback"] })).rejects.toThrow("rollback boom");
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      dataPatches,
      dataPatchRollbackRetryQueue,
      actor: () => admin
    });

    const page = await app.request("/desk/admin/data-patches");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('action="/desk/admin/data-patches/core.rollback/rollback-retry-enqueue"');
    expect(html).toContain('name="idempotencyKey"');
    expect(html).toContain('name="delaySeconds"');

    const enqueued = await app.request("/desk/admin/data-patches/core.rollback/rollback-retry-enqueue", {
      method: "POST",
      body: new URLSearchParams({ idempotencyKey: "patches:rollback-retry-single", delaySeconds: "25" })
    });
    expect(enqueued.status).toBe(303);
    const enqueuedLocation = enqueued.headers.get("location");
    expect(enqueuedLocation).toContain("/desk/admin/data-patches?");
    expect(queue.queued()[0]).toMatchObject({
      delaySeconds: 25,
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.rollback-retry",
        runId: "job_patch-rollback-retry-001",
        idempotencyKey: "patches:rollback-retry-single",
        payload: { patchId: "core.rollback" },
        metadata: { dispatchSource: "data-patches", requestedBy: "admin@example.com" }
      }
    });
    expect(resources).toEqual({ attempts: 1, rolledBack: [] });
    const enqueuedHtml = await (await app.request(enqueuedLocation!)).text();
    expect(enqueuedHtml).toContain(
      "Enqueued data patch rollback retry job cf-frappe.data-patches.rollback-retry / job_patch-rollback-retry-001"
    );
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

  it("renders failed rollback details in the Desk data patch admin surface", async () => {
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
            id: "core.rollback",
            checksum: "v1",
            run: () => ({ applied: true }),
            rollback: {
              run: ({ resources }) => {
                resources.attempts += 1;
                if (resources.attempts === 1) {
                  throw new Error("rollback boom");
                }
                return { attempts: resources.attempts };
              }
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-apply", "claim-rollback", "rollback-retry"])
      }),
      actor: () => admin
    });

    await expect(app.request("/desk/admin/data-patches/apply", { method: "POST" })).resolves.toMatchObject({
      status: 303
    });
    const failedRollback = await app.request("/desk/admin/data-patches/core.rollback/rollback", { method: "POST" });

    expect(failedRollback.status).toBe(500);
    const html = await failedRollback.text();
    expect(html).toContain("rollback_failed");
    expect(html).toContain(now);
    expect(html).toContain("rollback boom");
    expect(html).toContain('formaction="/desk/admin/data-patches/core.rollback/rollback-retry"');

    const retried = await app.request("/desk/admin/data-patches/core.rollback/rollback-retry", { method: "POST" });
    expect(retried.status).toBe(303);
    expect(retried.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.attempts).toBe(2);

    const recovered = await app.request("/desk/admin/data-patches");
    const recoveredHtml = await recovered.text();
    expect(recoveredHtml).toContain("rolled_back");
    expect(recoveredHtml).toContain("{&quot;attempts&quot;:2}");
    expect(recoveredHtml).not.toContain('formaction="/desk/admin/data-patches/core.rollback/rollback-retry"');
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
    const fieldProperties = new FieldPropertyService({ registry: services.registry, events: services.store });
    const workflows = new WorkflowService({ registry: services.registry, events: services.store });
    const notificationRules = new NotificationRuleService({ registry: services.registry, events: services.store });
    const assignmentRules = new AssignmentRuleService({ registry: services.registry, events: services.store });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      userPermissions: services.userPermissions,
      roles: new RoleService({ events: services.store }),
      customFields,
      fieldProperties,
      workflows,
      notificationRules,
      assignmentRules,
      printSettings: services.printSettings,
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
    expect(homeHtml).toContain('href="/desk/admin/field-properties"');
    expect(homeHtml).toContain('href="/desk/admin/workflows"');
    expect(homeHtml).toContain('href="/desk/admin/notification-rules"');
    expect(homeHtml).toContain('href="/desk/admin/assignment-rules"');
    expect(homeHtml).toContain('href="/desk/admin/print-settings"');
    expect(homeHtml).toContain('href="/desk/admin/data-patches"');
    expect(homeHtml).toContain('href="/desk/admin/jobs/schedules"');
    expect(homeHtml).not.toContain('href="/desk/admin/users"');

    const printSettingsPage = await app.request("/desk/admin/print-settings");
    expect(printSettingsPage.status).toBe(200);
    await expect(printSettingsPage.text()).resolves.toContain(
      '<a class="nav-link is-active" href="/desk/admin/print-settings">Print Settings</a>'
    );

    const dataPatchPage = await app.request("/desk/admin/data-patches");
    expect(dataPatchPage.status).toBe(200);
    await expect(dataPatchPage.text()).resolves.toContain(
      '<a class="nav-link is-active" href="/desk/admin/data-patches">Data Patches</a>'
    );

    const notificationRulesPage = await app.request("/desk/admin/notification-rules");
    expect(notificationRulesPage.status).toBe(200);
    await expect(notificationRulesPage.text()).resolves.toContain(
      '<a class="nav-link is-active" href="/desk/admin/notification-rules">Notification Rules</a>'
    );

    const assignmentRulesPage = await app.request("/desk/admin/assignment-rules");
    expect(assignmentRulesPage.status).toBe(200);
    await expect(assignmentRulesPage.text()).resolves.toContain(
      '<a class="nav-link is-active" href="/desk/admin/assignment-rules">Assignment Rules</a>'
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

    const queueDisabled = await app.request("/desk/admin/data-patches/enqueue", { method: "POST" });
    expect(queueDisabled.status).toBe(404);
    await expect(queueDisabled.text()).resolves.toContain("Data patch queue is not enabled");

    const rollbackQueueDisabled = await app.request("/desk/admin/data-patches/rollback-enqueue", { method: "POST" });
    expect(rollbackQueueDisabled.status).toBe(404);
    await expect(rollbackQueueDisabled.text()).resolves.toContain("Data patch rollback queue is not enabled");

    const rollbackRetryQueueDisabled = await app.request("/desk/admin/data-patches/core.seed/rollback-retry-enqueue", {
      method: "POST"
    });
    expect(rollbackRetryQueueDisabled.status).toBe(404);
    await expect(rollbackRetryQueueDisabled.text()).resolves.toContain(
      "Data patch rollback retry queue is not enabled"
    );

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

  it("renders and updates print settings from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      printSettings: services.printSettings,
      actor: () => admin
    });

    const empty = await app.request("/desk/admin/print-settings");
    expect(empty.status).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain('action="/desk/admin/print-settings"');
    expect(emptyHtml).toContain('name="expectedVersion" value="0"');
    expect(emptyHtml).toContain('name="pageSize"');
    expect(emptyHtml).toContain('name="orientation"');
    expect(emptyHtml).toContain('name="customWidthMm"');
    expect(emptyHtml).toContain('name="customHeightMm"');
    expect(emptyHtml).toContain('name="topMm"');
    expect(emptyHtml).toContain('name="rightMm"');
    expect(emptyHtml).toContain('name="bottomMm"');
    expect(emptyHtml).toContain('name="leftMm"');
    expect(emptyHtml).toContain('name="fontFamily"');
    expect(emptyHtml).toContain('name="fontSizePt"');

    const saved = await app.request("/desk/admin/print-settings", {
      method: "POST",
      body: new URLSearchParams({
        expectedVersion: "0",
        pageSize: "A4",
        orientation: "landscape",
        topMm: "12",
        rightMm: "10",
        bottomMm: "14",
        leftMm: "10",
        fontFamily: "Inter",
        fontSizePt: "10"
      })
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/admin/print-settings");
    await expect(services.printSettings.get(admin)).resolves.toMatchObject({
      version: 1,
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
          font: { family: "Inter", sizePt: 10 }
        }
      }
    });

    const current = await app.request("/desk/admin/print-settings");
    expect(current.status).toBe(200);
    const currentHtml = await current.text();
    expect(currentHtml).toContain('name="expectedVersion" value="1"');
    expect(currentHtml).toContain('<option value="A4" selected>A4</option>');
    expect(currentHtml).toContain('<option value="landscape" selected>Landscape</option>');
    expect(currentHtml).toContain('name="topMm" type="number" step="any" min="0" max="100" value="12"');
    expect(currentHtml).toContain('name="fontFamily" value="Inter"');
    expect(currentHtml).toContain('name="fontSizePt" type="number" step="any" min="6" max="72" value="10"');

    const stale = await app.request("/desk/admin/print-settings", {
      method: "POST",
      body: new URLSearchParams({
        expectedVersion: "0",
        pageSize: "Letter"
      })
    });
    expect(stale.status).toBe(409);
    const staleHtml = await stale.text();
    expect(staleHtml).toContain("Expected print settings at version 0, found 1");
    expect(staleHtml).toContain('name="expectedVersion" value="1"');

    const cleared = await app.request("/desk/admin/print-settings", {
      method: "POST",
      body: new URLSearchParams({
        expectedVersion: "1",
        clearDefaultLayout: "1"
      })
    });
    expect(cleared.status).toBe(303);
    await expect(services.printSettings.get(admin)).resolves.toMatchObject({
      version: 2,
      settings: {}
    });

    const custom = await app.request("/desk/admin/print-settings", {
      method: "POST",
      body: new URLSearchParams({
        expectedVersion: "2",
        customWidthMm: "210",
        customHeightMm: "297",
        topMm: "8"
      })
    });
    expect(custom.status).toBe(303);
    await expect(services.printSettings.get(admin)).resolves.toMatchObject({
      version: 3,
      settings: {
        defaultLayout: {
          pageSize: { widthMm: 210, heightMm: 297 },
          margins: { topMm: 8 }
        }
      }
    });

    const customPage = await app.request("/desk/admin/print-settings");
    const customHtml = await customPage.text();
    expect(customHtml).toContain('name="customWidthMm" type="number" step="any" min="1" max="2000" value="210"');
    expect(customHtml).toContain('name="customHeightMm" type="number" step="any" min="1" max="2000" value="297"');
  });

  it("renders Desk print settings admin route errors", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const disabled = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => admin
    });
    const missing = await disabled.request("/desk/admin/print-settings");
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain("Print settings are not enabled");

    const userApp = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      printSettings: services.printSettings,
      actor: () => guest
    });
    const denied = await userApp.request("/desk/admin/print-settings");
    expect(denied.status).toBe(403);
    await expect(denied.text()).resolves.toContain("cannot manage print settings");
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

    const response = await app.request("/desk/admin/jobs/schedules?job=reports.daily&cron=0%202%20*%20*%20*");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Job Schedules");
    expect(html).toContain("0 2 * * *");
    expect(html).toContain("reports.daily");
    expect(html).toContain("acme");
    expect(html).toContain("<th>Enabled</th>");
    expect(html).toContain("payload");
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/1/run"');
    expect(html).toContain('name="returnCron" value="0 2 * * *"');
    expect(html).toContain('name="returnJob" value="reports.daily"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/2/run"');
    expect(html).not.toContain('href="/desk/admin/jobs"');

    const dispatched = await app.request("/desk/admin/jobs/schedules/1/run", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        returnCron: "0 2 * * *",
        returnJob: "reports.daily"
      }).toString()
    });
    expect(dispatched.status).toBe(303);
    expect(dispatched.headers.get("location")).toBe("/desk/admin/jobs/schedules?cron=0+2+*+*+*&job=reports.daily");
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
        ids: deterministicIds(["disable-1", "reset-2", "pause-3", "reset-4", "enable-5", "reset-6"])
      }),
      actor: () => admin
    });

    const response = await app.request("/desk/admin/jobs/schedules");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<th>Override</th>");
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/daily/disable"');
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/daily/pause"');
    expect(html).toContain('placeholder="Pause until ISO time"');
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/digest/enable"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/dynamic/disable"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/dynamic/enable"');
    expect(html).not.toContain('formaction="/desk/admin/jobs/schedules/dynamic/pause"');

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

    const pausedUntil = "2026-01-02T00:00:00.000Z";
    const pauseBody = new URLSearchParams({ pauseUntil: pausedUntil }).toString();
    const paused = await app.request("/desk/admin/jobs/schedules/daily/pause", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: pauseBody
    });
    expect(paused.status).toBe(303);
    expect(paused.headers.get("location")).toBe("/desk/admin/jobs/schedules");

    const afterPause = await app.request("/desk/admin/jobs/schedules");
    const pausedHtml = await afterPause.text();
    expect(pausedHtml).toContain(`paused until ${pausedUntil}`);
    expect(pausedHtml).toContain('value="2026-01-02T00:00:00.000Z"');
    expect(pausedHtml).toContain('formaction="/desk/admin/jobs/schedules/daily/reset"');

    const resetPaused = await app.request("/desk/admin/jobs/schedules/daily/reset", { method: "POST" });
    expect(resetPaused.status).toBe(303);
    expect(resetPaused.headers.get("location")).toBe("/desk/admin/jobs/schedules");

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

  it("keeps job schedule filters after Desk override actions", async () => {
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
        schedules: [
          { id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" },
          { id: "digest", cron: "0 3 * * *", jobName: "reports.daily", tenantId: "acme", enabled: false }
        ],
        events: new InMemoryEventStore(),
        clock: fixedClock(now),
        ids: deterministicIds(["disable-filter", "reset-filter", "enable-filter"])
      }),
      actor: () => admin
    });
    const dailyBody = new URLSearchParams({
      returnCron: "0 2 * * *",
      returnJob: "reports.daily"
    }).toString();
    const digestBody = new URLSearchParams({
      returnCron: "0 3 * * *",
      returnJob: "reports.daily"
    }).toString();

    const disabled = await app.request("/desk/admin/jobs/schedules/daily/disable", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: dailyBody
    });
    expect(disabled.status).toBe(303);
    expect(disabled.headers.get("location")).toBe("/desk/admin/jobs/schedules?cron=0+2+*+*+*&job=reports.daily");

    const reset = await app.request("/desk/admin/jobs/schedules/daily/reset", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: dailyBody
    });
    expect(reset.status).toBe(303);
    expect(reset.headers.get("location")).toBe("/desk/admin/jobs/schedules?cron=0+2+*+*+*&job=reports.daily");

    const enabled = await app.request("/desk/admin/jobs/schedules/digest/enable", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: digestBody
    });
    expect(enabled.status).toBe(303);
    expect(enabled.headers.get("location")).toBe("/desk/admin/jobs/schedules?cron=0+3+*+*+*&job=reports.daily");
  });

  it("creates, updates, and deletes runtime job schedules from the Desk admin surface", async () => {
    const admin = { ...owner, id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const services = createServices();
    const jobs = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const scheduleEvents = new InMemoryEventStore();
    const jobSchedules = new JobScheduleService({
      registry: jobs,
      schedules: [],
      events: scheduleEvents,
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime", "update-runtime", "delete-runtime"])
    });
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules,
      actor: () => admin
    });

    const empty = await app.request("/desk/admin/jobs/schedules");
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain('action="/desk/admin/jobs/schedules"');
    expect(emptyHtml).toContain("Save runtime schedule");
    expect(emptyHtml).toContain('name="delaySeconds" type="number" min="0" max="86400"');

    const filteredEmpty = await app.request("/desk/admin/jobs/schedules?job=reports.daily&cron=15%204%20*%20*%20*");
    const filteredEmptyHtml = await filteredEmpty.text();
    expect(filteredEmptyHtml).toContain('name="returnCron" value="15 4 * * *"');
    expect(filteredEmptyHtml).toContain('name="returnJob" value="reports.daily"');

    const escapedFilters = await app.request(
      "/desk/admin/jobs/schedules?job=reports.daily%26audit&cron=15%20%224%22%20*%20*%20*"
    );
    const escapedFiltersHtml = await escapedFilters.text();
    expect(escapedFiltersHtml).toContain('name="returnCron" value="15 &quot;4&quot; * * *"');
    expect(escapedFiltersHtml).toContain('name="returnJob" value="reports.daily&amp;audit"');

    const invalidDelay = await app.request("/desk/admin/jobs/schedules", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: "runtime-too-late",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        delaySeconds: "86401",
        enabled: "true"
      }).toString()
    });
    expect(invalidDelay.status).toBe(400);
    await expect(invalidDelay.text()).resolves.toContain("delaySeconds must be an integer between 0 and 86400");
    await expect(scheduleEvents.readStream(jobScheduleDefinitionsStream())).resolves.toEqual([]);

    const created = await app.request("/desk/admin/jobs/schedules", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        delaySeconds: "30",
        enabled: "true",
        returnCron: "15 4 * * *",
        returnJob: "reports.daily"
      }).toString()
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/jobs/schedules?cron=15+4+*+*+*&job=reports.daily");

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

    const deleted = await app.request("/desk/admin/jobs/schedules/runtime-daily/delete", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        returnCron: "15 4 * * *",
        returnJob: "reports.daily"
      }).toString()
    });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/desk/admin/jobs/schedules?cron=15+4+*+*+*&job=reports.daily");
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

  it("renders PDF print links in edit forms when a renderer is configured", async () => {
    const renderer = new RecordingPrintPdfRenderer();
    const { app, services } = makeDesk(owner, { printPdfRenderer: renderer });
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("/desk/print/Note%20Standard/My%20Note");
    expect(html).toContain("/desk/print/Note%20Standard/My%20Note/pdf");
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

  it("hides save and domain command actions from read-only generated edit forms", async () => {
    const { app, services } = makeDesk(guest);
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("My Note");
    expect(html).toContain("draft");
    expect(html).not.toContain(">Save</button>");
    expect(html).not.toContain('formaction="/desk/Note/My%20Note/command/archive"');

    const posted = await app.request("/desk/Note/My%20Note", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Edited", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(posted.status).toBe(403);
    const errorHtml = await posted.text();
    expect(errorHtml).toContain("cannot update Note/My Note");
    expect(errorHtml).not.toContain(">Save</button>");
    expect(errorHtml).not.toContain('formaction="/desk/Note/My%20Note/command/archive"');
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

  it("renders save and domain command actions for share-derived update actors", async () => {
    const collaborator = { id: "collab@example.com", roles: ["Guest"], tenantId: "acme" };
    const { app, services } = makeDesk(collaborator);
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.share({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      userId: collaborator.id,
      permissions: ["update"],
      expectedVersion: 1
    });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(">Save</button>");
    expect(html).toContain('formaction="/desk/Note/My%20Note/command/archive"');

    const updated = await app.request("/desk/Note/My%20Note", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Shared edit", expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(updated.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { body: "Shared edit" },
      version: 3
    });
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

  it("renders printable documents as PDF from Desk through the configured renderer", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const renderer = new RecordingPrintPdfRenderer({ body: pdf, contentLength: pdf.byteLength });
    const { app, services } = makeDesk(owner, { printPdfRenderer: renderer });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Print", priority: "High", body: "Print body" })
    });

    const response = await app.request("/desk/print/Note%20Standard/Desk%20Print/pdf");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Desk-Print.Note-Standard.pdf"');
    await expect(response.arrayBuffer()).resolves.toEqual(pdf.buffer);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0]).toMatchObject({
      actorId: owner.id,
      tenantId: owner.tenantId,
      formatName: "Note Standard",
      documentName: "Desk Print",
      documentDoctype: "Note",
      title: "Standard - Desk Print"
    });
    expect(renderer.calls[0]?.html).toContain("Print body");
  });

  it("uses the print policy error for Desk document PDFs without a renderer", async () => {
    const { app } = makeDesk(owner);

    const response = await app.request("/desk/print/Note%20Standard/Desk%20Print/pdf");

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("PDF print rendering is not configured");
  });

  it("uses the print policy error for Desk document print routes when prints are disabled", async () => {
    const { app } = makeDesk(owner, { prints: false, printPdfRenderer: new RecordingPrintPdfRenderer() });

    for (const path of ["/desk/print/Note%20Standard/Desk%20Print", "/desk/print/Note%20Standard/Desk%20Print/pdf"]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toContain("Print formats are not enabled");
    }
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
    expect(html).toContain('name="items[0].quantity" data-cf-frappe-field-type="integer"');
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

function addLeftNestedFormulaPath(body: URLSearchParams, maxDepth: number): void {
  let prefix = "formulaLeft";
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    body.set(`${prefix}Kind`, "nested");
    body.set(`${prefix}Operator`, "add");
    body.set(`${prefix}RightKind`, "literal");
    body.set(`${prefix}RightLiteral`, "1");
    if (depth === maxDepth) {
      body.set(`${prefix}LeftKind`, "field");
      body.set(`${prefix}Left`, "count");
    } else {
      prefix = `${prefix}Left`;
    }
  }
}

function coreDepthFormulaExpectation(maxDepth: number): unknown {
  let operand: unknown = "count";
  for (let depth = maxDepth; depth >= 2; depth -= 1) {
    operand = { operator: "add", left: operand, right: 1 };
  }
  return operand;
}

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
