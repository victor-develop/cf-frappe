import {
  createRegistry,
  createResourceApi,
  DashboardService,
  defineDocType,
  defineDashboard,
  defineWorkspace,
  deterministicIds,
  documentStream,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  PrintSettingsService,
  ReportService,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import {
  createLinkedServices,
  createSeriesServices,
  createServices,
  noteDocType,
  deepListFilterExpressionJson,
  now,
  openNotesReport,
  owner
} from "../helpers";

describe("resource api", () => {
  function makeApp() {
    const services = createServices(
      ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"],
      {
        savedFilterIds: [
          "saved-filter-1",
          "saved-filter-event-1",
          "saved-filter-2",
          "saved-filter-event-2",
          "saved-filter-3",
          "saved-filter-event-3"
        ]
      }
    );
    return createResourceApi({
      registry: services.registry,
      documents: services.documents,
      documentShares: services.documentShares,
      queries: services.queries,
      timeline: services.history,
      savedFilters: services.savedFilters,
      userPermissions: services.userPermissions,
      audit: services.audit,
      actor: unsafeHeaderActorResolver
    });
  }

  function makeAppWithBodyLimit(maxJsonBytes: number) {
    const services = createServices(["e1"]);
    return createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      timeline: services.history,
      actor: unsafeHeaderActorResolver,
      maxJsonBytes
    });
  }

  function makeLinkedApp() {
    const services = createLinkedServices(["p1", "p2"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  function makeSeriesApp() {
    const services = createSeriesServices(["series-1", "ticket-1"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  function makeWorkspaceApp() {
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
          roles: ["User"],
          sections: [
            {
              name: "main",
              label: "Main",
              shortcuts: [
                { name: "notes", kind: "doctype", target: "Note" },
                { name: "new-note", kind: "newDoc", target: "Note" },
                { name: "read-only-log", kind: "doctype", target: "ReadOnlyLog" },
                { name: "new-read-only-log", kind: "newDoc", target: "ReadOnlyLog" },
                { name: "create-only-log", kind: "doctype", target: "CreateOnlyLog" },
                { name: "new-create-only-log", kind: "newDoc", target: "CreateOnlyLog" },
                { name: "open-notes", kind: "report", target: "Open Notes" },
                { name: "ops-dashboard", kind: "dashboard", target: "Operations Dashboard" },
                { name: "management-dashboard", kind: "dashboard", target: "Management Dashboard" },
                { name: "manager-only", kind: "doctype", target: "Note", roles: ["Task Manager"] },
                { name: "files", kind: "file" },
                { name: "inbox", kind: "notifications" },
                { name: "users-admin", kind: "admin", target: "users" },
                { name: "print-settings-admin", kind: "admin", target: "print-settings" }
              ]
            }
          ]
        }),
        defineWorkspace({
          name: "Managers",
          roles: ["Task Manager"],
          sections: [{ name: "main", shortcuts: [{ name: "notes", kind: "doctype", target: "Note" }] }]
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
    const dashboards = new DashboardService({ registry, queries, reports });
    return createResourceApi({
      registry,
      documents,
      queries,
      dashboards,
      printSettings: new PrintSettingsService({ events: store }),
      actor: unsafeHeaderActorResolver
    });
  }

  function makeFilterCollisionApp() {
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
    return createResourceApi({
      registry,
      documents,
      queries,
      actor: unsafeHeaderActorResolver
    });
  }

  const userHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };
  const adminHeaders = {
    ...userHeaders,
    "x-cf-frappe-user": "admin@example.com",
    "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE
  };
  const managerHeaders = {
    ...userHeaders,
    "x-cf-frappe-user": "manager@example.com",
    "x-cf-frappe-roles": "Task Manager"
  };
  const collaboratorHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "collab@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  it("returns health", async () => {
    const app = makeApp();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns doctype metadata", async () => {
    const app = makeApp();

    const response = await app.request("/api/meta/doctypes/Note", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { name: "Note" } });
  });

  it("returns resolved list-view metadata for filter builders", async () => {
    const app = makeApp();

    const response = await app.request("/api/meta/doctypes/Note/list-view", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        columns: [{ name: "title" }, { name: "priority" }, { name: "workflow_state" }],
        filterBuilderFields: expect.arrayContaining([
          {
            field: "title",
            inputType: "text",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "in", label: "is in" },
              { operator: "not_in", label: "is not in" },
              { operator: "is", label: "is" },
              { operator: "contains", label: "contains" },
              { operator: "like", label: "like" },
              { operator: "not_like", label: "not like" }
            ]
          },
          {
            field: "priority",
            inputType: "select",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "in", label: "is in" },
              { operator: "not_in", label: "is not in" },
              { operator: "is", label: "is" }
            ]
          },
          {
            field: "workflow_state",
            inputType: "select",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "in", label: "is in" },
              { operator: "not_in", label: "is not in" },
              { operator: "is", label: "is" }
            ]
          },
          {
            field: "count",
            inputType: "number",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "in", label: "is in" },
              { operator: "not_in", label: "is not in" },
              { operator: "is", label: "is" },
              { operator: "gt", label: "greater than" },
              { operator: "gte", label: "greater than or equal" },
              { operator: "lt", label: "less than" },
              { operator: "lte", label: "less than or equal" },
              { operator: "between", label: "between" },
              { operator: "not_between", label: "not between" }
            ]
          },
          {
            field: "system.docstatus",
            inputType: "select",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "in", label: "is in" },
              { operator: "not_in", label: "is not in" },
              { operator: "is", label: "is" }
            ]
          },
          {
            field: "system.updatedAt",
            inputType: "datetime-local",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "in", label: "is in" },
              { operator: "not_in", label: "is not in" },
              { operator: "is", label: "is" },
              { operator: "gt", label: "greater than" },
              { operator: "gte", label: "greater than or equal" },
              { operator: "lt", label: "less than" },
              { operator: "lte", label: "less than or equal" },
              { operator: "between", label: "between" },
              { operator: "not_between", label: "not between" }
            ]
          }
        ]),
        filterControls: [
          { field: "title", inputType: "text", operator: "contains", queryKey: "filter_title__contains" },
          { field: "title", inputType: "text", operator: "ne", queryKey: "filter_title__ne" },
          { field: "priority", inputType: "select", operator: "eq", queryKey: "filter_priority" },
          { field: "priority", inputType: "select", operator: "ne", queryKey: "filter_priority__ne" },
          { field: "workflow_state", inputType: "select", operator: "eq", queryKey: "filter_workflow_state" },
          { field: "workflow_state", inputType: "select", operator: "ne", queryKey: "filter_workflow_state__ne" },
          { field: "count", inputType: "number", operator: "gte", queryKey: "filter_count__gte" },
          { field: "count", inputType: "number", operator: "lte", queryKey: "filter_count__lte" }
        ],
        pageSize: 25
      }
    });
  });

  it("returns role-filtered workspace metadata", async () => {
    const app = makeWorkspaceApp();

    const listed = await app.request("/api/meta/workspaces", { headers: userHeaders });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json() as {
      readonly data: readonly { readonly sections: readonly { readonly shortcuts: readonly unknown[] }[] }[];
    };
    expect(listedBody).toMatchObject({
      data: [
        {
          name: "Operations",
          sections: [
            {
              name: "main",
              shortcuts: [
                { name: "notes", kind: "doctype", target: "Note" },
                { name: "new-note", kind: "newDoc", target: "Note" },
                { name: "read-only-log", kind: "doctype", target: "ReadOnlyLog" },
                { name: "new-create-only-log", kind: "newDoc", target: "CreateOnlyLog" },
                { name: "open-notes", kind: "report", target: "Open Notes" },
                { name: "ops-dashboard", kind: "dashboard", target: "Operations Dashboard" }
              ]
            }
          ]
        }
      ]
    });
    expect(JSON.stringify(listedBody)).not.toContain("manager-only");
    expect(listedBody.data[0]!.sections[0]!.shortcuts).not.toContainEqual(
      expect.objectContaining({ name: "create-only-log" })
    );
    expect(listedBody.data[0]!.sections[0]!.shortcuts).toContainEqual(
      expect.objectContaining({ name: "new-create-only-log", kind: "newDoc", target: "CreateOnlyLog" })
    );
    expect(JSON.stringify(listedBody)).not.toContain("new-read-only-log");
    expect(JSON.stringify(listedBody)).not.toContain("management-dashboard");
    expect(JSON.stringify(listedBody)).not.toContain("Management Dashboard");
    expect(JSON.stringify(listedBody)).not.toContain("files");
    expect(JSON.stringify(listedBody)).not.toContain("inbox");
    expect(JSON.stringify(listedBody)).not.toContain("users-admin");
    const direct = await app.request("/api/meta/workspaces/Operations", { headers: userHeaders });
    expect(direct.status).toBe(200);
    const directBody = await direct.json() as {
      readonly data: { readonly sections: readonly { readonly shortcuts: readonly unknown[] }[] };
    };
    expect(JSON.stringify(directBody)).not.toContain("manager-only");
    expect(directBody.data.sections[0]!.shortcuts).not.toContainEqual(
      expect.objectContaining({ name: "create-only-log" })
    );
    expect(directBody.data.sections[0]!.shortcuts).toContainEqual(
      expect.objectContaining({ name: "new-create-only-log", kind: "newDoc", target: "CreateOnlyLog" })
    );
    expect(JSON.stringify(directBody)).not.toContain("new-read-only-log");
    expect(JSON.stringify(directBody)).not.toContain("management-dashboard");
    expect(JSON.stringify(directBody)).not.toContain("Management Dashboard");
    expect(JSON.stringify(directBody)).not.toContain("files");
    expect(JSON.stringify(directBody)).not.toContain("inbox");
    expect(JSON.stringify(directBody)).not.toContain("users-admin");

    const hidden = await app.request("/api/meta/workspaces/Managers", { headers: userHeaders });
    expect(hidden.status).toBe(403);
    await expect(hidden.json()).resolves.toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        message: "Actor 'owner@example.com' cannot read workspace 'Managers'"
      }
    });

    const managerList = await app.request("/api/meta/workspaces", { headers: managerHeaders });
    expect(managerList.status).toBe(200);
    await expect(managerList.json()).resolves.toMatchObject({
      data: [{ name: "Managers" }]
    });

    const adminList = await app.request("/api/meta/workspaces", { headers: adminHeaders });
    expect(adminList.status).toBe(200);
    const adminBody = JSON.stringify(await adminList.json());
    expect(adminBody).toContain("manager-only");
    expect(adminBody).toContain("management-dashboard");
    expect(adminBody).toContain("print-settings-admin");
    expect(adminBody).not.toContain("files");
    expect(adminBody).not.toContain("inbox");
    expect(adminBody).not.toContain("users-admin");
  });

  it("protects resolved list-view metadata with DocType read permissions", async () => {
    const { app } = makeLinkedApp();

    const response = await app.request("/api/meta/doctypes/Task/list-view", {
      headers: {
        ...userHeaders,
        "x-cf-frappe-user": "guest",
        "x-cf-frappe-roles": "Guest"
      }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("creates, reads, lists, updates, transitions, submits, cancels, and deletes a resource", async () => {
    const app = makeApp();
    const created = await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Note", body: "Body" })
    });
    expect(created.status).toBe(201);

    const read = await app.request("/api/resource/Note/HTTP%20Note", { headers: userHeaders });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ data: { name: "HTTP Note" } });

    const list = await app.request("/api/resource/Note?limit=5", { headers: userHeaders });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ data: [{ name: "HTTP Note" }] });

    const duplicated = await app.request("/api/resource/Note/HTTP%20Note/duplicate", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        data: { title: "HTTP Note Copy", body: "Copied" },
        expectedVersion: 1
      })
    });
    expect(duplicated.status).toBe(201);
    await expect(duplicated.json()).resolves.toMatchObject({
      data: { name: "HTTP Note Copy", version: 1, docstatus: "draft", data: { body: "Copied" } }
    });

    const updated = await app.request("/api/resource/Note/HTTP%20Note", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Updated", expectedVersion: 1 })
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { version: 2, data: { body: "Updated" } } });

    const transitioned = await app.request("/api/resource/Note/HTTP%20Note/transition/close", {
      method: "POST",
      headers: userHeaders,
      body: "{}"
    });
    expect(transitioned.status).toBe(200);
    await expect(transitioned.json()).resolves.toMatchObject({
      data: { data: { workflow_state: "Closed" } }
    });

    const commanded = await app.request("/api/resource/Note/HTTP%20Note/command/rewriteBody", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ body: "Commanded" })
    });
    expect(commanded.status).toBe(200);
    await expect(commanded.json()).resolves.toMatchObject({
      data: { data: { body: "Commanded" } }
    });

    const submitted = await app.request("/api/resource/Note/HTTP%20Note/submit", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 4 })
    });
    expect(submitted.status).toBe(200);
    await expect(submitted.json()).resolves.toMatchObject({ data: { version: 5, docstatus: "submitted" } });

    const cancelled = await app.request("/api/resource/Note/HTTP%20Note/cancel", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 5 })
    });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({ data: { version: 6, docstatus: "cancelled" } });

    const amended = await app.request("/api/resource/Note/HTTP%20Note/amend", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        data: { title: "HTTP Note Rev 1", body: "Amended" },
        expectedVersion: 6
      })
    });
    expect(amended.status).toBe(201);
    await expect(amended.json()).resolves.toMatchObject({
      data: { name: "HTTP Note Rev 1", version: 1, docstatus: "draft", data: { body: "Amended" } }
    });

    const deleted = await app.request("/api/resource/Note/HTTP%20Note", {
      method: "DELETE",
      headers: {
        ...userHeaders,
        "x-cf-frappe-roles": "Task Manager"
      },
      body: JSON.stringify({ expectedVersion: 6 })
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ data: { docstatus: "deleted" } });
  });

  it("imports CSV resources through generated resource API commands", async () => {
    const app = makeApp();

    const imported = await app.request("/api/resource/Note/import.csv", {
      method: "POST",
      headers: { ...userHeaders, "content-type": "text/csv" },
      body: ["title,priority,count,body", "HTTP Import A,Medium,2,Body A", "HTTP Import B,Low,3,Body B"].join("\n")
    });
    expect(imported.status).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({
      data: {
        doctype: "Note",
        mode: "create",
        total: 2,
        failed: [],
        succeeded: [
          { row: 2, action: "create", name: "HTTP Import A" },
          { row: 3, action: "create", name: "HTTP Import B" }
        ]
      }
    });

    const updated = await app.request("/api/resource/Note/import.csv?mode=update", {
      method: "POST",
      headers: { ...userHeaders, "content-type": "text/csv" },
      body: ["name,expectedVersion,priority,count", "HTTP Import A,1,High,not-a-number"].join("\n")
    });
    expect(updated.status).toBe(207);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        total: 1,
        succeeded: [],
        failed: [{ row: 2, action: "update", name: "HTTP Import A", code: "BAD_REQUEST" }]
      }
    });
  });

  it("downloads generated CSV import templates from effective metadata", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note/import-template.csv", {
      headers: userHeaders
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Note-import-template.csv"');
    await expect(response.text()).resolves.toBe(
      "name,expectedVersion,title,body,priority,count,workflow_state\n,,,,Medium,0,Open"
    );
  });

  it("rejects generated CSV import template downloads without import permission", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note/import-template.csv", {
      headers: {
        ...userHeaders,
        "x-cf-frappe-user": "guest",
        "x-cf-frappe-roles": "Guest"
      }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Actor 'guest' cannot import Note" }
    });
  });

  it("applies clean stale resource merge requests through normal document updates", async () => {
    const services = createServices(["e1", "e2", "e3"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Merge", body: "Base body", priority: "Low" })
    });
    await app.request("/api/resource/Note/HTTP%20Merge", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Remote body", expectedVersion: 1 })
    });

    const response = await app.request("/api/resource/Note/HTTP%20Merge/merge", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        baseVersion: 1,
        patch: { priority: "High" }
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "applied",
        plan: {
          status: "clean",
          baseVersion: 1,
          remoteVersion: 2,
          patch: { priority: "High" }
        },
        document: {
          version: 3,
          data: {
            body: "Remote body",
            priority: "High"
          }
        }
      }
    });
  });

  it("returns structured resource merge conflicts without appending updates", async () => {
    const services = createServices(["e1", "e2", "e3"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Merge Conflict", body: "Base body" })
    });
    await app.request("/api/resource/Note/HTTP%20Merge%20Conflict", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Remote body", expectedVersion: 1 })
    });

    const response = await app.request("/api/resource/Note/HTTP%20Merge%20Conflict/merge", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        baseVersion: 1,
        patch: { body: "Local body" }
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "conflict",
        plan: {
          status: "conflict",
          conflicts: [
            {
              field: "body",
              reason: "remote_changed",
              baseValue: "Base body",
              localValue: "Local body",
              remoteValue: "Remote body"
            }
          ]
        },
        document: {
          version: 2,
          data: { body: "Remote body" }
        }
      }
    });
    await expect(services.store.currentVersion(documentStream("acme", "Note", "HTTP Merge Conflict"))).resolves.toBe(2);
  });

  it("bulk deletes resources with per-document outcomes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Bulk Selected", body: "Selected" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Bulk Stale", body: "Stale" })
    });

    const response = await app.request("/api/resource/Note/delete", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        documents: [
          { name: "HTTP Bulk Selected", expectedVersion: 1 },
          { name: "HTTP Bulk Stale", expectedVersion: 99 },
          { name: "Missing HTTP Bulk" }
        ]
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deleted: [{ name: "HTTP Bulk Selected", snapshot: { docstatus: "deleted" } }],
        failed: [
          { name: "HTTP Bulk Stale", code: "DOCUMENT_CONFLICT", status: 409 },
          { name: "Missing HTTP Bulk", code: "DOCUMENT_NOT_FOUND", status: 404 }
        ]
      }
    });

    const list = await app.request("/api/resource/Note?limit=10", { headers: userHeaders });
    await expect(list.json()).resolves.toMatchObject({ data: [{ name: "HTTP Bulk Stale" }] });
  });

  it("rejects invalid bulk resource delete bodies", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note/delete", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ documents: [] })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "At least one document must be selected" }
    });
  });

  it("bulk submits and cancels resources with per-document outcomes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Bulk Submit Selected", body: "Selected" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Bulk Submit Stale", body: "Stale" })
    });

    const submitted = await app.request("/api/resource/Note/bulk-submit", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        documents: [
          { name: "HTTP Bulk Submit Selected", expectedVersion: 1 },
          { name: "HTTP Bulk Submit Stale", expectedVersion: 99 }
        ]
      })
    });

    expect(submitted.status).toBe(200);
    await expect(submitted.json()).resolves.toMatchObject({
      data: {
        succeeded: [{ name: "HTTP Bulk Submit Selected", snapshot: { docstatus: "submitted", version: 2 } }],
        failed: [{ name: "HTTP Bulk Submit Stale", code: "DOCUMENT_CONFLICT", status: 409 }]
      }
    });

    const cancelled = await app.request("/api/resource/Note/bulk-cancel", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        documents: [
          { name: "HTTP Bulk Submit Selected", expectedVersion: 2 },
          { name: "HTTP Bulk Submit Stale" }
        ]
      })
    });

    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      data: {
        succeeded: [{ name: "HTTP Bulk Submit Selected", snapshot: { docstatus: "cancelled", version: 3 } }],
        failed: [{ name: "HTTP Bulk Submit Stale", code: "DOCUMENT_STATUS_CONFLICT", status: 409 }]
      }
    });
  });

  it("bulk transitions resources with per-document outcomes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Bulk Transition Selected", body: "Selected" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Bulk Transition Stale", body: "Stale" })
    });

    const response = await app.request("/api/resource/Note/bulk-transition/close", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        documents: [
          { name: "HTTP Bulk Transition Selected", expectedVersion: 1 },
          { name: "HTTP Bulk Transition Stale", expectedVersion: 99 }
        ]
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        succeeded: [{ name: "HTTP Bulk Transition Selected", snapshot: { data: { workflow_state: "Closed" } } }],
        failed: [{ name: "HTTP Bulk Transition Stale", code: "DOCUMENT_CONFLICT", status: 409 }]
      }
    });
  });

  it("returns a permissioned resource timeline from the document event stream", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Timeline", body: "Body" })
    });
    await app.request("/api/resource/Note/HTTP%20Timeline", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Updated" })
    });

    const response = await app.request("/api/resource/Note/HTTP%20Timeline/timeline", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        doctype: "Note",
        name: "HTTP Timeline",
        version: 2,
        entries: [
          { sequence: 1, kind: "DocumentCreated", summary: "Created document" },
          {
            sequence: 2,
            kind: "DocumentUpdated",
            summary: "Updated body",
            changes: [{ field: "body", oldValue: "Body", newValue: "Updated" }]
          }
        ]
      }
    });
  });

  it("returns admin-only audit events from the immutable event stream", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Audit", body: "Body" })
    });
    await app.request("/api/resource/Note/HTTP%20Audit", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Updated" })
    });

    const response = await app.request(
      "/api/audit/events?doctype=Note&name=HTTP%20Audit&actor_id=owner%40example.com&kind=DocumentUpdated&limit=5",
      { headers: adminHeaders }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        limit: 5,
        filters: {
          doctype: "Note",
          name: "HTTP Audit",
          actorId: "owner@example.com",
          kind: "DocumentUpdated"
        },
        events: [
          {
            id: "evt_e2",
            actorId: "owner@example.com",
            payload: { kind: "DocumentUpdated", patch: { body: "Updated" } }
          }
        ]
      }
    });
  });

  it("maps audit searches by non-system managers to JSON permission errors", async () => {
    const app = makeApp();

    const response = await app.request("/api/audit/events?doctype=Note", { headers: userHeaders });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("manages event-sourced user permissions through admin API routes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Permission Target", body: "Permission target" })
    });

    const granted = await app.request("/api/user-permissions/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        targetDoctype: "Note",
        targetName: "HTTP Permission Target",
        applicableDoctypes: ["Note"]
      })
    });

    expect(granted.status).toBe(201);
    await expect(granted.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        userId: "owner@example.com",
        version: 1,
        grants: [
          {
            targetDoctype: "Note",
            targetName: "HTTP Permission Target",
            applicableDoctypes: ["Note"]
          }
        ]
      }
    });

    const current = await app.request("/api/user-permissions/owner%40example.com", { headers: adminHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: {
        version: 1,
        grants: [{ targetDoctype: "Note", targetName: "HTTP Permission Target" }]
      }
    });

    const revoked = await app.request("/api/user-permissions/owner%40example.com", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({
        targetDoctype: "Note",
        targetName: "HTTP Permission Target",
        applicableDoctypes: ["Note"],
        expectedVersion: 1
      })
    });

    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({
      data: {
        version: 2,
        grants: []
      }
    });
  });

  it("maps user-permission admin routes to permission and validation errors", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Valid Permission Target", body: "Permission target" })
    });

    const denied = await app.request("/api/user-permissions/owner%40example.com", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ targetDoctype: "Note", targetName: "HTTP Valid Permission Target" })
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const invalid = await app.request("/api/user-permissions/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ targetDoctype: "Note", targetName: "HTTP Valid Permission Target", applicableDoctypes: ["Note", 7] })
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });

    const missingTarget = await app.request("/api/user-permissions/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ targetDoctype: "Note", targetName: "Missing Target" })
    });
    expect(missingTarget.status).toBe(400);
    await expect(missingTarget.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Target document Note/Missing Target does not exist" }
    });
  });

  it("maps cross-tenant audit searches to JSON permission errors", async () => {
    const app = makeApp();

    const response = await app.request("/api/audit/events?tenant=other", { headers: adminHeaders });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("recovers deleted document audit data for system managers", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Deleted Audit", body: "Body" })
    });
    await app.request("/api/resource/Note/HTTP%20Deleted%20Audit", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Before delete", expectedVersion: 1 })
    });
    const deleted = await app.request("/api/resource/Note/HTTP%20Deleted%20Audit", {
      method: "DELETE",
      headers: {
        ...userHeaders,
        "x-cf-frappe-roles": "Task Manager"
      },
      body: JSON.stringify({ expectedVersion: 2 })
    });
    expect(deleted.status).toBe(200);

    const response = await app.request("/api/audit/deleted/Note/HTTP%20Deleted%20Audit", {
      headers: adminHeaders
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        doctype: "Note",
        name: "HTTP Deleted Audit",
        deletedBy: "owner@example.com",
        deleteEventId: "evt_e3",
        snapshot: {
          version: 3,
          docstatus: "deleted",
          data: { body: "Before delete" }
        },
        events: [
          { id: "evt_e1", payload: { kind: "DocumentCreated" } },
          { id: "evt_e2", payload: { kind: "DocumentUpdated" } },
          { id: "evt_e3", payload: { kind: "DocumentDeleted" } }
        ]
      }
    });
  });

  it("adds comments through the resource API and returns them in the timeline", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Commented", body: "Body" })
    });

    const commented = await app.request("/api/resource/Note/HTTP%20Commented/comments", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ text: "Needs one more look", expectedVersion: 1 })
    });

    expect(commented.status).toBe(201);
    await expect(commented.json()).resolves.toMatchObject({ data: { version: 2 } });

    const timeline = await app.request("/api/resource/Note/HTTP%20Commented/timeline", { headers: userHeaders });
    expect(timeline.status).toBe(200);
    await expect(timeline.json()).resolves.toMatchObject({
      data: {
        entries: [
          expect.objectContaining({ kind: "DocumentCreated" }),
          expect.objectContaining({
            kind: "DocumentCommentAdded",
            summary: "Commented: Needs one more look",
            payload: expect.objectContaining({ text: "Needs one more look" })
          })
        ]
      }
    });
  });

  it("records activity feed entries through the resource API and returns them in the timeline", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Activity", body: "Body" })
    });

    const activity = await app.request("/api/resource/Note/HTTP%20Activity/activities", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        activityType: "email",
        subject: "Follow-up sent",
        detail: "Sent to customer@example.com",
        channel: "email",
        externalId: "msg-123",
        expectedVersion: 1
      })
    });

    expect(activity.status).toBe(201);
    await expect(activity.json()).resolves.toMatchObject({ data: { version: 2 } });

    const timeline = await app.request("/api/resource/Note/HTTP%20Activity/timeline", { headers: userHeaders });
    expect(timeline.status).toBe(200);
    await expect(timeline.json()).resolves.toMatchObject({
      data: {
        entries: [
          expect.objectContaining({ kind: "DocumentCreated" }),
          expect.objectContaining({
            kind: "DocumentActivityRecorded",
            summary: "Email: Follow-up sent",
            changes: [],
            payload: {
              kind: "DocumentActivityRecorded",
              activityType: "email",
              subject: "Follow-up sent",
              detail: "Sent to customer@example.com",
              channel: "email",
              externalId: "msg-123"
            }
          })
        ]
      }
    });
  });

  it("assigns and unassigns resources through event-sourced assignment routes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Assigned", body: "Body" })
    });

    const assigned = await app.request("/api/resource/Note/HTTP%20Assigned/assignments", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ assignee: "support@example.com", expectedVersion: 1 })
    });

    expect(assigned.status).toBe(201);
    await expect(assigned.json()).resolves.toMatchObject({ data: { version: 2 } });

    const current = await app.request("/api/resource/Note/HTTP%20Assigned/assignments", { headers: userHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: {
        version: 2,
        assignees: ["support@example.com"]
      }
    });

    const unassigned = await app.request("/api/resource/Note/HTTP%20Assigned/assignments/support%40example.com", {
      method: "DELETE",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 2 })
    });

    expect(unassigned.status).toBe(200);
    await expect(unassigned.json()).resolves.toMatchObject({ data: { version: 3 } });

    const empty = await app.request("/api/resource/Note/HTTP%20Assigned/assignments", { headers: userHeaders });
    await expect(empty.json()).resolves.toMatchObject({ data: { assignees: [] } });
  });

  it("tags and untags resources through event-sourced tag routes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Tagged", body: "Body" })
    });

    const tagged = await app.request("/api/resource/Note/HTTP%20Tagged/tags", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ tag: "Urgent", expectedVersion: 1 })
    });

    expect(tagged.status).toBe(201);
    await expect(tagged.json()).resolves.toMatchObject({ data: { version: 2 } });

    const current = await app.request("/api/resource/Note/HTTP%20Tagged/tags", { headers: userHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: {
        version: 2,
        tags: ["Urgent"]
      }
    });

    const timeline = await app.request("/api/resource/Note/HTTP%20Tagged/timeline", { headers: userHeaders });
    await expect(timeline.json()).resolves.toMatchObject({
      data: {
        entries: [
          expect.objectContaining({ kind: "DocumentCreated" }),
          expect.objectContaining({ kind: "DocumentTagged", summary: "Tagged Urgent", changes: [] })
        ]
      }
    });

    const untagged = await app.request("/api/resource/Note/HTTP%20Tagged/tags/Urgent", {
      method: "DELETE",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 2 })
    });

    expect(untagged.status).toBe(200);
    await expect(untagged.json()).resolves.toMatchObject({ data: { version: 3 } });

    const empty = await app.request("/api/resource/Note/HTTP%20Tagged/tags", { headers: userHeaders });
    await expect(empty.json()).resolves.toMatchObject({ data: { tags: [] } });
  });

  it("follows and unfollows resources through event-sourced follower routes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Followed", body: "Body" })
    });

    const followed = await app.request("/api/resource/Note/HTTP%20Followed/followers", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });

    expect(followed.status).toBe(201);
    await expect(followed.json()).resolves.toMatchObject({ data: { version: 2 } });

    const current = await app.request("/api/resource/Note/HTTP%20Followed/followers", { headers: userHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: {
        version: 2,
        followers: ["owner@example.com"]
      }
    });

    const explicit = await app.request("/api/resource/Note/HTTP%20Followed/followers", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ follower: "amy+ops@example.com", expectedVersion: 2 })
    });

    expect(explicit.status).toBe(201);
    await expect(explicit.json()).resolves.toMatchObject({ data: { version: 3 } });

    const timeline = await app.request("/api/resource/Note/HTTP%20Followed/timeline", { headers: userHeaders });
    await expect(timeline.json()).resolves.toMatchObject({
      data: {
        entries: [
          expect.objectContaining({ kind: "DocumentCreated" }),
          expect.objectContaining({
            kind: "DocumentFollowed",
            summary: "Followed by owner@example.com",
            changes: []
          }),
          expect.objectContaining({
            kind: "DocumentFollowed",
            summary: "Followed by amy+ops@example.com",
            changes: []
          })
        ]
      }
    });

    const explicitUnfollowed = await app.request("/api/resource/Note/HTTP%20Followed/followers/amy%2Bops%40example.com", {
      method: "DELETE",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 3 })
    });

    expect(explicitUnfollowed.status).toBe(200);
    await expect(explicitUnfollowed.json()).resolves.toMatchObject({ data: { version: 4 } });

    const unfollowed = await app.request("/api/resource/Note/HTTP%20Followed/followers/owner%40example.com", {
      method: "DELETE",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 4 })
    });

    expect(unfollowed.status).toBe(200);
    await expect(unfollowed.json()).resolves.toMatchObject({ data: { version: 5 } });

    const empty = await app.request("/api/resource/Note/HTTP%20Followed/followers", { headers: userHeaders });
    await expect(empty.json()).resolves.toMatchObject({ data: { followers: [] } });
  });

  it("shares and revokes resources through event-sourced share routes", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Shared", body: "Body" })
    });

    const deniedBeforeShare = await app.request("/api/resource/Note/HTTP%20Shared", {
      headers: collaboratorHeaders
    });
    expect(deniedBeforeShare.status).toBe(403);

    const shared = await app.request("/api/resource/Note/HTTP%20Shared/shares", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ userId: "collab@example.com", permissions: ["write"], expectedVersion: 1 })
    });

    expect(shared.status).toBe(201);
    await expect(shared.json()).resolves.toMatchObject({ data: { version: 2 } });

    const current = await app.request("/api/resource/Note/HTTP%20Shared/shares", { headers: userHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: {
        version: 2,
        grants: [{ userId: "collab@example.com", permissions: ["read", "update"] }]
      }
    });

    const sharedRead = await app.request("/api/resource/Note/HTTP%20Shared", {
      headers: collaboratorHeaders
    });
    expect(sharedRead.status).toBe(200);
    await expect(sharedRead.json()).resolves.toMatchObject({ data: { name: "HTTP Shared" } });

    const sharedUpdate = await app.request("/api/resource/Note/HTTP%20Shared", {
      method: "PUT",
      headers: collaboratorHeaders,
      body: JSON.stringify({ body: "Updated through share", expectedVersion: 2 })
    });
    expect(sharedUpdate.status).toBe(200);
    await expect(sharedUpdate.json()).resolves.toMatchObject({
      data: { version: 3, data: { body: "Updated through share" } }
    });

    const revoked = await app.request("/api/resource/Note/HTTP%20Shared/shares/collab%40example.com", {
      method: "DELETE",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: 3 })
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ data: { version: 4 } });

    const deniedAfterRevoke = await app.request("/api/resource/Note/HTTP%20Shared", {
      headers: collaboratorHeaders
    });
    expect(deniedAfterRevoke.status).toBe(403);
  });

  it("returns bounded resource timeline pages from query parameters", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Paged", body: "Body" })
    });
    await app.request("/api/resource/Note/HTTP%20Paged", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ body: "Updated" })
    });

    const response = await app.request("/api/resource/Note/HTTP%20Paged/timeline?limit=1", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        limit: 1,
        beforeSequence: 2,
        nextBeforeSequence: 1,
        entries: [{ sequence: 2, kind: "DocumentUpdated" }]
      }
    });
  });

  it("maps unreadable resource timelines to JSON permission errors", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Private", body: "Body" })
    });

    const response = await app.request("/api/resource/Note/HTTP%20Private/timeline", {
      headers: {
        ...userHeaders,
        "x-cf-frappe-user": "other@example.com"
      }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("lists resources with metadata-validated query filters", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP High", priority: "High", body: "Escalated", count: 7 })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Low", priority: "Low", body: "Routine", count: 1 })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Closed High", priority: "High", body: "Closed", count: 3 })
    });
    await app.request("/api/resource/Note/HTTP%20Closed%20High/transition/close", {
      method: "POST",
      headers: userHeaders,
      body: "{}"
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Empty Body", priority: "Low", body: "", count: 4 })
    });

    const response = await app.request("/api/resource/Note?filter_priority=High", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const closed = await app.request(
      "/api/resource/Note?filter_priority=High&filter_workflow_state=Closed",
      { headers: userHeaders }
    );
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toMatchObject({
      data: [{ name: "HTTP Closed High" }],
      total: 1
    });

    const allHigh = await app.request("/api/resource/Note?default_filters=0&filter_priority=High", {
      headers: userHeaders
    });
    expect(allHigh.status).toBe(200);
    const allHighJson = (await allHigh.json()) as { readonly total: number; readonly data: readonly { readonly name: string }[] };
    expect(allHighJson.total).toBe(2);
    expect(allHighJson.data.map((document) => document.name).sort()).toEqual([
      "HTTP Closed High",
      "HTTP High"
    ]);

    const compoundExpression = encodeURIComponent(JSON.stringify({
      kind: "group",
      match: "any",
      filters: [
        { field: "priority", value: "High" },
        { field: "count", operator: "between", value: [1, 1] }
      ]
    }));
    const compound = await app.request(`/api/resource/Note?default_filters=0&filter_expression=${compoundExpression}`, {
      headers: userHeaders
    });
    expect(compound.status).toBe(200);
    const compoundJson = (await compound.json()) as { readonly total: number; readonly data: readonly { readonly name: string }[] };
    expect(compoundJson.total).toBe(3);
    expect(compoundJson.data.map((document) => document.name).sort()).toEqual([
      "HTTP Closed High",
      "HTTP High",
      "HTTP Low"
    ]);

    const membership = await app.request("/api/resource/Note?filter_priority__in=High&filter_priority__in=Low", {
      headers: userHeaders
    });
    expect(membership.status).toBe(200);
    const membershipJson = (await membership.json()) as { readonly total: number; readonly data: readonly { readonly name: string }[] };
    expect(membershipJson.total).toBe(3);
    expect(membershipJson.data.map((document) => document.name).sort()).toEqual([
      "HTTP Empty Body",
      "HTTP High",
      "HTTP Low"
    ]);

    const notIn = await app.request("/api/resource/Note?filter_priority__not_in=Low", {
      headers: userHeaders
    });
    expect(notIn.status).toBe(200);
    await expect(notIn.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const byName = await app.request("/api/resource/Note?filter_system.name__contains=High", {
      headers: userHeaders
    });
    expect(byName.status).toBe(200);
    await expect(byName.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const advanced = await app.request("/api/resource/Note?filter_priority__ne=Low&filter_count__gt=2&filter_count__lt=9", {
      headers: userHeaders
    });
    expect(advanced.status).toBe(200);
    await expect(advanced.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const between = await app.request("/api/resource/Note?filter_count__between=6&filter_count__between=8", {
      headers: userHeaders
    });
    expect(between.status).toBe(200);
    await expect(between.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const notBetween = await app.request("/api/resource/Note?filter_count__not_between=2&filter_count__not_between=6", {
      headers: userHeaders
    });
    expect(notBetween.status).toBe(200);
    const notBetweenJson = (await notBetween.json()) as {
      readonly total: number;
      readonly data: readonly { readonly name: string }[];
    };
    expect(notBetweenJson.total).toBe(2);
    expect(notBetweenJson.data.map((document) => document.name).sort()).toEqual(["HTTP High", "HTTP Low"]);

    const like = await app.request("/api/resource/Note?filter_body__like=Escal%25", {
      headers: userHeaders
    });
    expect(like.status).toBe(200);
    await expect(like.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const notLike = await app.request("/api/resource/Note?filter_priority=High&filter_body__not_like=%25Routine%25", {
      headers: userHeaders
    });
    expect(notLike.status).toBe(200);
    await expect(notLike.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });

    const set = await app.request("/api/resource/Note?filter_body__is=set", {
      headers: userHeaders
    });
    expect(set.status).toBe(200);
    const setJson = (await set.json()) as { readonly total: number; readonly data: readonly { readonly name: string }[] };
    expect(setJson.total).toBe(3);
    expect(setJson.data.map((document) => document.name).sort()).toEqual([
      "HTTP Empty Body",
      "HTTP High",
      "HTTP Low"
    ]);

    const explicitEmpty = await app.request("/api/resource/Note?default_filters=0&filter_body=&empty_filter=filter_body", {
      headers: userHeaders
    });
    expect(explicitEmpty.status).toBe(200);
    await expect(explicitEmpty.json()).resolves.toMatchObject({
      data: [{ name: "HTTP Empty Body" }],
      total: 1
    });

    const explicitEmptyCsv = await app.request("/api/resource/Note/export.csv?default_filters=0&filter_body=&empty_filter=filter_body", {
      headers: userHeaders
    });
    expect(explicitEmptyCsv.status).toBe(200);
    expect(explicitEmptyCsv.headers.get("x-cf-frappe-export-total")).toBe("1");
    expect(explicitEmptyCsv.headers.get("x-cf-frappe-exported")).toBe("1");
    await expect(explicitEmptyCsv.text()).resolves.toBe([
      "Name,title,priority,workflow_state,Version,Updated",
      "HTTP Empty Body,HTTP Empty Body,Low,Open,1,2026-01-01T00:00:00.000Z"
    ].join("\n"));

    const ordered = await app.request("/api/resource/Note?default_filters=0&order_by=count&order=asc", {
      headers: userHeaders
    });
    expect(ordered.status).toBe(200);
    const orderedJson = (await ordered.json()) as { readonly data: readonly { readonly name: string }[] };
    expect(orderedJson.data.map((document) => document.name)).toEqual([
      "HTTP Low",
      "HTTP Closed High",
      "HTTP Empty Body",
      "HTTP High"
    ]);

    const csv = await app.request("/api/resource/Note/export.csv?default_filters=0&filter_priority=High&order_by=count&order=asc", {
      headers: userHeaders
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Note.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-exported")).toBe("2");
    expect(csv.headers.get("x-cf-frappe-export-truncated")).toBe("false");
    await expect(csv.text()).resolves.toBe([
      "Name,title,priority,workflow_state,Version,Updated",
      "HTTP Closed High,HTTP Closed High,High,Closed,2,2026-01-01T00:00:00.000Z",
      "HTTP High,HTTP High,High,Open,1,2026-01-01T00:00:00.000Z"
    ].join("\n"));
  });

  it("lists resources with presence filters for missing fields", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Body Set", priority: "High", body: "Visible" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Body Missing", priority: "Medium" })
    });

    const response = await app.request("/api/resource/Note?filter_body__is=not+set", {
      headers: userHeaders
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "HTTP Body Missing" }],
      total: 1
    });
  });

  it("keeps equality filters for fields ending with operator suffixes", async () => {
    const app = makeFilterCollisionApp();
    await app.request("/api/resource/FilterCollision", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        title: "Collision Match",
        count__between: 7,
        count__not_between: 7,
        body__is: "literal",
        title__like: "literal"
      })
    });
    await app.request("/api/resource/FilterCollision", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        title: "Collision Miss",
        count__between: 3,
        count__not_between: 3,
        body__is: "other",
        title__like: "other"
      })
    });

    const response = await app.request("/api/resource/FilterCollision?filter_count__between=7", {
      headers: userHeaders
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Collision Match" }],
      total: 1
    });

    const notBetweenCollision = await app.request("/api/resource/FilterCollision?filter_count__not_between=7", {
      headers: userHeaders
    });
    expect(notBetweenCollision.status).toBe(200);
    await expect(notBetweenCollision.json()).resolves.toMatchObject({
      data: [{ name: "Collision Match" }],
      total: 1
    });

    const presenceCollision = await app.request("/api/resource/FilterCollision?filter_body__is=literal", {
      headers: userHeaders
    });
    expect(presenceCollision.status).toBe(200);
    await expect(presenceCollision.json()).resolves.toMatchObject({
      data: [{ name: "Collision Match" }],
      total: 1
    });

    const patternCollision = await app.request("/api/resource/FilterCollision?filter_title__like=literal", {
      headers: userHeaders
    });
    expect(patternCollision.status).toBe(200);
    await expect(patternCollision.json()).resolves.toMatchObject({
      data: [{ name: "Collision Match" }],
      total: 1
    });
  });

  it("saves and applies resource list filters through the API", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "API High", priority: "High", body: "High", count: 7 })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "API Low", priority: "Low", body: "Low", count: 1 })
    });

    const saved = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "High or low API notes",
        filters: [
          { field: "priority", operator: "in", value: ["High", "Low"] },
          { field: "count", operator: "between", value: [1, 7] },
          { field: "count", operator: "not_between", value: [3, 6] },
          { field: "body", operator: "is", value: "set" },
          { field: "body", operator: "like", value: "%High%" }
        ]
      })
    });

    expect(saved.status).toBe(201);
    const savedJson = await saved.json() as { data: { id: string; label: string } };
    expect(savedJson.data).toMatchObject({ label: "High or low API notes" });

    const filtered = await app.request(`/api/resource/Note?saved_filter=${savedJson.data.id}`, {
      headers: userHeaders
    });
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({
      total: 1
    });

    const expressionSaved = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Expression API notes",
        filters: [],
        filterExpression: {
          kind: "group",
          match: "any",
          filters: [
            { field: "priority", value: "High" },
            { field: "count", operator: "lte", value: 1 }
          ]
        }
      })
    });
    expect(expressionSaved.status).toBe(201);
    const expressionSavedJson = await expressionSaved.json() as { data: { id: string; filterExpression: unknown } };
    expect(expressionSavedJson.data.filterExpression).toMatchObject({
      kind: "group",
      match: "any"
    });
    const expressionFiltered = await app.request(`/api/resource/Note?saved_filter=${expressionSavedJson.data.id}`, {
      headers: userHeaders
    });
    expect(expressionFiltered.status).toBe(200);
    const expressionFilteredJson = await expressionFiltered.json() as {
      readonly total: number;
      readonly data: readonly { readonly name: string }[];
    };
    expect(expressionFilteredJson.total).toBe(2);
    expect(expressionFilteredJson.data.map((document) => document.name).sort()).toEqual(["API High", "API Low"]);

    const listed = await app.request("/api/resource/Note/saved-filters", { headers: userHeaders });
    const listedJson = await listed.json() as { readonly data: readonly { readonly id: string }[] };
    expect(listedJson.data.map((filter) => filter.id).sort()).toEqual([
      expressionSavedJson.data.id,
      savedJson.data.id
    ].sort());

    const deleted = await app.request(`/api/resource/Note/saved-filters/${savedJson.data.id}`, {
      method: "DELETE",
      headers: userHeaders
    });
    expect(deleted.status).toBe(204);
  });

  it("maps disabled resource saved-filter queries to bad requests", async () => {
    const services = createServices(["e1"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver
    });

    const response = await app.request("/api/resource/Note?saved_filter=missing", { headers: userHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: "Saved filters are not enabled"
      }
    });
  });

  it("maps invalid resource list filters to JSON bad requests", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note?filter_missing=x", { headers: userHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Filter field 'missing' is not defined on Note" }
    });

    const malformedExpression = await app.request("/api/resource/Note?filter_expression=not-json", {
      headers: userHeaders
    });
    expect(malformedExpression.status).toBe(400);
    await expect(malformedExpression.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Filter expression must be valid JSON" }
    });

    const overDeepExpression = encodeURIComponent(deepListFilterExpressionJson(6000));
    const overDeep = await app.request(`/api/resource/Note?filter_expression=${overDeepExpression}`, {
      headers: userHeaders
    });
    expect(overDeep.status).toBe(400);
    await expect(overDeep.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "List filter expression cannot exceed 5 levels" }
    });

    const invalidOrder = await app.request("/api/resource/Note?order=sideways", { headers: userHeaders });
    expect(invalidOrder.status).toBe(400);
    await expect(invalidOrder.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "List order must be asc or desc" }
    });

    const invalidSavedFilter = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid membership",
        filters: [{ field: "priority", operator: "in", value: "High" }]
      })
    });
    expect(invalidSavedFilter.status).toBe(400);
    await expect(invalidSavedFilter.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Saved filter membership value must be a non-empty scalar array" }
    });

    const invalidRangeSavedFilter = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid range",
        filters: [{ field: "count", operator: "between", value: [1] }]
      })
    });
    expect(invalidRangeSavedFilter.status).toBe(400);
    await expect(invalidRangeSavedFilter.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Saved filter range value must be a two-item scalar array" }
    });

    const overDeepSavedFilter = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: `{"label":"Too deep","filterExpression":${deepListFilterExpressionJson(6000)}}`
    });
    expect(overDeepSavedFilter.status).toBe(400);
    await expect(overDeepSavedFilter.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "List filter expression cannot exceed 5 levels" }
    });

    const emptyRangeSavedFilter = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Empty range",
        filters: [{ field: "count", operator: "between", value: [" ", 8] }]
      })
    });
    expect(emptyRangeSavedFilter.status).toBe(400);
    await expect(emptyRangeSavedFilter.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Filter 'count' range values cannot be empty" }
    });

    const invalidPresenceSavedFilter = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid presence",
        filters: [{ field: "body", operator: "is", value: "present" }]
      })
    });
    expect(invalidPresenceSavedFilter.status).toBe(400);
    await expect(invalidPresenceSavedFilter.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Saved filter presence value must be set or not set" }
    });

    const invalidExpressionSavedFilter = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "Invalid expression",
        filters: [],
        filterExpression: { kind: "group", match: "all", filters: [] }
      })
    });
    expect(invalidExpressionSavedFilter.status).toBe(400);
    await expect(invalidExpressionSavedFilter.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "List filter group must include at least one filter" }
    });
  });

  it("serves permissioned metadata-driven global search", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Search Launch", body: "Visible" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: {
        ...userHeaders,
        "x-cf-frappe-user": "other@example.com"
      },
      body: JSON.stringify({ title: "HTTP Search Launch Secret", body: "Hidden" })
    });

    const response = await app.request("/api/search?q=launch&limit=5", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        query: "launch",
        total: 1,
        data: [
          {
            doctype: "Note",
            name: "HTTP Search Launch",
            label: "HTTP Search Launch",
            matchedField: "name",
            route: "/desk/Note/HTTP%20Search%20Launch"
          }
        ]
      }
    });
  });

  it("returns link field options from projected target documents", async () => {
    const { app, services } = makeLinkedApp();
    await services.documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await services.documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });

    const response = await app.request("/api/link-options/Task/project?q=apo", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        doctype: "Task",
        field: "project",
        target: "Project",
        options: [{ value: "Apollo", label: "Apollo" }]
      }
    });
  });

  it("rejects explicit names for series-named resources", async () => {
    const { app } = makeSeriesApp();

    const response = await app.request("/api/resource/Support%20Ticket", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ name: "MANUAL-1", subject: "Manual" })
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        issues: [expect.objectContaining({ field: "name", code: "name" })]
      }
    });
  });

  it("maps invalid link option fields to JSON bad requests", async () => {
    const { app } = makeLinkedApp();

    const response = await app.request("/api/link-options/Task/title", { headers: userHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Field 'title' on Task is not a link field" }
    });
  });

  it("maps validation errors to JSON error responses", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "No" })
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        issues: [expect.objectContaining({ field: "title" })]
      }
    });
  });

  it("maps malformed JSON to a bad request instead of a 500", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: "{"
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Request body contains malformed JSON" }
    });
  });

  it("rejects invalid expectedVersion values", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Note", body: "Body" })
    });

    const response = await app.request("/api/resource/Note/HTTP%20Note", {
      method: "PUT",
      headers: userHeaders,
      body: JSON.stringify({ expectedVersion: "one", body: "Updated" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "expectedVersion must be an integer" }
    });
  });

  it("rejects JSON bodies beyond the configured limit", async () => {
    const app = makeAppWithBodyLimit(8);

    const response = await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "Too Large" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "JSON body exceeds 8 bytes" }
    });
  });

  it("maps permission errors to JSON error responses", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note", {
      method: "POST",
      headers: {
        ...userHeaders,
        "x-cf-frappe-user": "guest",
        "x-cf-frappe-roles": "Guest"
      },
      body: JSON.stringify({ title: "Guest Note" })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });
});
