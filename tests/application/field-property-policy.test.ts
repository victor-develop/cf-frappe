import {
  authorizeFieldPropertyAdministration,
  ensureFieldPropertyExpectedVersion,
  fieldPropertyOverridesEqual,
  findFieldPropertyOverride,
  normalizeRequiredFieldPropertyText,
  replaceFieldPropertyOverride,
  requireFieldPropertyField,
  resolveFieldPropertyTenant
} from "../../src/application/field-property-policy.js";
import { SYSTEM_MANAGER_ROLE, type FieldPropertyOverrides } from "../../src/core/types.js";
import type { FieldPropertyOverrideState } from "../../src/core/field-property-overrides.js";
import { noteDocType } from "../helpers";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

describe("field property policy", () => {
  it("resolves field-property tenants within the actor tenant boundary", () => {
    expect(resolveFieldPropertyTenant({ actor: admin })).toBe("acme");
    expect(resolveFieldPropertyTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveFieldPropertyTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage field properties for tenant 'globex'"
    );
  });

  it("authorizes only configured field-property administrators", () => {
    expect(authorizeFieldPropertyAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeFieldPropertyAdministration({
        actor: { id: "metadata@example.com", roles: ["Metadata Admin"], tenantId: "acme" },
        adminRoles: ["Metadata Admin"]
      })
    ).toBe("acme");
    expect(() =>
      authorizeFieldPropertyAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage field properties");
  });

  it("normalizes required text and resolves fields", () => {
    expect(normalizeRequiredFieldPropertyText(" priority ", "Field name")).toBe("priority");
    expect(() => normalizeRequiredFieldPropertyText(" ", "Field name")).toThrow("Field name is required");
    expect(() => normalizeRequiredFieldPropertyText(1 as unknown as string, "Field name")).toThrow(
      "Field name must be a string"
    );
    expect(requireFieldPropertyField(noteDocType, " priority ")).toMatchObject({ name: "priority" });
    expect(() => requireFieldPropertyField(noteDocType, "missing")).toThrow(
      "Field 'missing' is not defined on Note"
    );
  });

  it("guards expected field-property versions", () => {
    expect(() => ensureFieldPropertyExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureFieldPropertyExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureFieldPropertyExpectedVersion(state(2), 1)).toThrow(
      "Expected field property overrides at version 1, found 2"
    );
  });

  it("finds and compares field-property overrides", () => {
    expect(findFieldPropertyOverride(state(1), "priority")).toMatchObject({ overrides: { label: "Urgency" } });
    expect(findFieldPropertyOverride(state(1), "missing")).toBeUndefined();
    expect(fieldPropertyOverridesEqual({ label: "Urgency" }, { label: "Urgency" })).toBe(true);
    expect(fieldPropertyOverridesEqual({ label: "Urgency" }, { label: "Priority" })).toBe(false);
  });

  it("projects pending override state while preserving create timestamps", () => {
    const projected = replaceFieldPropertyOverride(
      state(1),
      "priority",
      { label: "Severity", inListFilter: true },
      "2026-01-02T00:00:00.000Z"
    );
    expect(projected.fields).toEqual([
      {
        tenantId: "acme",
        doctype: "Note",
        fieldName: "priority",
        overrides: { label: "Severity", inListFilter: true },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      }
    ]);

    const added = replaceFieldPropertyOverride(projected, "title", { description: "Visible title" }, "2026-01-03T00:00:00.000Z");
    expect(added.fields.map((entry) => entry.fieldName)).toEqual(["priority", "title"]);
  });
});

function state(version: number): FieldPropertyOverrideState {
  return {
    tenantId: "acme",
    doctype: "Note",
    version,
    fields: [
      {
        tenantId: "acme",
        doctype: "Note",
        fieldName: "priority",
        overrides: { label: "Urgency" } satisfies FieldPropertyOverrides,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}
