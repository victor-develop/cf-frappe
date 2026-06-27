import {
  createRegistry,
  defineDocType,
  defineWebForm,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  WebFormService
} from "../../src";
import { documentStream } from "../../src";
import type { Actor, DocTypeDefinition } from "../../src";
import { guest, now, owner } from "../helpers";

const leadDocType = defineDocType({
  name: "Lead",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "email", type: "text" },
    { name: "priority", type: "select", options: ["Low", "High"] },
    { name: "accepted", type: "boolean" },
    { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
  ],
  permissions: [
    {
      roles: ["Guest"],
      actions: ["create"]
    },
    {
      roles: ["User"],
      actions: ["read", "create"],
      when: ({ actor, document }) => !document || document.data.created_by === actor.id
    }
  ]
});

describe("WebFormService", () => {
  it("submits declared fields through the document command service", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
      webForms: [
        defineWebForm({
          name: "Lead Intake",
          label: "Lead Intake",
          doctype: "Lead",
          fields: [
            { field: "title", label: "Name", required: true },
            { field: "email" },
            { field: "priority" },
            { field: "accepted" }
          ]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });

    await expect(webForms.listWebForms(guest)).resolves.toMatchObject([{ name: "Lead Intake" }]);
    await expect(webForms.getWebForm(guest, "Lead Intake")).resolves.toMatchObject({
      form: { name: "Lead Intake" },
      doctype: "Lead",
      fields: [
        { field: "title", label: "Name", type: "text", required: true },
        { field: "email", type: "text", required: false },
        { field: "priority", type: "select", options: ["Low", "High"] },
        { field: "accepted", type: "boolean" }
      ]
    });

    const result = await webForms.submitWebForm(guest, "Lead Intake", {
      data: {
        title: "Jane Buyer",
        email: "jane@example.com",
        priority: "High",
        accepted: true,
        created_by: "attacker@example.com"
      },
      metadata: { source: "web-form" }
    });

    expect(result.document).toMatchObject({
      doctype: "Lead",
      name: "Jane Buyer",
      data: {
        title: "Jane Buyer",
        email: "jane@example.com",
        priority: "High",
        accepted: true,
        created_by: "guest"
      }
    });
    await expect(store.readStream(documentStream(result.document.tenantId, "Lead", "Jane Buyer"))).resolves.toMatchObject([
      { payload: { kind: "DocumentCreated" }, metadata: { source: "web-form" } }
    ]);
  });

  it("validates form fields against effective create metadata", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
      webForms: [
        defineWebForm({
          name: "Lead Intake",
          doctype: "Lead",
          fields: [{ field: "title" }, { field: "email" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({
      registry,
      projections: store,
      doctypeResolver: hideEmailForTenant
    });
    const webForms = new WebFormService({ registry, documents, queries });

    await expect(webForms.getWebForm({ ...guest, tenantId: "acme" }, "Lead Intake")).rejects.toMatchObject({
      code: "WEB_FORM_INVALID"
    });
  });

  it("enforces form-level required fields before creating documents", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
      webForms: [
        defineWebForm({
          name: "Lead Intake",
          doctype: "Lead",
          fields: [
            { field: "title" },
            { field: "email", required: true }
          ]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });

    await expect(webForms.submitWebForm(guest, "Lead Intake", { data: { title: "Missing Email" } }))
      .rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Web form field 'email' is required"
      });
    await expect(store.get("default", "Lead", "Missing Email")).resolves.toBeNull();
  });

  it("hides forms when form roles or DocType create permissions fail", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
      webForms: [
        defineWebForm({
          name: "Member Intake",
          roles: ["User"],
          doctype: "Lead",
          fields: [{ field: "title" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });

    await expect(webForms.listWebForms(guest)).resolves.toEqual([]);
    await expect(webForms.getWebForm(guest, "Member Intake")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(webForms.submitWebForm(owner, "Member Intake", { data: { title: "Member Lead" } })).resolves.toMatchObject({
      document: { name: "Member Lead" }
    });
  });
});

function hideEmailForTenant(
  base: DocTypeDefinition,
  context: { readonly actor: Actor; readonly tenantId: string }
): DocTypeDefinition {
  if (context.tenantId !== "acme") {
    return base;
  }
  return {
    ...base,
    fields: base.fields.map((field) => field.name === "email" ? { ...field, hidden: true } : field)
  };
}
