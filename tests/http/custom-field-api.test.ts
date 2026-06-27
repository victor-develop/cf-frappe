import {
  createResourceApi,
  CustomFieldService,
  deterministicIds,
  DocumentService,
  fixedClock,
  QueryService,
  SavedListFilterService,
  SYSTEM_MANAGER_ROLE,
  type DocTypeDefinition,
  unsafeHeaderActorResolver
} from "../../src";
import { createChildTableServices, createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("custom field api", () => {
  it("manages tenant custom fields through generated JSON routes", async () => {
    const { app } = makeCustomFieldApp();

    const empty = await app.request("/api/custom-fields/Note", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ data: { tenantId: "acme", doctype: "Note", version: 0, fields: [] } });

    const created = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        field: {
          name: "reviewed",
          label: "Reviewed",
          description: "Show review status on task forms.",
          placeholder: "yes/no",
          type: "boolean",
          mandatoryDependsOn: { field: "priority", value: "High" },
          readOnlyDependsOn: { field: "priority", value: "Low" },
          hiddenDependsOn: { field: "priority", operator: "is", value: "not set" },
          printHide: true,
          printHideIfNoValue: true,
          unique: true,
          noCopy: true,
          allowOnSubmit: true,
          inListView: true,
          defaultValue: false
        },
        expectedVersion: 0
      })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        version: 1,
        fields: [
          {
            field: {
              name: "reviewed",
              label: "Reviewed",
              description: "Show review status on task forms.",
              placeholder: "yes/no",
              type: "boolean",
              mandatoryDependsOn: { field: "priority", value: "High" },
              readOnlyDependsOn: { field: "priority", value: "Low" },
              hiddenDependsOn: { field: "priority", operator: "is", value: "not set" },
              printHide: true,
              printHideIfNoValue: true,
              unique: true,
              noCopy: true,
              allowOnSubmit: true,
              inListView: true,
              defaultValue: false
            },
            enabled: true
          }
        ]
      }
    });

    const current = await app.request("/api/custom-fields/Note", { headers: adminHeaders });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: { version: 1, fields: [{ field: { name: "reviewed" }, enabled: true }] }
    });

    const disabled = await app.request("/api/custom-fields/Note/reviewed", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      data: { version: 2, fields: [{ field: { name: "reviewed" }, enabled: false }] }
    });
  });

  it("maps custom-field validation, conflict, and permission failures to JSON errors", async () => {
    const { app } = makeCustomFieldApp(80);

    const denied = await app.request("/api/custom-fields/Note", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const deniedWrite = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" },
      body: JSON.stringify({ field: { name: "bad", type: "currency" } })
    });
    expect(deniedWrite.status).toBe(403);
    await expect(deniedWrite.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const invalidField = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ field: { name: "bad", type: "currency" } })
    });
    expect(invalidField.status).toBe(400);
    await expect(invalidField.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "field.type is invalid" }
    });

    const missingField = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0 })
    });
    expect(missingField.status).toBe(400);
    await expect(missingField.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "field must be an object" }
    });

    const created = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ field: { name: "reviewed", type: "boolean" }, expectedVersion: 0 })
    });
    expect(created.status).toBe(201);

    const stale = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ field: { name: "second_review", type: "boolean" }, expectedVersion: 0 })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_CONFLICT" } });

    const oversized = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("applies custom fields to metadata, list filters, and resource writes", async () => {
    const { app } = makeCustomFieldApp();
    const createdField = await app.request("/api/custom-fields/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        field: {
          name: "reviewed",
          label: "Reviewed",
          type: "boolean",
          inFormView: true,
          inListView: true,
          inListFilter: true,
          defaultValue: false
        },
        expectedVersion: 0
      })
    });
    expect(createdField.status).toBe(201);

    const meta = await app.request("/api/meta/doctypes/Note", { headers: adminHeaders });
    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: {
        fields: expect.arrayContaining([expect.objectContaining({ name: "reviewed", type: "boolean" })])
      }
    });

    const listView = await app.request("/api/meta/doctypes/Note/list-view", { headers: adminHeaders });
    expect(listView.status).toBe(200);
    await expect(listView.json()).resolves.toMatchObject({
      data: {
        columns: expect.arrayContaining([expect.objectContaining({ name: "reviewed" })]),
        filterBuilderFields: expect.arrayContaining([
          expect.objectContaining({ field: "reviewed", inputType: "boolean" })
        ])
      }
    });

    const createdDocument = await app.request("/api/resource/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ title: "Runtime Reviewed", body: "Body", reviewed: true })
    });
    expect(createdDocument.status).toBe(201);
    await expect(createdDocument.json()).resolves.toMatchObject({
      data: { data: { reviewed: true } }
    });

    const filtered = await app.request("/api/resource/Note?filter_reviewed=true", { headers: adminHeaders });
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({
      data: [{ name: "Runtime Reviewed", data: { reviewed: true } }],
      total: 1
    });

    const saved = await app.request("/api/resource/Note/saved-filters", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        label: "Reviewed notes",
        filters: [{ field: "reviewed", value: true }]
      })
    });
    expect(saved.status).toBe(201);
    const savedJson = await saved.json() as { readonly data: { readonly id: string } };
    expect(savedJson).toMatchObject({
      data: {
        label: "Reviewed notes",
        filters: [{ field: "reviewed", value: true }]
      }
    });
    const savedFiltered = await app.request(`/api/resource/Note?saved_filter=${savedJson.data.id}`, {
      headers: adminHeaders
    });
    expect(savedFiltered.status).toBe(200);
    await expect(savedFiltered.json()).resolves.toMatchObject({
      data: [{ name: "Runtime Reviewed" }],
      total: 1
    });

    const invalid = await app.request("/api/resource/Note", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ title: "Invalid Reviewed", reviewed: "yes" })
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });

  it("applies table custom fields through generated JSON routes", async () => {
    const { app } = makeChildTableCustomFieldApp();
    const createdField = await app.request("/api/custom-fields/Sales%20Invoice", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        field: {
          name: "bonus_items",
          type: "table",
          tableOf: "Sales Invoice Item",
          inFormView: true
        },
        expectedVersion: 0
      })
    });
    expect(createdField.status).toBe(201);
    await expect(createdField.json()).resolves.toMatchObject({
      data: { fields: [{ field: { name: "bonus_items", type: "table", tableOf: "Sales Invoice Item" } }] }
    });

    const meta = await app.request("/api/meta/doctypes/Sales%20Invoice", { headers: adminHeaders });
    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: {
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "bonus_items", type: "table", tableOf: "Sales Invoice Item" })
        ])
      }
    });

    await app.request("/api/resource/Product", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sku: "SKU-1", title: "Widget" })
    });
    const invoice = await app.request("/api/resource/Sales%20Invoice", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        title: "INV-CUSTOM-HTTP",
        items: [{ product: "SKU-1", quantity: 1 }],
        bonus_items: [{ product: "SKU-1", quantity: 2, rate: 0 }]
      })
    });
    expect(invoice.status).toBe(201);
    await expect(invoice.json()).resolves.toMatchObject({
      data: { data: { bonus_items: [{ product: "SKU-1", quantity: 2, rate: 0 }] } }
    });

    const invalid = await app.request("/api/resource/Sales%20Invoice", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        title: "INV-BROKEN-CUSTOM-HTTP",
        items: [{ product: "SKU-1", quantity: 1 }],
        bonus_items: [{ product: "Missing", quantity: 0 }]
      })
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });

  it("applies child table DocType custom fields through generated JSON routes", async () => {
    const { app } = makeChildTableCustomFieldApp();
    const createdField = await app.request("/api/custom-fields/Sales%20Invoice%20Item", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        field: {
          name: "bonus_product",
          type: "link",
          linkTo: "Product"
        },
        expectedVersion: 0
      })
    });
    expect(createdField.status).toBe(201);
    await expect(createdField.json()).resolves.toMatchObject({
      data: { fields: [{ field: { name: "bonus_product", type: "link", linkTo: "Product" } }] }
    });

    const meta = await app.request("/api/meta/doctypes/Sales%20Invoice%20Item", { headers: adminHeaders });
    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: {
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "bonus_product", type: "link", linkTo: "Product" })
        ])
      }
    });

    await app.request("/api/resource/Product", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sku: "SKU-1", title: "Widget" })
    });
    await app.request("/api/resource/Product", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sku: "SKU-2", title: "Cable" })
    });
    const invoice = await app.request("/api/resource/Sales%20Invoice", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        title: "INV-CHILD-CUSTOM-HTTP",
        items: [{ product: "SKU-1", quantity: 1, bonus_product: "SKU-2" }]
      })
    });
    expect(invoice.status).toBe(201);
    await expect(invoice.json()).resolves.toMatchObject({
      data: { data: { items: [{ product: "SKU-1", quantity: 1, bonus_product: "SKU-2" }] } }
    });

    const invalid = await app.request("/api/resource/Sales%20Invoice", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        title: "INV-BROKEN-CHILD-CUSTOM-HTTP",
        items: [{ product: "SKU-1", quantity: 1, bonus_product: "Missing" }]
      })
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });
});

function makeCustomFieldApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["note-1", "note-2"]);
  const customFields = new CustomFieldService({
    registry: services.registry,
    events: services.store,
    ids: deterministicIds(["field-1", "disable-1", "field-2"]),
    clock: fixedClock(now)
  });
  const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
    customFields.effectiveDocType(base.name, context.tenantId);
  const documents = new DocumentService({
    registry: services.registry,
    store: services.store,
    doctypeResolver,
    documentShares: services.documentShares,
    userPermissions: services.userPermissions,
    ids: deterministicIds(["doc-1", "doc-2"]),
    clock: fixedClock(now)
  });
  const queries = new QueryService({
    registry: services.registry,
    projections: services.store,
    doctypeResolver,
    documentShares: services.documentShares,
    userPermissions: services.userPermissions
  });
  const savedFilters = new SavedListFilterService({
    registry: services.registry,
    events: services.store,
    doctypeResolver,
    ids: deterministicIds(["saved-filter-1", "saved-filter-event-1"]),
    clock: fixedClock(now)
  });
  return {
    services: { ...services, documents, queries, savedFilters },
    customFields,
    app: createResourceApi({
      registry: services.registry,
      documents,
      queries,
      savedFilters,
      actor: unsafeHeaderActorResolver,
      customFields,
      maxJsonBytes
    })
  };
}

function makeChildTableCustomFieldApp() {
  const services = createChildTableServices(["product-1", "invoice-1", "invoice-2"]);
  const customFields = new CustomFieldService({
    registry: services.registry,
    events: services.store,
    ids: deterministicIds(["field-1"]),
    clock: fixedClock(now)
  });
  const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
    customFields.effectiveDocType(base.name, context.tenantId);
  const documents = new DocumentService({
    registry: services.registry,
    store: services.store,
    doctypeResolver,
    documentShares: services.documentShares,
    ids: deterministicIds(["doc-product-1", "doc-invoice-1", "doc-invoice-2"]),
    clock: fixedClock(now)
  });
  const queries = new QueryService({
    registry: services.registry,
    projections: services.store,
    doctypeResolver,
    documentShares: services.documentShares
  });
  return {
    services: { ...services, documents, queries },
    customFields,
    app: createResourceApi({
      registry: services.registry,
      documents,
      queries,
      actor: unsafeHeaderActorResolver,
      customFields
    })
  };
}
