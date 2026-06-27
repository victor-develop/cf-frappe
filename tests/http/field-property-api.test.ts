import {
  createResourceApi,
  deterministicIds,
  DocumentService,
  FieldPropertyService,
  fixedClock,
  QueryService,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver,
  type DocTypeDefinition
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": `${SYSTEM_MANAGER_ROLE},User`,
  "x-cf-frappe-tenant": "acme"
};

describe("field property api", () => {
  it("manages tenant field property overrides through generated JSON routes", async () => {
    const { app } = makeFieldPropertyApp();

    const empty = await app.request("/api/field-properties/Note", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", doctype: "Note", version: 0, fields: [] }
    });

    const saved = await app.request("/api/field-properties/Note/priority", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        overrides: {
          label: "Urgency",
          description: "Pick the operational urgency.",
          noCopy: true,
          allowOnSubmit: true,
          options: ["Low", "High"],
          defaultValue: "High",
          inListFilter: true
        }
      })
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      data: {
        version: 1,
        fields: [
          {
            fieldName: "priority",
            overrides: {
              label: "Urgency",
              description: "Pick the operational urgency.",
              noCopy: true,
              allowOnSubmit: true,
              options: ["Low", "High"]
            }
          }
        ]
      }
    });

    const meta = await app.request("/api/meta/doctypes/Note", { headers: adminHeaders });
    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: {
        fields: expect.arrayContaining([
          expect.objectContaining({
            name: "priority",
            label: "Urgency",
            description: "Pick the operational urgency.",
            noCopy: true,
            allowOnSubmit: true,
            options: ["Low", "High"]
          })
        ])
      }
    });

    const cleared = await app.request("/api/field-properties/Note/priority", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ data: { version: 2, fields: [] } });
  });

  it("maps validation, conflict, and permission failures to JSON errors", async () => {
    const { app } = makeFieldPropertyApp();

    const denied = await app.request("/api/field-properties/Note", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const missingOverrides = await app.request("/api/field-properties/Note/priority", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0 })
    });
    expect(missingOverrides.status).toBe(400);
    await expect(missingOverrides.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "overrides must be an object" }
    });

    const invalidOverride = await app.request("/api/field-properties/Note/body", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ overrides: { options: ["A", "B"] } })
    });
    expect(invalidOverride.status).toBe(400);
    await expect(invalidOverride.json()).resolves.toMatchObject({ error: { code: "FIELD_PROPERTY_INVALID" } });

    const created = await app.request("/api/field-properties/Note/priority", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0, overrides: { label: "Urgency" } })
    });
    expect(created.status).toBe(200);

    const stale = await app.request("/api/field-properties/Note/body", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0, overrides: { label: "Details" } })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_CONFLICT" } });

    const { app: oversizedApp } = makeFieldPropertyApp(80);
    const oversized = await oversizedApp.request("/api/field-properties/Note/priority", {
      method: "PUT",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeFieldPropertyApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["note-1", "note-2"]);
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
  return {
    services: { ...services, documents, queries, fieldProperties },
    app: createResourceApi({
      registry: services.registry,
      documents,
      queries,
      actor: unsafeHeaderActorResolver,
      fieldProperties,
      maxJsonBytes
    })
  };
}
