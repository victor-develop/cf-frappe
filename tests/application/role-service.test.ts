import {
  RoleService,
  SYSTEM_MANAGER_ROLE,
  deterministicIds,
  fixedClock,
  roleCatalogStream
} from "../../src";
import { createServices, now, owner } from "../helpers";
import type { DocumentEventPayload, RoleEventPayload } from "../../src";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("RoleService", () => {
  it("registers role catalog payloads through the domain event extension map", () => {
    const payload = rolePayload({
      kind: "RoleCreated",
      role: "Support Lead",
      enabled: true,
      description: "Handles escalations"
    });

    expect(payload.role).toBe("Support Lead");
  });

  it("creates, updates, disables, and enables roles as catalog events", async () => {
    const { events } = createServices(["unused"]);
    const roles = new RoleService({
      events,
      ids: deterministicIds(["create-1", "describe-1", "disable-1", "enable-1"]),
      clock: fixedClock(now)
    });

    const created = await roles.create({
      actor: admin,
      role: "  Support   Lead ",
      description: " Handles escalations ",
      expectedVersion: 0
    });
    const described = await roles.changeDescription({
      actor: admin,
      role: "Support Lead",
      description: "Owns support escalations",
      expectedVersion: 1
    });
    const disabled = await roles.disable({ actor: admin, role: "Support Lead", expectedVersion: 2 });
    const duplicateDisable = await roles.disable({ actor: admin, role: "Support Lead", expectedVersion: 3 });
    const enabled = await roles.enable({ actor: admin, role: "Support Lead", expectedVersion: 3 });

    expect(created).toMatchObject({
      tenantId: "acme",
      version: 1,
      roles: [{ name: "Support Lead", description: "Handles escalations", enabled: true, version: 1 }]
    });
    expect(described).toMatchObject({
      version: 2,
      roles: [{ name: "Support Lead", description: "Owns support escalations", enabled: true, version: 2 }]
    });
    expect(disabled).toMatchObject({
      version: 3,
      roles: [{ name: "Support Lead", description: "Owns support escalations", enabled: false, version: 3 }]
    });
    expect(duplicateDisable.version).toBe(3);
    expect(enabled).toMatchObject({
      version: 4,
      roles: [{ name: "Support Lead", enabled: true, version: 4 }]
    });
    await expect(roles.get(admin, "Support Lead")).resolves.toMatchObject({
      name: "Support Lead",
      enabled: true,
      version: 4
    });
    await expect(events.readStream(roleCatalogStream("acme"))).resolves.toMatchObject([
      { id: "evt_create-1", type: "RoleCreated", payload: { kind: "RoleCreated", role: "Support Lead" } },
      { id: "evt_describe-1", type: "RoleDescriptionChanged", payload: { kind: "RoleDescriptionChanged" } },
      { id: "evt_disable-1", type: "RoleDisabled", payload: { kind: "RoleDisabled" } },
      { id: "evt_enable-1", type: "RoleEnabled", payload: { kind: "RoleEnabled" } }
    ]);
  });

  it("requires role administrators and current catalog versions", async () => {
    const { events } = createServices(["unused"]);
    const roles = new RoleService({
      events,
      ids: deterministicIds(["create-1"]),
      clock: fixedClock(now)
    });

    await expect(roles.list(owner)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      roles.create({ actor: admin, tenantId: "globex", role: "Support", expectedVersion: 0 })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(roles.create({ actor: admin, role: " ", expectedVersion: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
    await expect(roles.create({ actor: admin, role: "Bad/Role", expectedVersion: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
    await expect(roles.create({ actor: admin, role: "Support", expectedVersion: 1 })).rejects.toMatchObject({
      code: "DOCUMENT_CONFLICT"
    });
    await expect(roles.get(admin, "Missing")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
});

function rolePayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "RoleCreated" }>
): Extract<RoleEventPayload, { readonly kind: "RoleCreated" }> {
  return payload;
}
