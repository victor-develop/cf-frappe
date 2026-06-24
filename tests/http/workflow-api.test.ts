import {
  createResourceApi,
  deterministicIds,
  DocumentService,
  fixedClock,
  QueryService,
  SavedListFilterService,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver,
  WorkflowService,
  type DocTypeDefinition
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": `${SYSTEM_MANAGER_ROLE},User`,
  "x-cf-frappe-tenant": "acme"
};

describe("workflow api", () => {
  it("manages tenant workflow definitions through generated JSON routes", async () => {
    const { app } = makeWorkflowApp();

    const empty = await app.request("/api/workflows/Note", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", doctypeName: "Note", version: 0 }
    });

    const saved = await app.request("/api/workflows/Note", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        workflow: {
          initialState: "Open",
          states: ["Open", "Closed"],
          transitions: [
            { action: "approve", from: "Open", to: "Closed", roles: ["User"], eventType: "NoteApproved" }
          ]
        }
      })
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      data: {
        version: 1,
        workflow: { transitions: [{ action: "approve", eventType: "NoteApproved" }] }
      }
    });

    const meta = await app.request("/api/meta/doctypes/Note", { headers: adminHeaders });
    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: { workflow: { transitions: [{ action: "approve" }] } }
    });

    const cleared = await app.request("/api/workflows/Note", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({
      data: { version: 2 }
    });
  });

  it("maps workflow validation, conflict, and permission failures to JSON errors", async () => {
    const { app } = makeWorkflowApp();

    const denied = await app.request("/api/workflows/Note", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const missingWorkflow = await app.request("/api/workflows/Note", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0 })
    });
    expect(missingWorkflow.status).toBe(400);
    await expect(missingWorkflow.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "workflow must be an object" }
    });

    const invalidWorkflow = await app.request("/api/workflows/Note", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        workflow: {
          stateField: "missing_state",
          initialState: "Open",
          states: ["Open", "Closed"],
          transitions: [{ action: "approve", from: "Open", to: "Closed" }]
        }
      })
    });
    expect(invalidWorkflow.status).toBe(400);
    await expect(invalidWorkflow.json()).resolves.toMatchObject({
      error: { code: "WORKFLOW_INVALID" }
    });

    const created = await app.request("/api/workflows/Note", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        workflow: {
          initialState: "Open",
          states: ["Open", "Closed"],
          transitions: [{ action: "approve", from: "Open", to: "Closed" }]
        }
      })
    });
    expect(created.status).toBe(200);

    const stale = await app.request("/api/workflows/Note", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        workflow: {
          initialState: "Open",
          states: ["Open", "Closed"],
          transitions: [{ action: "review", from: "Open", to: "Closed" }]
        }
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_CONFLICT" } });

    const { app: oversizedApp } = makeWorkflowApp(80);
    const oversized = await oversizedApp.request("/api/workflows/Note", {
      method: "PUT",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeWorkflowApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["note-1", "note-2"]);
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
    ids: deterministicIds(["doc-1", "doc-2"]),
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
    ids: deterministicIds(["saved-filter-1", "saved-filter-event-1"]),
    clock: fixedClock(now)
  });
  return {
    services: { ...services, documents, queries, savedFilters, workflows },
    app: createResourceApi({
      registry: services.registry,
      documents,
      queries,
      savedFilters,
      actor: unsafeHeaderActorResolver,
      workflows,
      maxJsonBytes
    })
  };
}
