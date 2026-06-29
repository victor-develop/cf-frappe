import {
  authorizeUserProfileAccess,
  ensureUserProfileExpectedVersion,
  normalizeUserProfilePatchInput,
  normalizeUserProfileRequiredText,
  planUserProfilePatchChange,
  resolveUserProfileTenant
} from "../../src/application/user-profile-policy.js";
import { SYSTEM_MANAGER_ROLE } from "../../src/core/types.js";
import type { UserProfileState } from "../../src/core/user-profiles.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

describe("user profile policy", () => {
  it("resolves profile tenants within the actor tenant boundary", () => {
    expect(resolveUserProfileTenant({ actor: owner, action: "access user profiles" })).toBe("acme");
    expect(resolveUserProfileTenant({ actor: { id: "guest@example.com", roles: [] }, action: "access user profiles" }))
      .toBe("default");
    expect(() =>
      resolveUserProfileTenant({ actor: owner, tenantId: "globex", action: "access user profiles" })
    ).toThrow("Actor 'owner@example.com' cannot access user profiles for tenant 'globex'");
  });

  it("normalizes required profile text", () => {
    expect(normalizeUserProfileRequiredText("  owner@example.com  ", "User id")).toBe("owner@example.com");
    expect(() => normalizeUserProfileRequiredText(" ", "User id")).toThrow("User id is required");
  });

  it("authorizes self and admin profile access", () => {
    expect(authorizeUserProfileAccess({ actor: owner, userId: " owner@example.com ", adminRoles: [SYSTEM_MANAGER_ROLE] }))
      .toBe("acme");
    expect(authorizeUserProfileAccess({ actor: admin, userId: owner.id, adminRoles: [SYSTEM_MANAGER_ROLE] }))
      .toBe("acme");
    expect(() =>
      authorizeUserProfileAccess({
        actor: { id: "other@example.com", roles: ["User"], tenantId: "acme" },
        userId: owner.id,
        adminRoles: [SYSTEM_MANAGER_ROLE]
      })
    ).toThrow("Actor 'other@example.com' cannot access user profile 'owner@example.com'");
  });

  it("normalizes profile patches and converts profile codec errors to bad requests", () => {
    expect(
      normalizeUserProfilePatchInput({
        fullName: " Ada Lovelace ",
        phone: "",
        bio: undefined
      })
    ).toEqual({
      fullName: "Ada Lovelace",
      phone: null
    });
    expect(() => normalizeUserProfilePatchInput({ unknown: "ignored" })).toThrow(
      "Unknown user profile field 'unknown'"
    );
    expect(() => normalizeUserProfilePatchInput({ fullName: 1 })).toThrow(
      "User profile field 'fullName' must be a string"
    );
  });

  it("plans profile patch writes only when normalized patch data is present", () => {
    expect(planUserProfilePatchChange({})).toEqual({ status: "noop" });
    expect(planUserProfilePatchChange({ fullName: "Ada Lovelace" })).toEqual({ status: "write" });
  });

  it("guards expected profile versions", () => {
    expect(() => ensureUserProfileExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureUserProfileExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureUserProfileExpectedVersion(state(2), 1)).toThrow(
      "Expected user profile 'owner@example.com' at version 1, found 2"
    );
  });
});

function state(version: number): UserProfileState {
  return {
    tenantId: "acme",
    userId: owner.id,
    version,
    profile: { fullName: "Ada Lovelace" }
  };
}
