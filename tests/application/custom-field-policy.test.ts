import {
  assertCustomFieldDefaultValueValid,
  assertCustomFieldReferencesResolve,
  assertCustomFieldRuntimeSupported,
  assertCustomTableFieldDoesNotSelfTarget,
  assertCustomTableGraphAcyclicFrom,
  authorizeCustomFieldAdministration,
  customFieldsEqual,
  ensureCustomFieldExpectedVersion,
  findCustomFieldEntry,
  normalizeCustomField,
  normalizeCustomFieldExpressions,
  normalizeRequiredCustomFieldText,
  planCustomFieldDisable,
  planCustomFieldSave,
  projectPendingCustomFieldState,
  resequenceCustomFieldEventsForFold,
  resolveCustomFieldTenant,
  withSavedCustomFieldCatalogEvents,
  type CustomFieldEventSet
} from "../../src/application/custom-field-policy.js";
import { customFieldSavedPayload } from "../../src/application/custom-field-events.js";
import { customFieldsCatalogStream } from "../../src/core/streams.js";
import { defineDocType } from "../../src/core/schema.js";
import { SYSTEM_MANAGER_ROLE, type DocTypeDefinition, type DomainEvent, type FieldDefinition } from "../../src/core/types.js";
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

  it("plans custom field saves without emitting redundant catalog events", () => {
    const existing = findCustomFieldEntry(state(1), "priority");

    expect(planCustomFieldSave(existing, normalizeCustomField({ name: "priority", type: "text" }))).toEqual({
      status: "noop"
    });
    expect(planCustomFieldSave(existing, normalizeCustomField({ name: "priority", type: "number" }))).toEqual({
      status: "append"
    });
    expect(planCustomFieldSave(undefined, normalizeCustomField({ name: "priority", type: "text" }))).toEqual({
      status: "append"
    });
    expect(planCustomFieldSave(disabledFieldEntry(), normalizeCustomField({ name: "priority", type: "text" }))).toEqual({
      status: "append"
    });
  });

  it("plans custom field disables without emitting redundant or missing-field events", () => {
    expect(planCustomFieldDisable(findCustomFieldEntry(state(1), "priority"), "priority")).toEqual({
      status: "append"
    });
    expect(planCustomFieldDisable(disabledFieldEntry(), "priority")).toEqual({ status: "noop" });
    expect(planCustomFieldDisable(findCustomFieldEntry(state(1), "missing"), "missing")).toEqual({
      status: "missing",
      message: "Custom field 'missing' was not found",
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("shapes missing custom-field disable errors before service error mapping", () => {
    expect(planCustomFieldDisable(undefined, "archived_reason")).toEqual({
      status: "missing",
      message: "Custom field 'archived_reason' was not found",
      code: "DOCUMENT_NOT_FOUND"
    });
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

  it("validates custom-field link and table targets through an injected DocType lookup", () => {
    const hasDocType = (name: string) => name === "Project";

    expect(() => assertCustomFieldReferencesResolve({ name: "project", type: "link", linkTo: "Project" }, hasDocType))
      .not.toThrow();
    expect(() => assertCustomFieldReferencesResolve({ name: "project", type: "link", linkTo: "Missing" }, hasDocType))
      .toThrow("Custom field 'project' links to unknown DocType 'Missing'");
    expect(() => assertCustomFieldReferencesResolve({ name: "items", type: "table", tableOf: "Missing" }, hasDocType))
      .toThrow("Custom field 'items' targets unknown child DocType 'Missing'");
  });

  it("guards unsupported custom table-field runtime shapes", () => {
    expect(() => assertCustomFieldRuntimeSupported({ name: "project", type: "link", linkTo: "Project" })).not.toThrow();
    expect(() => assertCustomFieldRuntimeSupported({ name: "items", type: "table", inListFilter: true })).toThrow(
      "Custom table field 'items' cannot be a list filter"
    );
    expect(() =>
      assertCustomTableFieldDoesNotSelfTarget({ name: "Note" }, { name: "children", type: "table", tableOf: "Note" })
    ).toThrow("Custom table field 'children' cannot target its own DocType 'Note'");
  });

  it("detects recursive base table graphs without service state", () => {
    const Invoice = doctype("Invoice", [{ name: "items", type: "table", tableOf: "Invoice Item" }]);
    const InvoiceItem = doctype("Invoice Item", [{ name: "parents", type: "table", tableOf: "Invoice" }]);

    expect(() => assertCustomTableGraphAcyclicFrom("Invoice", [Invoice, InvoiceItem], [])).toThrow(
      "Table field 'parents' on DocType 'Invoice Item' creates recursive table path Invoice -> Invoice Item -> Invoice"
    );
  });

  it("detects recursive enabled custom table graphs and ignores disabled entries", () => {
    const Note = doctype("Note", []);
    const Project = doctype("Project", []);
    const cyclicStates = [
      stateWithFields("Note", [{ name: "projects", type: "table", tableOf: "Project" }]),
      stateWithFields("Project", [{ name: "notes", type: "table", tableOf: "Note" }])
    ];

    expect(() =>
      assertCustomTableGraphAcyclicFrom("Note", [Note, Project], cyclicStates, {
        doctype: "Project",
        field: { name: "notes", type: "table", tableOf: "Note" }
      })
    ).toThrow("Custom table field 'notes' creates recursive table path Note -> Project -> Note");
    expect(() =>
      assertCustomTableGraphAcyclicFrom("Note", [Note, Project], [
        stateWithFields("Note", [{ name: "projects", type: "table", tableOf: "Project" }]),
        stateWithFields("Project", [{ name: "notes", type: "table", tableOf: "Note" }], false)
      ])
    ).not.toThrow();
  });
});

function doctype(name: string, fields: readonly FieldDefinition[]): DocTypeDefinition {
  return defineDocType({
    name,
    fields
  });
}

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

function disabledFieldEntry(): NonNullable<ReturnType<typeof findCustomFieldEntry>> {
  return {
    ...state(1).fields[0]!,
    enabled: false
  };
}

function stateWithFields(
  doctype: string,
  fields: readonly FieldDefinition[],
  enabled = true
): CustomFieldState {
  return {
    tenantId: "acme",
    doctype,
    version: fields.length,
    fields: fields.map((field, index) => ({
      tenantId: "acme",
      doctype,
      field: normalizeCustomField(field),
      enabled,
      createdAt: `2026-01-01T00:00:0${index}.000Z`,
      updatedAt: `2026-01-01T00:00:0${index}.000Z`
    }))
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
