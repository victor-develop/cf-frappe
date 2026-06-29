import {
  authorizeUserPermissionAdministration,
  ensureUserPermissionExpectedVersion,
  normalizeUserPermissionRequiredText,
  normalizeValidUserPermissionGrant,
  resolveUserPermissionTenant
} from "../../src/application/user-permission-policy.js";
import { SYSTEM_MANAGER_ROLE } from "../../src/core/types.js";
import type { UserPermissionState } from "../../src/core/user-permissions.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

describe("user permission policy", () => {
  it("resolves permission tenants within the actor tenant boundary", () => {
    expect(resolveUserPermissionTenant({ actor: admin })).toBe("acme");
    expect(resolveUserPermissionTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveUserPermissionTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage user permissions for tenant 'globex'"
    );
  });

  it("authorizes only configured admin roles for user permission administration", () => {
    expect(authorizeUserPermissionAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeUserPermissionAdministration({
        actor: { id: "support@example.com", roles: ["Support Manager"], tenantId: "acme" },
        adminRoles: ["Support Manager"]
      })
    ).toBe("acme");
    expect(() =>
      authorizeUserPermissionAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage user permissions");
  });

  it("normalizes required user permission text", () => {
    expect(normalizeUserPermissionRequiredText(" owner@example.com ", "User id")).toBe("owner@example.com");
    expect(() => normalizeUserPermissionRequiredText(" ", "User id")).toThrow("User id is required");
  });

  it("normalizes valid linked-record grants and rejects missing targets", () => {
    expect(
      normalizeValidUserPermissionGrant({
        targetDoctype: " Project ",
        targetName: " Apollo ",
        applicableDoctypes: [" Task ", "Issue", "Task"]
      })
    ).toEqual({
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Issue", "Task"]
    });
    expect(() => normalizeValidUserPermissionGrant({ targetDoctype: " ", targetName: "Apollo" })).toThrow(
      "Target DocType is required"
    );
    expect(() => normalizeValidUserPermissionGrant({ targetDoctype: "Project", targetName: " " })).toThrow(
      "Target name is required"
    );
  });

  it("guards expected user permission versions", () => {
    expect(() => ensureUserPermissionExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureUserPermissionExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureUserPermissionExpectedVersion(state(2), 1)).toThrow(
      "Expected user permissions for 'owner@example.com' at version 1, found 2"
    );
  });
});

function state(version: number): UserPermissionState {
  return {
    tenantId: "acme",
    userId: owner.id,
    version,
    grants: [{ targetDoctype: "Project", targetName: "Apollo" }]
  };
}
