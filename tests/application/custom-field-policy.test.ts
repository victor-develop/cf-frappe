import {
  assertCustomFieldDefaultValueValid,
  authorizeCustomFieldAdministration,
  customFieldsEqual,
  ensureCustomFieldExpectedVersion,
  normalizeCustomField,
  normalizeCustomFieldExpressions,
  normalizeRequiredCustomFieldText,
  projectPendingCustomFieldState,
  resequenceCustomFieldEventsForFold,
  resolveCustomFieldTenant,
  withSavedCustomFieldCatalogEvents,
  type CustomFieldEventSet
} from "../../src/application/custom-field-policy.js";
import { customFieldSavedPayload } from "../../src/application/custom-field-events.js";
import { customFieldsCatalogStream } from "../../src/core/streams.js";
import { SYSTEM_MANAGER_ROLE, type DomainEvent } from "../../src/core/types.js";
import type { CustomFieldState } from "../../src/core/custom-fields.js";
import { noteDocType } from "../helpers";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

describe("custom field policy", () => {
  it("resolves custom-field tenants within the actor tenant boundary", () => {
    expect(resolveCustomFieldTenant({ actor: admin })).toBe("acme");
    expect(resolveCustomFieldTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveCustomFieldTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage custom fields for tenant 'globex'"
    );
  });

  it("authorizes only configured custom-field administrators", () => {
    expect(authorizeCustomFieldAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeCustomFieldAdministration({
        actor: { id: "metadata@example.com", roles: ["Metadata Admin"], tenantId: "acme" },
        adminRoles: ["Metadata Admin"]
      })
    ).toBe("acme");
    expect(() =>
      authorizeCustomFieldAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage custom fields");
  });

  it("normalizes required text and custom field definitions before persistence", () => {
    expect(normalizeRequiredCustomFieldText(" priority ", "Custom field name")).toBe("priority");
    expect(() => normalizeRequiredCustomFieldText(" ", "Custom field name")).toThrow("Custom field name is required");
    expect(() => normalizeRequiredCustomFieldText(1 as unknown as string, "Custom field name")).toThrow(
      "Custom field name must be a string"
    );

    const inputDefault = { nested: { enabled: true } };
    const normalized = normalizeCustomField({
      name: " priority ",
      label: " Priority ",
      description: " Visible in queues ",
      placeholder: " Pick one ",
      type: "select",
      options: [" Low ", "High"],
      linkTo: " ",
      fetchFrom: " project.priority ",
      defaultValue: inputDefault
    });

    inputDefault.nested.enabled = false;
    expect(normalized).toEqual({
      name: "priority",
      label: "Priority",
      description: "Visible in queues",
      placeholder: "Pick one",
      type: "select",
      options: ["Low", "High"],
      fetchFrom: "project.priority",
      defaultValue: { nested: { enabled: true } }
    });
  });

  it("rejects invalid custom field options, bounds, and default snapshots", () => {
    expect(() => normalizeCustomField({ name: "priority", type: "text", options: ["Low"] })).toThrow(
      "Only select custom fields can define options"
    );
    expect(() => normalizeCustomField({ name: "priority", type: "select", options: ["Low", " Low "] })).toThrow(
      "options contains duplicate 'Low'"
    );
    expect(() => normalizeCustomField({ name: "score", type: "number", min: 10, max: 1 })).toThrow(
      "Custom field 'score' min cannot exceed max"
    );
    expect(() => normalizeCustomField({ name: "json_payload", type: "json", defaultValue: () => "bad" })).toThrow(
      "Custom field 'json_payload' defaultValue must be JSON-serializable"
    );
  });

  it("normalizes expressions and validates custom field defaults against the composed DocType", () => {
    const normalized = normalizeCustomFieldExpressions(
      noteDocType,
      normalizeCustomField({
        name: "approval_note",
        type: "text",
        mandatoryDependsOn: { field: "title", operator: "eq", value: "Needs approval" }
      })
    );

    expect(normalized.mandatoryDependsOn).toEqual({ field: "title", value: "Needs approval" });
    expect(() =>
      assertCustomFieldDefaultValueValid(
        noteDocType,
        normalizeCustomField({ name: "reviewed", type: "boolean", defaultValue: "yes" })
      )
    ).toThrow("Field 'reviewed' must be a boolean");
  });

  it("guards expected versions and compares persisted field definitions", () => {
    expect(() => ensureCustomFieldExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureCustomFieldExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureCustomFieldExpectedVersion(state(2), 1)).toThrow(
      "Expected custom fields for 'Note' at version 1, found 2"
    );
    expect(customFieldsEqual({ name: "priority", type: "text" }, { name: "priority", type: "text" })).toBe(true);
    expect(customFieldsEqual({ name: "priority", type: "text" }, { type: "text", name: "priority" })).toBe(false);
  });

  it("projects pending custom field state while preserving created timestamps", () => {
    const projectState = state(1, "Project");
    const projected = projectPendingCustomFieldState(
      "acme",
      [state(1), projectState],
      "Note",
      normalizeCustomField({ name: "priority", type: "select", options: ["Low", "High"] }),
      "2026-01-02T00:00:00.000Z"
    );

    expect(projected[0]?.fields).toEqual([
      {
        tenantId: "acme",
        doctype: "Note",
        field: { name: "priority", type: "select", options: ["Low", "High"] },
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      }
    ]);
    expect(projected[1]).toBe(projectState);
  });

  it("replays event sets deterministically after catalog appends", () => {
    const catalogEvent = event(4, "priority");
    const saved = [event(7, "reviewed")];
    const eventSet: CustomFieldEventSet = {
      catalog: [catalogEvent],
      legacy: [event(12, "legacy")],
      catalogVersion: 4
    };

    expect(resequenceCustomFieldEventsForFold([eventSet.legacy[0]!, eventSet.catalog[0]!]).map((item) => item.sequence))
      .toEqual([1, 2]);
    expect(withSavedCustomFieldCatalogEvents(eventSet, saved)).toMatchObject({
      catalog: [catalogEvent, saved[0]],
      catalogVersion: 7
    });
  });
});

function state(version: number, doctype = "Note"): CustomFieldState {
  return {
    tenantId: "acme",
    doctype,
    version,
    fields: [
      {
        tenantId: "acme",
        doctype,
        field: { name: "priority", type: "text" },
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}

function event(sequence: number, fieldName: string): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: customFieldsCatalogStream("acme"),
    sequence,
    type: "CustomFieldSaved",
    doctype: "__CustomFields",
    documentName: fieldName,
    actorId: admin.id,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: customFieldSavedPayload({
      doctypeName: "Note",
      field: normalizeCustomField({ name: fieldName, type: "text" })
    }),
    metadata: {}
  };
}
