import { createResourceApi, SYSTEM_MANAGER_ROLE, unsafeHeaderActorResolver } from "../../src";
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
        filterBuilderFields: [
          {
            field: "title",
            inputType: "text",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "contains", label: "contains" }
            ]
          },
          {
            field: "priority",
            inputType: "select",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" }
            ]
          },
          {
            field: "workflow_state",
            inputType: "select",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" }
            ]
          },
          {
            field: "count",
            inputType: "number",
            operators: [
              { operator: "eq", label: "equals" },
              { operator: "ne", label: "is not" },
              { operator: "gt", label: "greater than" },
              { operator: "gte", label: "greater than or equal" },
              { operator: "lt", label: "less than" },
              { operator: "lte", label: "less than or equal" }
            ]
          }
        ],
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
      body: JSON.stringify({ title: "HTTP Closed High", priority: "High", workflow_state: "Closed", body: "Closed", count: 3 })
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

    const advanced = await app.request("/api/resource/Note?filter_priority__ne=Low&filter_count__gt=2&filter_count__lt=9", {
      headers: userHeaders
    });
    expect(advanced.status).toBe(200);
    await expect(advanced.json()).resolves.toMatchObject({
      data: [{ name: "HTTP High" }],
      total: 1
    });
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
