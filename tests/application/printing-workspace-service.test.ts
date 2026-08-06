import {
  createRegistry,
  defineDocType,
  definePrintFormat,
  definePrintLetterhead,
  deterministicIds,
  DocumentService,
  ensurePrintingWorkspaceServiceAvailable,
  fixedClock,
  InMemoryDocumentStore,
  PrintService,
  PrintSettingsService,
  PrintingWorkspaceService,
  QueryService,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type PrintFormatDefinition,
  type PrintLetterheadDefinition,
  type PrintSettingsState
} from "../../src";
import { createServices, now, owner } from "../helpers";

describe("PrintingWorkspaceService", () => {
  it("requires the workspace service only when the feature is enabled", () => {
    expect(() => ensurePrintingWorkspaceServiceAvailable(undefined)).toThrow(
      "Printing workspace is not enabled"
    );
    expect(() => ensurePrintingWorkspaceServiceAvailable({ enabled: true })).not.toThrow();
  });

  it("projects authorized formats and letterheads without exposing bodies in the overview", async () => {
    const { service } = await makePrintingWorkspace();

    const overview = await service.overview(owner);

    expect(overview.canManageDefaultLayout).toBe(false);
    expect(overview.formats).toEqual([{
      name: "Workspace Invoice",
      label: "Invoice",
      doctype: "Workspace Invoice Doc",
      module: "Billing",
      description: "Customer invoice output."
    }]);
    expect(overview.letterheads).toEqual([{ name: "Workspace Letterhead", label: "Primary Letterhead" }]);
    expect(overview.letterheads[0]).not.toHaveProperty("headerHtml");
    expect(overview.settings).toMatchObject({ tenantId: "acme", version: 1 });
  });

  it("returns inherited and effective layouts plus only readable preview documents", async () => {
    const { service } = await makePrintingWorkspace();

    const inspection = await service.inspectFormat(owner, "Workspace Invoice");

    expect(inspection.inheritedLayout).toEqual({
      pageSize: "A4",
      orientation: "portrait",
      margins: { topMm: 12, rightMm: 10, bottomMm: 12, leftMm: 10 },
      font: { family: "Inter", sizePt: 10 }
    });
    expect(inspection.effectiveLayout).toEqual({
      pageSize: "A4",
      orientation: "landscape",
      margins: { topMm: 12, rightMm: 10, bottomMm: 12, leftMm: 10 },
      font: { family: "Inter", sizePt: 11 }
    });
    expect(inspection.previewDocuments).toEqual([{ name: "INV-1" }]);
    expect(inspection.format.sections?.[0]?.fields).toEqual([{ field: "title" }, { field: "amount" }]);
  });

  it("enforces format, letterhead, and document permissions", async () => {
    const { service } = await makePrintingWorkspace();
    const guest: Actor = { id: "guest", roles: ["Guest"], tenantId: "acme" };

    await expect(service.overview(guest)).resolves.toMatchObject({ formats: [], letterheads: [] });
    await expect(service.inspectFormat(guest, "Workspace Invoice")).rejects.toMatchObject({ status: 403 });
    expect(() => service.inspectLetterhead(guest, "Workspace Letterhead")).toThrow(
      "cannot read print letterhead"
    );
    expect(service.inspectLetterhead(owner, "Workspace Letterhead")).toMatchObject({
      headerHtml: "<strong>Acme Billing</strong>",
      footerHtml: "<small>Private</small>"
    });
  });

  it("sorts sparse metadata deterministically and normalizes preview limits", async () => {
    const formats: readonly PrintFormatDefinition[] = [
      definePrintFormat({ name: "Module Z", module: "Z", doctype: "Doc A", sections: [{ fields: [{ field: "title" }] }] }),
      definePrintFormat({ name: "Name Z", label: "Same", doctype: "Doc A", sections: [{ fields: [{ field: "title" }] }] }),
      definePrintFormat({ name: "Name A", label: "Same", doctype: "Doc A", sections: [{ fields: [{ field: "title" }] }] }),
      definePrintFormat({ name: "Label A", label: "Alpha", doctype: "Doc A", sections: [{ fields: [{ field: "title" }] }] }),
      definePrintFormat({ name: "Doc A", doctype: "Doc Z", sections: [{ fields: [{ field: "title" }] }] })
    ];
    const letterheads: readonly PrintLetterheadDefinition[] = [
      definePrintLetterhead({ name: "Letter Z", label: "Same", headerHtml: "Z" }),
      definePrintLetterhead({ name: "Letter A", label: "Same", headerHtml: "A" }),
      definePrintLetterhead({ name: "Alpha", headerHtml: "Alpha" })
    ];
    const settings: PrintSettingsState = { tenantId: "acme", version: 0, settings: {} };
    const limits: number[] = [];
    const service = new PrintingWorkspaceService({
      prints: {
        listPrintFormats: () => formats,
        getPrintFormat: (_actor, name) => formats.find((format) => format.name === name)!,
        listPrintLetterheads: () => letterheads,
        getPrintLetterhead: (_actor, name) => letterheads.find((letterhead) => letterhead.name === name)!
      },
      printSettings: {
        defaultsFor: async () => settings,
        canAdminister: () => true
      },
      queries: {
        listDocumentsForAction: async (_actor, _doctype, _action, options) => {
          const limit = options?.limit ?? 0;
          limits.push(limit);
          return { data: [], total: 0, limit, offset: 0 };
        }
      }
    });

    await expect(service.overview(owner)).resolves.toMatchObject({
      canManageDefaultLayout: true,
      formats: [
        { name: "Label A" },
        { name: "Name A" },
        { name: "Name Z" },
        { name: "Doc A" },
        { name: "Module Z" }
      ],
      letterheads: [{ name: "Alpha" }, { name: "Letter A" }, { name: "Letter Z" }]
    });
    await expect(service.inspectFormat(owner, "Name A", Number.NaN)).resolves.toMatchObject({
      previewDocuments: []
    });
    await service.inspectFormat(owner, "Name A", 0);
    await service.inspectFormat(owner, "Name A", Number.POSITIVE_INFINITY);
    await service.inspectFormat(owner, "Name A", 100);
    expect(limits).toEqual([20, 1, 20, 50]);
  });

  it("lists only preview documents that satisfy the format permissionAction", async () => {
    const { registry, documents, printing } = createServices(["preview-allowed", "preview-denied"]);
    registry.registerDocType(defineDocType({
      name: "Workspace Action Doc",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "preview_allowed", type: "boolean" }
      ],
      permissions: [
        { roles: ["User"], actions: ["read", "create"] },
        {
          roles: ["User"],
          actions: ["update"],
          when: ({ document }) => document === undefined || document.data.preview_allowed === true
        }
      ]
    }));
    registry.registerPrintFormat(definePrintFormat({
      name: "Workspace Action Format",
      doctype: "Workspace Action Doc",
      permissionAction: "update",
      sections: [{ fields: [{ field: "title" }] }],
      roles: ["User"]
    }));
    await documents.create({
      actor: owner,
      doctype: "Workspace Action Doc",
      data: { title: "Preview Allowed", preview_allowed: true }
    });
    await documents.create({
      actor: owner,
      doctype: "Workspace Action Doc",
      data: { title: "Preview Denied", preview_allowed: false }
    });

    await expect(printing.inspectFormat(owner, "Workspace Action Format")).resolves.toMatchObject({
      previewDocuments: [{ name: "Preview Allowed" }]
    });
  });
});

async function makePrintingWorkspace() {
  const Invoice = defineDocType({
    name: "Workspace Invoice Doc",
    module: "Billing",
    naming: { kind: "field", field: "title" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "amount", type: "number" },
      {
        name: "internal_note",
        type: "text",
        permissions: [{ roles: ["Billing Manager"], actions: ["read"] }]
      }
    ],
    permissions: [{ roles: ["User", SYSTEM_MANAGER_ROLE], actions: ["read", "create"] }]
  });
  const letterhead = definePrintLetterhead({
    name: "Workspace Letterhead",
    label: "Primary Letterhead",
    headerHtml: "<strong>Acme Billing</strong>",
    footerHtml: "<small>Private</small>",
    roles: ["User"]
  });
  const format = definePrintFormat({
    name: "Workspace Invoice",
    label: "Invoice",
    module: "Billing",
    description: "Customer invoice output.",
    doctype: Invoice.name,
    letterhead: letterhead.name,
    sections: [{ fields: [{ field: "title" }, { field: "amount" }, { field: "internal_note" }] }],
    layout: { orientation: "landscape", font: { sizePt: 11 } },
    roles: ["User"]
  });
  const registry = createRegistry({ doctypes: [Invoice], printFormats: [format], letterheads: [letterhead] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(["workspace-invoice-event"])
  });
  const queries = new QueryService({ registry, projections: store });
  const printSettings = new PrintSettingsService({
    events: store,
    clock: fixedClock(now),
    ids: deterministicIds(["workspace-settings-event"])
  });
  const prints = new PrintService({ registry, queries, printSettings });
  const service = new PrintingWorkspaceService({ prints, printSettings, queries });
  const admin: Actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
  await printSettings.change({
    actor: admin,
    settings: {
      defaultLayout: {
        pageSize: "A4",
        orientation: "portrait",
        margins: { topMm: 12, rightMm: 10, bottomMm: 12, leftMm: 10 },
        font: { family: "Inter", sizePt: 10 }
      }
    }
  });
  await documents.create({ actor: owner, doctype: Invoice.name, data: { title: "INV-1", amount: 120 } });
  return { service };
}
