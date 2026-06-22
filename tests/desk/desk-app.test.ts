import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  createDeskApp,
  createRegistry,
  defineClientScript,
  defineDocType,
  deterministicIds,
  DocumentService,
  fileDocType,
  FileService,
  fixedClock,
  createJobRegistry,
  InMemoryDocumentStore,
  InMemoryFileStorage,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  JobDispatcher,
  JobHistoryService,
  JobRetryService,
  JobScheduleService,
  QueryService,
  SYSTEM_MANAGER_ROLE
} from "../../src";
import { createChildTableServices, createLinkedServices, createServices, data, guest, now, owner } from "../helpers";

describe("Desk app", () => {
  function makeDesk(actor = owner) {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      queries: services.queries,
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      userPermissions: services.userPermissions,
      actor: () => actor
    });
    return { app, services };
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

  function makeFileDesk(
    actor = owner,
    options: { readonly maxFileBytes?: number; readonly ids?: readonly string[]; readonly fileIds?: readonly string[] } = {}
  ) {
    const registry = createRegistry({ doctypes: [fileDocType] });
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

  it("renders report list and report result pages", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Report Note", priority: "High", body: "For reporting", count: 7 })
    });

    const list = await app.request("/desk/reports");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain("Open Notes");

    const report = await app.request("/desk/reports/Open%20Notes?filter_priority=High");
    expect(report.status).toBe(200);
    const html = await report.text();
    expect(html).toContain("Report Note");
    expect(html).toContain("For reporting");
    expect(html).toContain("Total Count");
    expect(html).toContain("By Priority");
    expect(html).toContain("Notes by Priority");
    expect(html).toContain("chart-svg chart-bar");
    expect(html).toContain("/desk/reports/Open%20Notes/export.csv?filter_priority=High");

    const csv = await app.request("/desk/reports/Open%20Notes/export.csv?filter_priority=High");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Open-Notes.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("1");
    expect(csv.headers.get("x-cf-frappe-exported")).toBe("1");
    expect(csv.headers.get("x-cf-frappe-export-truncated")).toBe("false");
    await expect(csv.text()).resolves.toBe("Title,Priority,Body\nReport Note,High,For reporting");
  });

  it("renders a Desk file manager for upload, download, and delete workflows", async () => {
    const { app, storage } = makeFileDesk();

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

    const list = await app.request("/desk/files");
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain("hello.txt");
    expect(html).toContain("/desk/files/file_object/content");
    expect(html).toContain('formaction="/desk/files/file_object/delete"');

    const downloaded = await app.request("/desk/files/file_object/content");
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toBe('attachment; filename="hello.txt"');
    await expect(downloaded.text()).resolves.toBe("hello");

    const deleted = await app.request("/desk/files/file_object/delete", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(deleted.status).toBe(303);
    expect(storage.has("acme/files/file_object-hello.txt")).toBe(false);
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

  it("serves a built-in Desk client API for model client scripts", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk/client.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    const source = await response.text();
    expect(source).toContain("root.cfFrappe");
    expect(source).toContain("documentTopic(tenantId, doctype, name)");
    expect(source).toContain("resourcePath(doctype, name) + \"/transition/\"");
    expect(source).toContain("new WebSocket(realtimeUrl(topic)");
    expect(() => new Function(source)).not.toThrow();
  });

  it("renders metadata-driven list filters", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk High", priority: "High", body: "Hidden body" })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Low", priority: "Low", body: "Routine" })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Closed High", priority: "High", workflow_state: "Closed", body: "Closed" })
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
    expect(html).toContain('name="filter_priority"');
    expect(html).toContain('<option value="High" selected>High</option>');
    expect(html).toContain('<option value="Open" selected>Open</option>');
    expect(html).toContain("/desk/Note?default_filters=0");

    const closed = await app.request("/desk/Note?filter_priority=High&filter_workflow_state=Closed");
    expect(closed.status).toBe(200);
    const closedHtml = await closed.text();
    expect(closedHtml).toContain("Desk Closed High");
    expect(closedHtml).not.toContain("Desk High");
    expect(closedHtml).toContain('<option value="Closed" selected>Closed</option>');
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
    expect(html).toContain("payload");
    expect(html).toContain('formaction="/desk/admin/jobs/schedules/1/run"');
    expect(html).not.toContain('href="/desk/admin/jobs"');

    const dispatched = await app.request("/desk/admin/jobs/schedules/1/run", { method: "POST" });
    expect(dispatched.status).toBe(303);
    expect(dispatched.headers.get("location")).toBe("/desk/admin/jobs/schedules");
    expect(runner).toHaveBeenCalledOnce();
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
