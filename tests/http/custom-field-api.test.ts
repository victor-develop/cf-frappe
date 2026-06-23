import {
  createResourceApi,
  CustomFieldService,
  deterministicIds,
  fixedClock,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("custom field api", () => {
  it("manages tenant custom fields through generated JSON routes", async () => {
    const { app } = makeCustomFieldApp();

    const empty = await app.request("/api/custom-fields/Note", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ data: { tenantId: "acme", doctype: "Note", version: 0, fields: [] } });

    const created = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        field: {
          name: "reviewed",
          label: "Reviewed",
          type: "boolean",
          inListView: true,
          defaultValue: false
        },
        expectedVersion: 0
      })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        version: 1,
        fields: [
          {
            field: { name: "reviewed", label: "Reviewed", type: "boolean", inListView: true, defaultValue: false },
            enabled: true
          }
        ]
      }
    });

    const current = await app.request("/api/custom-fields/Note", { headers: adminHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: { version: 1, fields: [{ field: { name: "reviewed" }, enabled: true }] }
    });

    const disabled = await app.request("/api/custom-fields/Note/reviewed", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      data: { version: 2, fields: [{ field: { name: "reviewed" }, enabled: false }] }
    });
  });

  it("maps custom-field validation, conflict, and permission failures to JSON errors", async () => {
    const { app } = makeCustomFieldApp(80);

    const denied = await app.request("/api/custom-fields/Note", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const deniedWrite = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" },
      body: JSON.stringify({ field: { name: "bad", type: "currency" } })
    });
    expect(deniedWrite.status).toBe(403);
    await expect(deniedWrite.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const invalidField = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ field: { name: "bad", type: "currency" } })
    });
    expect(invalidField.status).toBe(400);
    await expect(invalidField.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "field.type is invalid" }
    });

    const missingField = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0 })
    });
    expect(missingField.status).toBe(400);
    await expect(missingField.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "field must be an object" }
    });

    const created = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ field: { name: "reviewed", type: "boolean" }, expectedVersion: 0 })
    });
    expect(created.status).toBe(201);

    const stale = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ field: { name: "second_review", type: "boolean" }, expectedVersion: 0 })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_CONFLICT" } });

    const oversized = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeCustomFieldApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["e1"]);
  const customFields = new CustomFieldService({
    registry: services.registry,
    events: services.store,
    ids: deterministicIds(["field-1", "disable-1", "field-2"]),
    clock: fixedClock(now)
  });
  return {
    services,
    customFields,
    app: createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      customFields,
      maxJsonBytes
    })
  };
}
