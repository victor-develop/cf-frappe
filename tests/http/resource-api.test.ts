import { createResourceApi, unsafeHeaderActorResolver } from "../../src";
import { createLinkedServices, createSeriesServices, createServices, owner } from "../helpers";

describe("resource api", () => {
  function makeApp() {
    const services = createServices(["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    return createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      timeline: services.history,
      savedFilters: services.savedFilters,
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

  const userHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "owner@example.com",
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
          { sequence: 2, kind: "DocumentUpdated", summary: "Updated body" }
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
      body: JSON.stringify({ title: "HTTP High", priority: "High", body: "Escalated" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Low", priority: "Low", body: "Routine" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "HTTP Closed High", priority: "High", workflow_state: "Closed", body: "Closed" })
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
  });

  it("saves and applies resource list filters through the API", async () => {
    const app = makeApp();
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "API High", priority: "High", body: "High" })
    });
    await app.request("/api/resource/Note", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "API Low", priority: "Low", body: "Low" })
    });

    const saved = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        label: "High API notes",
        filters: [{ field: "priority", value: "High" }]
      })
    });

    expect(saved.status).toBe(201);
    const savedJson = await saved.json() as { data: { id: string; label: string } };
    expect(savedJson.data).toMatchObject({ label: "High API notes" });

    const filtered = await app.request(`/api/resource/Note?saved_filter=${savedJson.data.id}`, {
      headers: userHeaders
    });
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({
      data: [{ name: "API High" }],
      total: 1
    });

    const listed = await app.request("/api/resource/Note/saved-filters", { headers: userHeaders });
    await expect(listed.json()).resolves.toMatchObject({ data: [{ id: savedJson.data.id }] });

    const deleted = await app.request(`/api/resource/Note/saved-filters/${savedJson.data.id}`, {
      method: "DELETE",
      headers: userHeaders
    });
    expect(deleted.status).toBe(204);
  });

  it("maps invalid resource list filters to JSON bad requests", async () => {
    const app = makeApp();

    const response = await app.request("/api/resource/Note?filter_missing=x", { headers: userHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Filter field 'missing' is not defined on Note" }
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
