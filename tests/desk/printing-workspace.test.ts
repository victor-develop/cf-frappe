import {
  createDeskApp,
  createRegistry,
  defineDocType,
  definePrintFormat,
  definePrintLetterhead,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  PrintService,
  PrintSettingsService,
  PrintingWorkspaceService,
  QueryService,
  type Actor,
  type PrintPdfRenderer,
  type RenderPrintPdfCommand
} from "../../src";
import { now, owner } from "../helpers";

class WorkspacePdfRenderer implements PrintPdfRenderer {
  readonly calls: RenderPrintPdfCommand[] = [];

  async render(command: RenderPrintPdfCommand) {
    this.calls.push(command);
    return { body: new Uint8Array([37, 80, 68, 70]) };
  }
}

describe("Desk Printing workspace", () => {
  it("lists read-only resources and previews only authorized fields and documents", async () => {
    const { app, documents } = makePrintingDesk(owner);
    await documents.create({ actor: owner, doctype: "Printing Doc", data: { title: "PRINT-1" } });

    const overview = await app.request("/desk/printing");
    expect(overview.status).toBe(200);
    const overviewHtml = await overview.text();
    expect(overviewHtml).toContain('<a class="nav-link is-active" href="/desk/printing">Printing</a>');
    expect(overviewHtml).toContain("/desk/printing/formats/Printing%20Summary");
    expect(overviewHtml).toContain("/desk/printing/letterheads/Printing%20Letterhead");
    expect(overviewHtml).not.toContain('action="/desk/printing/default-layout"');

    const detail = await app.request("/desk/printing/formats/Printing%20Summary");
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain("Preview Documents");
    expect(detailHtml).toContain("/desk/print/Printing%20Summary/PRINT-1");
    expect(detailHtml).not.toContain("/desk/print/Printing%20Summary/PRINT-1/pdf");
    expect(detailHtml).toContain("title");
    expect(detailHtml).not.toContain("secret");
  });

  it("shows PDF preview actions only when the renderer is configured", async () => {
    const renderer = new WorkspacePdfRenderer();
    const { app, documents } = makePrintingDesk(owner, renderer);
    await documents.create({ actor: owner, doctype: "Printing Doc", data: { title: "PRINT-2" } });

    const detail = await app.request("/desk/printing/formats/Printing%20Summary");

    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("/desk/print/Printing%20Summary/PRINT-2/pdf");
  });

  it("escapes Letterhead HTML and hides resources from unauthorized actors", async () => {
    const { app } = makePrintingDesk(owner);
    const letterhead = await app.request("/desk/printing/letterheads/Printing%20Letterhead");
    const html = await letterhead.text();

    expect(letterhead.status).toBe(200);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");

    const guest: Actor = { id: "guest", roles: ["Guest"], tenantId: "acme" };
    const guestDesk = makePrintingDesk(guest).app;
    const overview = await guestDesk.request("/desk/printing");
    const overviewHtml = await overview.text();
    expect(overview.status).toBe(200);
    expect(overviewHtml).not.toContain("Printing Summary");
    expect(overviewHtml).not.toContain("Printing Letterhead");
    expect((await guestDesk.request("/desk/printing/formats/Printing%20Summary")).status).toBe(403);
    expect((await guestDesk.request("/desk/printing/letterheads/Printing%20Letterhead")).status).toBe(403);
  });
});

function makePrintingDesk(actor: Actor, renderer?: PrintPdfRenderer) {
  const Document = defineDocType({
    name: "Printing Doc",
    naming: { kind: "field", field: "title" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "secret", type: "text", permissions: [{ roles: ["Manager"], actions: ["read"] }] }
    ],
    permissions: [{ roles: ["User"], actions: ["read", "create"] }]
  });
  const letterhead = definePrintLetterhead({
    name: "Printing Letterhead",
    headerHtml: "<img src=x onerror=alert(1)>",
    footerHtml: "<strong>Footer</strong>",
    roles: ["User"]
  });
  const format = definePrintFormat({
    name: "Printing Summary",
    doctype: Document.name,
    letterhead: letterhead.name,
    sections: [{ fields: [{ field: "title" }, { field: "secret" }] }],
    roles: ["User"]
  });
  const registry = createRegistry({ doctypes: [Document], printFormats: [format], letterheads: [letterhead] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(["printing-document-event"])
  });
  const queries = new QueryService({ registry, projections: store });
  const printSettings = new PrintSettingsService({ events: store });
  const prints = new PrintService({ registry, queries, printSettings });
  const printing = new PrintingWorkspaceService({ prints, printSettings, queries });
  const app = createDeskApp({
    registry,
    documents,
    queries,
    prints,
    printing,
    printSettings,
    ...(renderer === undefined ? {} : { printPdfRenderer: renderer }),
    actor: () => actor
  });
  return { app, documents };
}
