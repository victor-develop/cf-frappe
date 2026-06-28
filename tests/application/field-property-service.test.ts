import {
  AuditService,
  createRegistry,
  CustomFieldService,
  deterministicIds,
  DocumentService,
  fieldPropertyOverridesStream,
  FieldPropertyService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  SYSTEM_MANAGER_ROLE,
  type DocumentEventPayload,
  type DocTypeDefinition
} from "../../src";
import type { FieldPropertyEventPayload } from "../../src";
import { data, noteDocType, now, owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE, "User"],
  tenantId: "acme"
};

describe("FieldPropertyService", () => {
  it("registers field property payloads through the domain event extension map", () => {
    const payload = fieldPropertyPayload({
      kind: "FieldPropertyOverrideSaved",
      doctypeName: "Note",
      fieldName: "priority",
      overrides: { label: "Urgency" }
    });

    expect(payload.overrides.label).toBe("Urgency");
  });

  it("saves, clears, and audits field property override events", async () => {
    const events = new InMemoryDocumentStore();
    const service = new FieldPropertyService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events,
      ids: deterministicIds(["property-1", "property-2"]),
      clock: fixedClock(now)
    });

    const saved = await service.save({
      actor: admin,
      doctype: "Note",
      fieldName: "priority",
      overrides: { label: "Urgency", options: ["Low", "High"], defaultValue: "High", inListFilter: true },
      expectedVersion: 0
    });
    const repeated = await service.save({
      actor: admin,
      doctype: "Note",
      fieldName: "priority",
      overrides: { label: "Urgency", options: ["Low", "High"], defaultValue: "High", inListFilter: true },
      expectedVersion: 1
    });
    const cleared = await service.clear({ actor: admin, doctype: "Note", fieldName: "priority", expectedVersion: 1 });

    expect(saved).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      version: 1,
      fields: [{ fieldName: "priority", overrides: { label: "Urgency", options: ["Low", "High"] } }]
    });
    expect(repeated.version).toBe(1);
    expect(cleared).toMatchObject({ version: 2, fields: [] });
    await expect(events.readStream(fieldPropertyOverridesStream("acme"))).resolves.toMatchObject([
      { id: "evt_property-1", payload: { kind: "FieldPropertyOverrideSaved", fieldName: "priority" } },
      { id: "evt_property-2", payload: { kind: "FieldPropertyOverrideCleared", fieldName: "priority" } }
    ]);
    await expect(new AuditService({ events }).search(admin, { kind: "FieldPropertyOverrideSaved" })).resolves.toMatchObject({
      events: [{ payload: { kind: "FieldPropertyOverrideSaved", overrides: { label: "Urgency" } } }]
    });
  });

  it("requires admin authority, tenant ownership, expected versions, and valid field metadata", async () => {
    const service = new FieldPropertyService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["property-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.save({ actor: owner, doctype: "Note", fieldName: "priority", overrides: { label: "Urgency" } })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.save({
        actor: admin,
        tenantId: "globex",
        doctype: "Note",
        fieldName: "priority",
        overrides: { label: "Urgency" }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.save({
        actor: admin,
        doctype: "Note",
        fieldName: "priority",
        expectedVersion: 1,
        overrides: { label: "Urgency" }
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(
      service.save({ actor: admin, doctype: "Note", fieldName: "body", overrides: { options: ["A", "B"] } })
    ).rejects.toMatchObject({ code: "FIELD_PROPERTY_INVALID" });
    await expect(
      service.save({
        actor: admin,
        doctype: "Note",
        fieldName: "priority",
        overrides: { options: ["Low"], defaultValue: "Medium" }
      })
    ).rejects.toMatchObject({ code: "FIELD_PROPERTY_INVALID" });
  });

  it("can override and clear fields introduced by upstream custom-field overlays", async () => {
    const events = new InMemoryDocumentStore();
    const registry = createRegistry({ doctypes: [noteDocType] });
    const customFields = new CustomFieldService({
      registry,
      events,
      ids: deterministicIds(["custom-field-1"]),
      clock: fixedClock(now)
    });
    const fieldProperties = new FieldPropertyService({
      registry,
      events,
      ids: deterministicIds(["property-1", "property-2"]),
      clock: fixedClock(now),
      prePropertyDocTypeResolver: (base, context) => customFields.effectiveDocType(base.name, context.tenantId)
    });

    await customFields.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "reviewed", type: "boolean", inListView: true }
    });
    await fieldProperties.save({
      actor: admin,
      doctype: "Note",
      fieldName: "reviewed",
      overrides: { label: "Reviewed?", inListFilter: true, defaultValue: false }
    });

    await expect(fieldProperties.effectiveDocType("Note", "acme")).resolves.toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ name: "reviewed", label: "Reviewed?", inListFilter: true, defaultValue: false })
      ])
    });
    await expect(
      fieldProperties.clear({ actor: admin, doctype: "Note", fieldName: "reviewed", expectedVersion: 1 })
    ).resolves.toMatchObject({ version: 2, fields: [] });
    const effectiveAfterClear = await fieldProperties.effectiveDocType("Note", "acme");
    const reviewed = effectiveAfterClear.fields.find((field) => field.name === "reviewed");
    expect(reviewed).toMatchObject({ name: "reviewed", inListView: true });
    expect(reviewed).not.toHaveProperty("inListFilter");
    expect(reviewed).not.toHaveProperty("defaultValue");
  });

  it("normalizes field-property dependency expressions before persisting metadata events", async () => {
    const service = new FieldPropertyService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["property-1"]),
      clock: fixedClock(now)
    });

    const saved = await service.save({
      actor: admin,
      doctype: "Note",
      fieldName: "body",
      overrides: {
        mandatoryDependsOn: { field: "title", operator: "eq", value: "Required" },
        readOnlyDependsOn: { field: "title", operator: "contains", value: "Closed" },
        hiddenDependsOn: { field: "title", operator: "eq", value: "Hidden" }
      }
    });

    expect(saved.fields[0]?.overrides.mandatoryDependsOn).toEqual({ field: "title", value: "Required" });
    expect(saved.fields[0]?.overrides.readOnlyDependsOn).toEqual({
      field: "title",
      operator: "contains",
      value: "Closed"
    });
    expect(saved.fields[0]?.overrides.hiddenDependsOn).toEqual({ field: "title", value: "Hidden" });
  });

  it("rejects non-serializable field-property default values before persisting metadata events", async () => {
    const service = new FieldPropertyService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["property-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.save({
        actor: admin,
        doctype: "Note",
        fieldName: "title",
        overrides: { defaultValue: (() => "generated") as never }
      })
    ).rejects.toMatchObject({
      code: "FIELD_PROPERTY_INVALID",
      message: "Field 'title' defaultValue must be JSON-serializable"
    });
  });

  it("can clear dangling overrides after an upstream custom field is disabled", async () => {
    const events = new InMemoryDocumentStore();
    const registry = createRegistry({ doctypes: [noteDocType] });
    const customFields = new CustomFieldService({
      registry,
      events,
      ids: deterministicIds(["custom-field-1", "disable-field-1"]),
      clock: fixedClock(now)
    });
    const fieldProperties = new FieldPropertyService({
      registry,
      events,
      ids: deterministicIds(["property-1", "property-2"]),
      clock: fixedClock(now),
      prePropertyDocTypeResolver: (base, context) => customFields.effectiveDocType(base.name, context.tenantId)
    });

    await customFields.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "reviewed", type: "boolean", inListView: true }
    });
    await fieldProperties.save({
      actor: admin,
      doctype: "Note",
      fieldName: "reviewed",
      overrides: { label: "Reviewed?", defaultValue: false }
    });
    await customFields.disableField({
      actor: admin,
      doctype: "Note",
      fieldName: "reviewed",
      expectedVersion: 1
    });

    await expect(fieldProperties.effectiveDocType("Note", "acme")).rejects.toMatchObject({
      code: "FIELD_PROPERTY_INVALID"
    });
    await expect(
      fieldProperties.clear({ actor: admin, doctype: "Note", fieldName: "reviewed", expectedVersion: 1 })
    ).resolves.toMatchObject({ version: 2, fields: [] });
    const effectiveAfterClear = await fieldProperties.effectiveDocType("Note", "acme");
    expect(effectiveAfterClear.fields.find((field) => field.name === "reviewed")).toBeUndefined();
  });

  it("feeds effective field properties into document command validation and query metadata", async () => {
    const registry = createRegistry({ doctypes: [noteDocType] });
    const store = new InMemoryDocumentStore();
    const fieldProperties = new FieldPropertyService({
      registry,
      events: store,
      ids: deterministicIds(["property-1"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      fieldProperties.effectiveDocType(base.name, context.tenantId, base);
    const documents = new DocumentService({
      registry,
      store,
      doctypeResolver,
      ids: deterministicIds(["note-1"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({ registry, projections: store, doctypeResolver });

    await fieldProperties.save({
      actor: admin,
      doctype: "Note",
      fieldName: "priority",
      overrides: { label: "Urgency", options: ["Low", "High"], defaultValue: "High", inListFilter: true }
    });

    await expect(
      documents.create({ actor: admin, doctype: "Note", data: data({ priority: "Medium" }) })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(documents.create({ actor: admin, doctype: "Note", data: data({ priority: "High" }) })).resolves.toMatchObject({
      data: { priority: "High" }
    });
    await expect(queries.getEffectiveMeta(admin, "Note")).resolves.toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ name: "priority", label: "Urgency" })])
    });
  });
});

function fieldPropertyPayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "FieldPropertyOverrideSaved" }>
): Extract<FieldPropertyEventPayload, { readonly kind: "FieldPropertyOverrideSaved" }> {
  return payload;
}
