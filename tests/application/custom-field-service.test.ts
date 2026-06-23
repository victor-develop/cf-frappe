import {
  AuditService,
  createRegistry,
  customFieldsCatalogStream,
  customFieldsStream,
  CustomFieldService,
  defineDocType,
  deterministicIds,
  documentStream,
  fixedClock,
  InMemoryEventStore,
  SYSTEM_MANAGER_ROLE
} from "../../src";
import { owner, now } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("CustomFieldService", () => {
  const Note = defineDocType({
    name: "Note",
    fields: [{ name: "title", type: "text", required: true }]
  });
  const Project = defineDocType({
    name: "Project",
    fields: [{ name: "title", type: "text", required: true }]
  });
  const InvoiceItem = defineDocType({
    name: "Invoice Item",
    fields: [{ name: "description", type: "text", required: true }]
  });

  it("saves, updates, and disables custom fields as optimistic metadata events", async () => {
    const events = new InMemoryEventStore();
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      ids: deterministicIds(["field-1", "field-2", "disable-1"]),
      clock: fixedClock(now)
    });

    const saved = await service.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: " priority ", label: " Priority ", type: "select", options: ["Low", "High"], inListFilter: true }
    });
    const updated = await service.saveField({
      actor: admin,
      doctype: "Note",
      expectedVersion: 1,
      field: { name: "priority", label: "Priority", type: "select", options: ["Low", "Medium", "High"] }
    });
    const disabled = await service.disableField({
      actor: admin,
      doctype: "Note",
      expectedVersion: 2,
      fieldName: "priority"
    });

    expect(saved).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      version: 1,
      fields: [{ enabled: true, field: { name: "priority", label: "Priority" } }]
    });
    expect(updated.fields[0]?.field).toMatchObject({ name: "priority", options: ["Low", "Medium", "High"] });
    expect(disabled).toMatchObject({ version: 3, fields: [{ enabled: false, field: { name: "priority" } }] });
    await expect(events.readStream(customFieldsCatalogStream("acme"))).resolves.toMatchObject([
      { id: "evt_field-1", payload: { kind: "CustomFieldSaved", field: { name: "priority" } } },
      { id: "evt_field-2", payload: { kind: "CustomFieldSaved", field: { options: ["Low", "Medium", "High"] } } },
      { id: "evt_disable-1", payload: { kind: "CustomFieldDisabled", fieldName: "priority" } }
    ]);
  });

  it("returns an effective DocType with enabled tenant custom fields", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });
    await service.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "reviewed", type: "boolean", inListView: true }
    });

    const effective = await service.effectiveDocType("Note", "acme");

    expect(effective.fields.map((field) => field.name)).toEqual(["title", "reviewed"]);
  });

  it("supports table custom fields on parent DocTypes", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, InvoiceItem] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });
    const saved = await service.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "items", type: "table", tableOf: "Invoice Item", inFormView: true }
    });

    expect(saved).toMatchObject({
      version: 1,
      fields: [{ enabled: true, field: { name: "items", type: "table", tableOf: "Invoice Item" } }]
    });

    const effective = await service.effectiveDocType("Note", "acme");
    expect(effective.fields).toEqual([
      expect.objectContaining({ name: "title" }),
      expect.objectContaining({ name: "items", type: "table", tableOf: "Invoice Item" })
    ]);
    expect(effective.formView).toBeUndefined();
  });

  it("treats semantically identical field saves as idempotent regardless of object key order", async () => {
    const events = new InMemoryEventStore();
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await service.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "priority", type: "text" }
    });
    const repeated = await service.saveField({
      actor: admin,
      doctype: "Note",
      expectedVersion: 1,
      field: { type: "text", name: "priority" }
    });

    expect(repeated.version).toBe(1);
    await expect(events.readStream(customFieldsCatalogStream("acme"))).resolves.toHaveLength(1);
  });

  it("revalidates folded link targets when composing effective DocTypes", async () => {
    const events = new InMemoryEventStore();
    const original = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, Project] }),
      events,
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });
    await original.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "project", type: "link", linkTo: "Project" }
    });
    const replayedWithoutProject = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      clock: fixedClock(now)
    });

    await expect(replayedWithoutProject.effectiveDocType("Note", "acme")).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
  });

  it("revalidates folded table targets when composing effective DocTypes", async () => {
    const events = new InMemoryEventStore();
    const original = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, InvoiceItem] }),
      events,
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });
    await original.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "items", type: "table", tableOf: "Invoice Item" }
    });
    const replayedWithoutChild = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      clock: fixedClock(now)
    });

    await expect(replayedWithoutChild.effectiveDocType("Note", "acme")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Custom field 'items' targets unknown child DocType 'Invoice Item'"
    });
  });

  it("requires admin authority, tenant ownership, and expected versions", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.saveField({ actor: owner, doctype: "Note", field: { name: "priority", type: "text" } })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.saveField({
        actor: admin,
        tenantId: "globex",
        doctype: "Note",
        field: { name: "priority", type: "text" }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        expectedVersion: 1,
        field: { name: "priority", type: "text" }
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("validates custom fields against base fields and registered link targets", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, Project] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.saveField({ actor: admin, doctype: "Note", field: { name: "title", type: "text" } })
    ).rejects.toMatchObject({ code: "CUSTOM_FIELD_INVALID" });
    await expect(
      service.saveField({ actor: admin, doctype: "Note", field: { name: "bad-name", type: "text" } })
    ).rejects.toMatchObject({ code: "CUSTOM_FIELD_INVALID", status: 400 });
    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "generated", type: "text", defaultValue: () => "not persisted" }
      })
    ).rejects.toMatchObject({ code: "CUSTOM_FIELD_INVALID", status: 400 });
    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "missing_project", type: "link", linkTo: "Missing" }
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "missing_items", type: "table", tableOf: "Missing" }
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "filterable_items", type: "table", tableOf: "Project", inListFilter: true }
      })
    ).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom table field 'filterable_items' cannot be a list filter"
    });

    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "project", type: "link", linkTo: "Project" }
      })
    ).resolves.toMatchObject({ fields: [{ field: { name: "project", linkTo: "Project" } }] });
  });

  it("rejects child table DocType custom fields until runtime table overlays are supported", async () => {
    const InvoiceItem = defineDocType({
      name: "Invoice Item",
      fields: [{ name: "description", type: "text" }]
    });
    const Invoice = defineDocType({
      name: "Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item" }]
    });
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Invoice, InvoiceItem] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.saveField({
        actor: admin,
        doctype: "Invoice Item",
        field: { name: "reviewed", type: "boolean" }
      })
    ).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom fields on child table DocType 'Invoice Item' are not supported yet"
    });
  });

  it("rejects child DocType custom fields after a tenant table custom field targets the DocType", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, InvoiceItem] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });
    await service.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "items", type: "table", tableOf: "Invoice Item" }
    });

    await expect(
      service.saveField({
        actor: admin,
        doctype: "Invoice Item",
        field: { name: "reviewed", type: "boolean" }
      })
    ).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom fields on child table DocType 'Invoice Item' are not supported yet"
    });
  });

  it("rejects table custom fields targeting DocTypes with enabled custom fields", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, InvoiceItem] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });
    await service.saveField({
      actor: admin,
      doctype: "Invoice Item",
      field: { name: "reviewed", type: "boolean" }
    });

    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "items", type: "table", tableOf: "Invoice Item" }
      })
    ).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom table field 'items' targets child DocType 'Invoice Item' with custom fields, which is not supported until recursive table overlays are supported"
    });
  });

  it("rejects self-targeting table custom fields without appending metadata", async () => {
    const events = new InMemoryEventStore();
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "children", type: "table", tableOf: "Note" }
      })
    ).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom table field 'children' cannot target its own DocType 'Note' until recursive table overlays are supported"
    });
    await expect(events.readStream(customFieldsCatalogStream("acme"))).resolves.toEqual([]);
  });

  it("serializes tenant custom-field writes that would otherwise violate table invariants", async () => {
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, InvoiceItem] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1", "field-2"]),
      clock: fixedClock(now)
    });

    const results = await Promise.allSettled([
      service.saveField({
        actor: admin,
        doctype: "Invoice Item",
        field: { name: "reviewed", type: "boolean" }
      }),
      service.saveField({
        actor: admin,
        doctype: "Note",
        field: { name: "items", type: "table", tableOf: "Invoice Item" }
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "DOCUMENT_CONFLICT" });

    const noteState = await service.list(admin, "Note");
    const childState = await service.list(admin, "Invoice Item");
    const enabledTableField = noteState.fields.some((entry) => entry.enabled && entry.field.name === "items");
    const enabledChildField = childState.fields.some((entry) => entry.enabled && entry.field.name === "reviewed");
    expect([enabledTableField, enabledChildField].filter(Boolean)).toHaveLength(1);
  });

  it("reads legacy per-DocType custom-field streams before catalog overrides", async () => {
    const events = new InMemoryEventStore();
    const legacyStream = documentStream("acme", "__CustomFields", "Note");
    await events.append(legacyStream, 0, [
      {
        id: "evt_legacy-field",
        tenantId: "acme",
        stream: legacyStream,
        type: "CustomFieldSaved",
        doctype: "__CustomFields",
        documentName: "reviewed",
        actorId: admin.id,
        occurredAt: now,
        payload: {
          kind: "CustomFieldSaved",
          doctypeName: "Note",
          field: { name: "reviewed", type: "boolean" }
        },
        metadata: {}
      }
    ]);
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      ids: deterministicIds(["disable-1"]),
      clock: fixedClock(now)
    });

    await expect(service.effectiveDocType("Note", "acme")).resolves.toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ name: "reviewed", type: "boolean" })])
    });
    await expect(service.list(admin, "Note")).resolves.toMatchObject({
      version: 0,
      fields: [{ enabled: true, field: { name: "reviewed" } }]
    });

    await expect(
      service.disableField({ actor: admin, doctype: "Note", fieldName: "reviewed", expectedVersion: 0 })
    ).resolves.toMatchObject({
      version: 1,
      fields: [{ enabled: false, field: { name: "reviewed" } }]
    });
    await expect(service.effectiveDocType("Note", "acme")).resolves.toMatchObject({
      fields: [{ name: "title", type: "text", required: true }]
    });
    await expect(events.readStream(customFieldsCatalogStream("acme"))).resolves.toMatchObject([
      { id: "evt_disable-1", payload: { kind: "CustomFieldDisabled", fieldName: "reviewed" } }
    ]);
  });

  it("rejects replayed child table DocType custom fields when composing effective metadata", async () => {
    const InvoiceItem = defineDocType({
      name: "Invoice Item",
      fields: [{ name: "description", type: "text" }]
    });
    const Invoice = defineDocType({
      name: "Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item" }]
    });
    const events = new InMemoryEventStore();
    const stream = customFieldsStream("acme", "Invoice Item");
    await events.append(stream, 0, [
      {
        id: "evt_legacy-field",
        tenantId: "acme",
        stream,
        type: "CustomFieldSaved",
        doctype: "__CustomFields",
        documentName: "reviewed",
        actorId: admin.id,
        occurredAt: now,
        payload: {
          kind: "CustomFieldSaved",
          doctypeName: "Invoice Item",
          field: { name: "reviewed", type: "boolean" }
        },
        metadata: {}
      }
    ]);
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Invoice, InvoiceItem] }),
      events,
      clock: fixedClock(now)
    });

    await expect(service.effectiveDocType("Invoice Item", "acme")).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom fields on child table DocType 'Invoice Item' are not supported yet"
    });
  });

  it("rejects replayed parent table custom fields that target DocTypes with custom fields", async () => {
    const events = new InMemoryEventStore();
    await events.append(customFieldsStream("acme", "Note"), 0, [
      {
        id: "evt_table-field",
        tenantId: "acme",
        stream: customFieldsStream("acme", "Note"),
        type: "CustomFieldSaved",
        doctype: "__CustomFields",
        documentName: "items",
        actorId: admin.id,
        occurredAt: now,
        payload: {
          kind: "CustomFieldSaved",
          doctypeName: "Note",
          field: { name: "items", type: "table", tableOf: "Invoice Item" }
        },
        metadata: {}
      }
    ]);
    await events.append(customFieldsStream("acme", "Invoice Item"), 0, [
      {
        id: "evt_child-field",
        tenantId: "acme",
        stream: customFieldsStream("acme", "Invoice Item"),
        type: "CustomFieldSaved",
        doctype: "__CustomFields",
        documentName: "reviewed",
        actorId: admin.id,
        occurredAt: now,
        payload: {
          kind: "CustomFieldSaved",
          doctypeName: "Invoice Item",
          field: { name: "reviewed", type: "boolean" }
        },
        metadata: {}
      }
    ]);
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note, InvoiceItem] }),
      events,
      clock: fixedClock(now)
    });

    await expect(service.effectiveDocType("Note", "acme")).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom table field 'items' targets child DocType 'Invoice Item' with custom fields, which is not supported until recursive table overlays are supported"
    });
  });

  it("rejects table custom fields as list filters", async () => {
    const InvoiceItem = defineDocType({
      name: "Invoice Item",
      fields: [{ name: "description", type: "text" }]
    });
    const Invoice = defineDocType({
      name: "Invoice",
      fields: [{ name: "total", type: "number" }]
    });
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Invoice, InvoiceItem] }),
      events: new InMemoryEventStore(),
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.saveField({
        actor: admin,
        doctype: "Invoice",
        field: { name: "extra_items", type: "table", tableOf: "Invoice Item", inListFilter: true }
      })
    ).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      message: "Custom table field 'extra_items' cannot be a list filter"
    });
  });

  it("keeps custom field metadata events searchable through the audit boundary", async () => {
    const events = new InMemoryEventStore();
    const service = new CustomFieldService({
      registry: createRegistry({ doctypes: [Note] }),
      events,
      ids: deterministicIds(["field-1"]),
      clock: fixedClock(now)
    });

    await service.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "reviewed", type: "boolean" },
      metadata: { source: "customize-form" }
    });

    const audit = new AuditService({ events });
    await expect(audit.search(admin, { kind: "CustomFieldSaved" })).resolves.toMatchObject({
      events: [
        {
          payload: { kind: "CustomFieldSaved", doctypeName: "Note", field: { name: "reviewed" } },
          metadata: { source: "customize-form" }
        }
      ]
    });
  });
});
