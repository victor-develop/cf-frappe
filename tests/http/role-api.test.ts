import {
  RoleService,
  SYSTEM_MANAGER_ROLE,
  createResourceApi,
  deterministicIds,
  fixedClock,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("role api", () => {
  it("manages the tenant role catalog through admin JSON routes", async () => {
    const { app } = makeRoleApp();

    const empty = await app.request("/api/roles", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ data: { tenantId: "acme", version: 0, roles: [] } });

    const created = await app.request("/api/roles/Support%20Lead", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ description: "Escalation owner", enabled: true, expectedVersion: 0 })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        version: 1,
        roles: [{ name: "Support Lead", description: "Escalation owner", enabled: true, version: 1 }]
      }
    });

    const described = await app.request("/api/roles/Support%20Lead/description", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ description: "Owns escalations", expectedVersion: 1 })
    });
    expect(described.status).toBe(200);
    await expect(described.json()).resolves.toMatchObject({
      data: { version: 2, roles: [{ name: "Support Lead", description: "Owns escalations" }] }
    });

    const disabled = await app.request("/api/roles/Support%20Lead/disable", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 2 })
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      data: { version: 3, roles: [{ name: "Support Lead", enabled: false }] }
    });

    const role = await app.request("/api/roles/Support%20Lead", { headers: adminHeaders });
    expect(role.status).toBe(200);
    await expect(role.json()).resolves.toMatchObject({
      data: { name: "Support Lead", description: "Owns escalations", enabled: false, version: 3 }
    });
  });

  it("maps role API validation and permission failures to JSON errors", async () => {
    const { app } = makeRoleApp(60);

    const denied = await app.request("/api/roles", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const deniedWrite = await app.request("/api/roles/Support", {
      method: "POST",
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" },
      body: JSON.stringify({ enabled: "yes" })
    });
    expect(deniedWrite.status).toBe(403);
    await expect(deniedWrite.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const invalidBody = await app.request("/api/roles/Support", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ enabled: "yes" })
    });
    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "enabled must be a boolean" }
    });

    const oversized = await app.request("/api/roles/Support", {
      method: "POST",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeRoleApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["e1"], {
    savedFilterIds: ["sf1", "sfe1"],
    savedReportIds: ["sr1", "sre1"]
  });
  const roles = new RoleService({
    events: services.events,
    ids: deterministicIds(["role-1", "describe-1", "disable-1", "enable-1"]),
    clock: fixedClock(now)
  });
  return {
    services,
    roles,
    app: createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      roles,
      maxJsonBytes
    })
  };
}
