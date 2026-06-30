import {
  authorizeRoleAdministration,
  ensureRoleDoesNotExist,
  ensureRoleExpectedVersion,
  ensureRoleServiceAvailable,
  existingRole,
  normalizeRequiredRoleName,
  planRoleDescriptionChange,
  planRoleStatusChange,
  resolveRoleTenant
} from "../../src/application/role-policy.js";
import { SYSTEM_MANAGER_ROLE } from "../../src/core/types.js";
import type { RoleCatalogState } from "../../src/core/roles.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

describe("role policy", () => {
  it("guards Desk role service availability", () => {
    expect(() => ensureRoleServiceAvailable({ list: async () => [] })).not.toThrow();

    let error: unknown;
    try {
      ensureRoleServiceAvailable(undefined);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      message: "Roles are not enabled",
      status: 404
    });
  });

  it("resolves role tenants within the actor tenant boundary", () => {
    expect(resolveRoleTenant({ actor: admin })).toBe("acme");
    expect(resolveRoleTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveRoleTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage roles for tenant 'globex'"
    );
  });

  it("authorizes only configured role administrators", () => {
    expect(authorizeRoleAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeRoleAdministration({
        actor: { id: "security@example.com", roles: ["Security Admin"], tenantId: "acme" },
        adminRoles: ["Security Admin"]
      })
    ).toBe("acme");
    expect(() => authorizeRoleAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })).toThrow(
      "Actor 'owner@example.com' cannot manage roles"
    );
  });

  it("normalizes role names and rejects invalid catalog keys", () => {
    expect(normalizeRequiredRoleName("  Support   Lead  ")).toBe("Support Lead");
    expect(() => normalizeRequiredRoleName(" ")).toThrow("Role name is required");
    expect(() => normalizeRequiredRoleName("Support/Lead")).toThrow("Role name cannot contain '/'");
  });

  it("finds existing roles and rejects missing roles", () => {
    expect(existingRole(state(2), "Support Lead")).toMatchObject({ name: "Support Lead", enabled: true });
    expect(() => existingRole(state(2), "Missing")).toThrow("Role 'Missing' was not found");
  });

  it("plans role description changes without emitting redundant catalog events", () => {
    const role = existingRole(state(2), "Support Lead");
    const roleWithoutDescription = {
      name: role.name,
      version: role.version,
      enabled: role.enabled
    };

    expect(planRoleDescriptionChange(role, "Handles escalations")).toEqual({ status: "noop" });
    expect(planRoleDescriptionChange(role, "Owns escalations")).toEqual({ status: "append" });
    expect(planRoleDescriptionChange(roleWithoutDescription, undefined)).toEqual({ status: "noop" });
    expect(planRoleDescriptionChange(role, undefined)).toEqual({ status: "append" });
  });

  it("plans role status changes without emitting redundant catalog events", () => {
    const role = existingRole(state(2), "Support Lead");

    expect(planRoleStatusChange(role, true)).toEqual({ status: "noop" });
    expect(planRoleStatusChange(role, false)).toEqual({ status: "append" });
  });

  it("guards role uniqueness and expected catalog versions", () => {
    expect(() => ensureRoleDoesNotExist(state(1), "New Role")).not.toThrow();
    expect(() => ensureRoleDoesNotExist(state(1), "Support Lead")).toThrow("Role 'Support Lead' already exists");
    expect(() => ensureRoleExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureRoleExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureRoleExpectedVersion(state(2), 1)).toThrow("Expected role catalog at version 1, found 2");
  });
});

function state(version: number): RoleCatalogState {
  return {
    tenantId: "acme",
    version,
    roles: [
      {
        name: "Support Lead",
        version: 1,
        enabled: true,
        description: "Handles escalations"
      }
    ]
  };
}
