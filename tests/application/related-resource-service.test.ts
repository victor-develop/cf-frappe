import {
  createRegistry,
  defineDocType,
  definePrintFormat,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  notFound,
  PrintService,
  PrintSettingsService,
  QueryService,
  RelatedResourceService,
  type Actor,
  type DocTypeDefinition,
  type DocumentSnapshot,
  type PrintFormatDefinition
} from "../../src";
import { now, owner } from "../helpers";
import { afterField } from "../predicate-fixtures";

describe("RelatedResourceService", () => {
  it("discovers permission-safe incoming, outgoing, and Print Format resources", async () => {
    const Customer = defineDocType({
      name: "Related Customer",
      label: "Customer",
      module: "CRM",
      naming: { kind: "field", field: "title" },
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const Order = defineDocType({
      name: "Related Order",
      label: "Order",
      module: "Sales",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "customer", label: "Customer", type: "link", linkTo: "Related Customer" }
      ],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const format = definePrintFormat({
      name: "Related Customer Summary",
      label: "Customer Summary",
      doctype: "Related Customer",
      module: "CRM",
      description: "Customer-facing account summary.",
      sections: [{ fields: [{ field: "title" }] }],
      roles: ["User"]
    });
    const registry = createRegistry({ doctypes: [Customer, Order], printFormats: [format] });
    const store = new InMemoryDocumentStore();
    const queries = new QueryService({ registry, projections: store });
    const printSettings = new PrintSettingsService({ events: store });
    const service = new RelatedResourceService({
      queries,
      prints: new PrintService({ registry, queries, printSettings })
    });

    await expect(service.forDocType(owner, "Related Customer")).resolves.toEqual({
      doctype: "Related Customer",
      doctypes: [{
        kind: "doctype",
        direction: "incoming",
        doctype: "Related Order",
        doctypeLabel: "Order",
        module: "Sales",
        field: "customer",
        fieldLabel: "Customer"
      }],
      printFormats: [{
        kind: "print-format",
        name: "Related Customer Summary",
        label: "Customer Summary",
        module: "CRM",
        description: "Customer-facing account summary."
      }]
    });
    await expect(service.forDocType(owner, "Related Order")).resolves.toMatchObject({
      doctypes: [{
        direction: "outgoing",
        doctype: "Related Customer",
        field: "customer"
      }],
      printFormats: []
    });
  });

  it("adds direct links only for readable outgoing documents and keeps incoming filters metadata-only", async () => {
    const accountOwner: Actor = { id: "account-owner@example.com", roles: ["User"], tenantId: "acme" };
    const otherOwner: Actor = { id: "other-owner@example.com", roles: ["User"], tenantId: "acme" };
    const Account = defineDocType({
      name: "Related Account",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
      ],
      permissions: [{
        roles: ["User"],
        actions: ["read", "create"],
        when: ({ actor, document }) => document === undefined || document.data.created_by === actor.id
      }]
    });
    const Ticket = defineDocType({
      name: "Related Ticket",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "account", label: "Account", type: "link", linkTo: "Related Account", required: true }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }]
    });
    const registry = createRegistry({ doctypes: [Account, Ticket] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["account-event", "ticket-event", "other-account-event", "other-ticket-event"])
    });
    const queries = new QueryService({ registry, projections: store });
    const service = new RelatedResourceService({ queries });
    await documents.create({ actor: accountOwner, doctype: "Related Account", data: { title: "ACCT-1" } });
    await documents.create({ actor: accountOwner, doctype: "Related Ticket", data: { title: "TICKET-1", account: "ACCT-1" } });
    await documents.create({ actor: otherOwner, doctype: "Related Account", data: { title: "ACCT-2" } });
    await documents.create({ actor: otherOwner, doctype: "Related Ticket", data: { title: "TICKET-2", account: "ACCT-2" } });

    await expect(service.forDocument(accountOwner, "Related Ticket", "TICKET-1")).resolves.toMatchObject({
      documentName: "TICKET-1",
      doctypes: [{ direction: "outgoing", linkedDocumentName: "ACCT-1" }]
    });
    const hiddenTarget = await service.forDocument(accountOwner, "Related Ticket", "TICKET-2");
    expect(hiddenTarget.doctypes).toEqual([expect.not.objectContaining({ linkedDocumentName: "ACCT-2" })]);
    await expect(service.forDocument(accountOwner, "Related Account", "ACCT-1")).resolves.toMatchObject({
      documentName: "ACCT-1",
      doctypes: [{ direction: "incoming", doctype: "Related Ticket", field: "account" }]
    });
  });

  it("uses composed metadata and omits fields and formats hidden from the actor", async () => {
    const Target = defineDocType({
      name: "Related Dynamic Target",
      naming: { kind: "field", field: "title" },
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["User", "Manager"], actions: ["read"] }]
    });
    const Source = defineDocType({
      name: "Related Dynamic Source",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "manager_target",
          type: "link",
          linkTo: "Related Dynamic Target",
          permissions: [{ roles: ["Manager"], actions: ["read"] }]
        },
        { name: "hidden_target", type: "link", linkTo: "Related Dynamic Target", hidden: true },
        {
          name: "conditional_target",
          type: "link",
          linkTo: "Related Dynamic Target",
          hiddenDependsOn: afterField("title", "Hidden")
        }
      ],
      permissions: [{ roles: ["User", "Manager"], actions: ["read"] }]
    });
    const managerFormat = definePrintFormat({
      name: "Manager Target Format",
      doctype: "Related Dynamic Target",
      sections: [{ fields: [{ field: "title" }] }],
      roles: ["Manager"]
    });
    const registry = createRegistry({ doctypes: [Target, Source], printFormats: [managerFormat] });
    const store = new InMemoryDocumentStore();
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      base.name !== Source.name || context.tenantId !== "acme"
        ? base
        : defineDocType({
            ...base,
            fields: [
              ...base.fields,
              {
                name: "custom_target",
                label: "Custom Target",
                type: "link",
                linkTo: Target.name
              }
            ]
          });
    const queries = new QueryService({ registry, projections: store, doctypeResolver });
    const service = new RelatedResourceService({
      queries,
      prints: new PrintService({ registry, queries, printSettings: new PrintSettingsService({ events: store }) })
    });
    const result = await service.forDocType(owner, Source.name);

    expect(result.doctypes).toEqual([expect.objectContaining({
      direction: "outgoing",
      field: "custom_target",
      fieldLabel: "Custom Target"
    })]);
    expect(result.doctypes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "manager_target" }),
      expect.objectContaining({ field: "hidden_target" }),
      expect.objectContaining({ field: "conditional_target" })
    ]));
    await expect(service.forDocType(owner, Target.name)).resolves.toMatchObject({ printFormats: [] });
  });

  it("handles sparse metadata, fallback lookup, empty links, and unexpected lookup failures", async () => {
    const Target = defineDocType({
      name: "Sparse Target",
      naming: { kind: "field", field: "title" },
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const Selected = defineDocType({
      name: "Sparse Selected",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "secret", type: "boolean" },
        { name: "z_link", label: "Target", type: "link", linkTo: Target.name },
        { name: "a_link", label: "Target", type: "link", linkTo: Target.name },
        { name: "empty_link", type: "link", linkTo: Target.name },
        { name: "broken", type: "link", linkTo: "Missing Target" },
        { name: "hidden_target", type: "link", linkTo: Target.name, hidden: true },
        {
          name: "conditional_target",
          type: "link",
          linkTo: Target.name,
          hiddenDependsOn: afterField("status", "Closed")
        },
        {
          name: "conditional_private",
          type: "link",
          linkTo: Target.name,
          hiddenDependsOn: afterField("secret", true)
        }
      ],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const Incoming = defineDocType({
      name: "Sparse Incoming",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "z_ref", label: "Selected", type: "link", linkTo: Selected.name },
        { name: "a_ref", label: "Selected", type: "link", linkTo: Selected.name },
        { name: "hidden_ref", type: "link", linkTo: Selected.name, hidden: true },
        {
          name: "conditional_ref",
          type: "link",
          linkTo: Selected.name,
          hiddenDependsOn: afterField("status", "Closed")
        }
      ],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const formats: readonly PrintFormatDefinition[] = [
      definePrintFormat({ name: "Zulu", doctype: Selected.name, sections: [{ fields: [{ field: "title" }] }] }),
      definePrintFormat({ name: "Same Z", label: "Same", doctype: Selected.name, sections: [{ fields: [{ field: "title" }] }] }),
      definePrintFormat({ name: "Same A", label: "Same", doctype: Selected.name, sections: [{ fields: [{ field: "title" }] }] })
    ];
    const actor: Actor = { id: "sparse@example.com", roles: ["User"] };
    const documents = new Map<string, DocumentSnapshot>([
      ["EMPTY", { tenantId: "default", doctype: Selected.name, name: "EMPTY", version: 1, docstatus: "draft" as const, data: { status: "Open", conditional_target: "VISIBLE", empty_link: "  ", a_link: 42 }, createdAt: now, updatedAt: now }],
      ["MISSING", { tenantId: "default", doctype: Selected.name, name: "MISSING", version: 1, docstatus: "draft" as const, data: { a_link: "MISSING" }, createdAt: now, updatedAt: now }],
      ["FAIL", { tenantId: "default", doctype: Selected.name, name: "FAIL", version: 1, docstatus: "draft" as const, data: { a_link: "FAIL" }, createdAt: now, updatedAt: now }]
    ]);
    const projectedSelected: DocTypeDefinition = {
      ...Selected,
      fields: Selected.fields.filter((field) => field.name !== "secret")
    };
    const listEffectiveQueryDoctypes = vi.fn(async () => [Target, Incoming]);
    const getEffectiveQueryMeta = vi.fn(async () => projectedSelected);
    const queries = {
      listEffectiveQueryDoctypes,
      getEffectiveQueryMeta,
      getDocument: async (_actor: Actor, doctype: string, name: string) => {
        if (doctype === Selected.name) {
          return documents.get(name)!;
        }
        if (name === "MISSING") {
          throw notFound("missing linked document");
        }
        if (name === "FAIL") {
          throw new Error("lookup failed");
        }
        throw notFound("unexpected linked document");
      }
    } as unknown as QueryService;
    const service = new RelatedResourceService({
      queries,
      prints: { listPrintFormats: () => formats }
    });

    const overview = await service.forDocType(actor, Selected.name);
    expect(listEffectiveQueryDoctypes).toHaveBeenCalledWith(actor);
    expect(getEffectiveQueryMeta).toHaveBeenCalledWith(actor, Selected.name);
    expect(overview.doctypes.map((resource) => `${resource.direction}:${resource.field}`)).toEqual([
      "incoming:a_ref",
      "incoming:z_ref",
      "outgoing:empty_link",
      "outgoing:a_link",
      "outgoing:z_link"
    ]);
    expect(overview.doctypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ doctypeLabel: "Sparse Target", fieldLabel: "empty_link" }),
      expect.objectContaining({ doctypeLabel: "Sparse Incoming" })
    ]));
    expect(overview.doctypes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "hidden_target" }),
      expect.objectContaining({ field: "conditional_target" }),
      expect.objectContaining({ field: "conditional_private" }),
      expect.objectContaining({ field: "hidden_ref" }),
      expect.objectContaining({ field: "conditional_ref" })
    ]));
    expect(overview.printFormats.map((format) => format.name)).toEqual(["Same A", "Same Z", "Zulu"]);
    expect(overview.printFormats[2]).toEqual({ kind: "print-format", name: "Zulu", label: "Zulu" });

    const noPrints = new RelatedResourceService({ queries });
    await expect(noPrints.forDocType(actor, Selected.name)).resolves.toMatchObject({ printFormats: [] });
    const empty = await service.forDocument(actor, Selected.name, "EMPTY");
    expect(empty).toEqual(expect.objectContaining({ documentName: "EMPTY" }));
    expect(empty.doctypes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "conditional_target" })
    ]));
    await expect(service.forDocument(actor, Selected.name, "MISSING")).resolves.toEqual(
      expect.objectContaining({ documentName: "MISSING" })
    );
    await expect(service.forDocument(actor, Selected.name, "FAIL")).rejects.toThrow("lookup failed");
  });
});
