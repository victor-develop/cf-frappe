import {
  authorizeFieldPropertyAdministration,
  ensureFieldPropertyExpectedVersion,
  fieldPropertyEventDocumentName,
  fieldPropertyOverridesEqual,
  findFieldPropertyOverride,
  normalizeFieldPropertyOverrideExpressions,
  normalizeFieldPropertyOverrides,
  normalizeRequiredFieldPropertyText,
  replaceFieldPropertyOverride,
  requireFieldPropertyField,
  resolveFieldPropertyTenant
} from "../../src/application/field-property-policy.js";
import {
  fieldPropertyOverrideClearedPayload,
  fieldPropertyOverrideSavedPayload
} from "../../src/application/field-property-events.js";
import { SYSTEM_MANAGER_ROLE, type FieldDefinition, type FieldPropertyOverrides } from "../../src/core/types.js";
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

  it("normalizes field property override values before service persistence", () => {
    const normalized = normalizeFieldPropertyOverrides(field("priority"), {
      label: " Urgency ",
      description: " ",
      required: true,
      fetchFrom: " project.priority ",
      inListFilter: true,
      options: [" Low ", "High"],
      defaultValue: { tone: "warm" }
    });

    expect(normalized).toEqual({
      label: "Urgency",
      required: true,
      fetchFrom: "project.priority",
      inListFilter: true,
      options: ["Low", "High"],
      defaultValue: { tone: "warm" }
    });
  });

  it("rejects invalid field property override shapes and values", () => {
    expect(() => normalizeFieldPropertyOverrides(field("priority"), [] as unknown as FieldPropertyOverrides)).toThrow(
      "Field property overrides must be an object"
    );
    expect(() => normalizeFieldPropertyOverrides(field("priority"), {})).toThrow(
      "At least one field property override is required"
    );
    expect(() =>
      normalizeFieldPropertyOverrides(field("priority"), { required: "yes" as unknown as boolean })
    ).toThrow("required must be a boolean");
    expect(() => normalizeFieldPropertyOverrides(field("title"), { min: 10, max: 3 })).toThrow(
      "Field 'title' min cannot exceed max"
    );
  });

  it("guards select options and table list filters in field property overrides", () => {
    expect(normalizeFieldPropertyOverrides(field("priority"), { options: [" Low ", " Medium "] })).toEqual({
      options: ["Low", "Medium"]
    });
    expect(() => normalizeFieldPropertyOverrides(field("title"), { options: ["Low"] })).toThrow(
      "Only select fields can override options"
    );
    expect(() => normalizeFieldPropertyOverrides(field("priority"), { options: ["Low", " Low "] })).toThrow(
      "options contains duplicate 'Low'"
    );
    expect(() =>
      normalizeFieldPropertyOverrides({ name: "children", type: "table" }, { inListFilter: true })
    ).toThrow("Table field 'children' cannot be a list filter");
  });

  it("clones JSON default values and rejects non-json defaults", () => {
    const defaultValue = { nested: { enabled: true } };
    const normalized = normalizeFieldPropertyOverrides(field("body"), { defaultValue });

    expect(normalized.defaultValue).toEqual(defaultValue);
    expect(normalized.defaultValue).not.toBe(defaultValue);
    expect(() =>
      normalizeFieldPropertyOverrides(field("body"), { defaultValue: (() => "nope") as unknown as null })
    ).toThrow("Field 'body' defaultValue must be JSON-serializable");
  });

  it("rebounds conditional expressions from the effective DocType after overrides apply", () => {
    const effective = {
      ...noteDocType,
      fields: noteDocType.fields.map((item) =>
        item.name === "priority"
          ? {
              ...item,
              mandatoryDependsOn: { field: "title", operator: "contains" as const, value: "urgent" },
              readOnlyDependsOn: { field: "count", operator: "gt" as const, value: 3 },
              hiddenDependsOn: { field: "workflow_state", value: "Closed" }
            } satisfies FieldDefinition
          : item
      )
    };

    expect(
      normalizeFieldPropertyOverrideExpressions(effective, "priority", {
        mandatoryDependsOn: { field: "title", value: "raw" },
        readOnlyDependsOn: { field: "count", value: 1 },
        hiddenDependsOn: { field: "workflow_state", value: "Open" }
      })
    ).toEqual({
      mandatoryDependsOn: { field: "title", operator: "contains", value: "urgent" },
      readOnlyDependsOn: { field: "count", operator: "gt", value: 3 },
      hiddenDependsOn: { field: "workflow_state", value: "Closed" }
    });
    expect(() => normalizeFieldPropertyOverrideExpressions(effective, "missing", { label: "Missing" })).toThrow(
      "Field 'missing' was not normalized on Note"
    );
  });

  it("selects field-property event document names from payload shape", () => {
    expect(
      fieldPropertyEventDocumentName(
        fieldPropertyOverrideSavedPayload({
          doctypeName: "Note",
          fieldName: "priority",
          overrides: { label: "Urgency" }
        })
      )
    ).toBe("priority");
    expect(
      fieldPropertyEventDocumentName(
        fieldPropertyOverrideClearedPayload({
          doctypeName: "Note",
          fieldName: "priority"
        })
      )
    ).toBe("priority");
  });
});

function field(name: string): FieldDefinition {
  const match = noteDocType.fields.find((item) => item.name === name);
  if (!match) {
    throw new Error(`Missing field ${name}`);
  }
  return match;
}

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
