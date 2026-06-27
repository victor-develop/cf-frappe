import {
  createResourceApi,
  defineDocType,
  definePrintFormat,
  definePrintLetterhead,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver,
  type PrintPdfRenderer,
  type RenderPrintPdfCommand,
  type RenderedPrintPdf
} from "../../src";
import { createServices, data, owner } from "../helpers";

class RecordingPrintPdfRenderer implements PrintPdfRenderer {
  readonly calls: RenderPrintPdfCommand[] = [];

  constructor(private readonly result: RenderedPrintPdf = { body: new Uint8Array([37, 80, 68, 70]) }) {}

  async render(command: RenderPrintPdfCommand): Promise<RenderedPrintPdf> {
    this.calls.push(command);
    return this.result;
  }
}

describe("print api", () => {
  const userHeaders = {
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };
  const adminHeaders = {
    "x-cf-frappe-user": "admin@example.com",
    "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
    "x-cf-frappe-tenant": "acme"
  };

  function makeApp(options: { readonly printPdfRenderer?: PrintPdfRenderer } = {}) {
    const services = createServices(["e1"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      printSettings: services.printSettings,
      ...(options.printPdfRenderer === undefined ? {} : { printPdfRenderer: options.printPdfRenderer }),
      queries: services.queries,
      reports: services.reports,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  it("lists print format metadata", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/print-formats?doctype=Note", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Note Standard", doctype: "Note" }]
    });
  });

  it("lists and reads print letterhead metadata through the print service boundary", async () => {
    const { app, services } = makeApp();
    services.registry.registerPrintLetterhead(
      definePrintLetterhead({
        name: "Company Letterhead",
        label: "Company",
        headerHtml: "<strong>ACME</strong>",
        footerHtml: "<small>Registered office</small>"
      })
    );
    services.registry.registerPrintLetterhead(
      definePrintLetterhead({
        name: "Managers Only",
        headerHtml: "<strong>Managers</strong>",
        roles: ["Task Manager"]
      })
    );

    const list = await app.request("/api/meta/print-letterheads", { headers: userHeaders });
    const item = await app.request("/api/meta/print-letterheads/Company%20Letterhead", { headers: userHeaders });
    const denied = await app.request("/api/meta/print-letterheads/Managers%20Only", { headers: userHeaders });

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: [{ name: "Company Letterhead", label: "Company" }]
    });
    expect(item.status).toBe(200);
    await expect(item.json()).resolves.toMatchObject({
      data: {
        name: "Company Letterhead",
        headerHtml: "<strong>ACME</strong>",
        footerHtml: "<small>Registered office</small>"
      }
    });
    expect(denied.status).toBe(403);
  });

  it("renders a printable document as HTML", async () => {
    const { app, services } = makeApp();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Printable", priority: "High", body: "<script>alert('x')</script>" })
    });

    const response = await app.request("/api/print/Note%20Standard/Printable", { headers: userHeaders });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Printable");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("omits print-hidden DocType fields from section and template HTML", async () => {
    const { app, services } = makeApp();
    services.registry.registerDocType(defineDocType({
      name: "Printable Secret",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "public_note", type: "text" },
        { name: "internal_note", type: "longText", printHide: true }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }]
    }));
    services.registry.registerPrintFormat(definePrintFormat({
      name: "Printable Secret Standard",
      doctype: "Printable Secret",
      sections: [
        {
          fields: [
            { field: "title", label: "Title" },
            { field: "public_note", label: "Public Note" },
            { field: "internal_note", label: "Internal Note" }
          ]
        }
      ],
      roles: ["User"]
    }));
    services.registry.registerPrintFormat(definePrintFormat({
      name: "Printable Secret Template",
      doctype: "Printable Secret",
      template: "<p>{{ doc.title }}</p><p>{{ doc.public_note }}</p><p>{{ doc.internal_note }}</p>",
      roles: ["User"]
    }));
    await services.documents.create({
      actor: owner,
      doctype: "Printable Secret",
      data: { title: "Public Memo", public_note: "Share this", internal_note: "Do not print" }
    });

    const sectionResponse = await app.request("/api/print/Printable%20Secret%20Standard/Public%20Memo", { headers: userHeaders });
    const templateResponse = await app.request("/api/print/Printable%20Secret%20Template/Public%20Memo", { headers: userHeaders });

    expect(sectionResponse.status).toBe(200);
    const sectionHtml = await sectionResponse.text();
    expect(sectionHtml).toContain("Share this");
    expect(sectionHtml).not.toContain("Internal Note");
    expect(sectionHtml).not.toContain("Do not print");

    expect(templateResponse.status).toBe(200);
    const templateHtml = await templateResponse.text();
    expect(templateHtml).toContain("Share this");
    expect(templateHtml).not.toContain("Do not print");
  });

  it("omits print-hide-if-no-value DocType fields from section and template HTML only when empty", async () => {
    const { app, services } = makeApp();
    services.registry.registerDocType(defineDocType({
      name: "Printable Optional",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "empty_note", type: "text", printHideIfNoValue: true },
        { name: "zero_count", type: "integer", printHideIfNoValue: true }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }]
    }));
    services.registry.registerPrintFormat(definePrintFormat({
      name: "Printable Optional Standard",
      doctype: "Printable Optional",
      sections: [
        {
          fields: [
            { field: "title", label: "Title" },
            { field: "empty_note", label: "Empty Note" },
            { field: "zero_count", label: "Zero Count" }
          ]
        }
      ],
      roles: ["User"]
    }));
    services.registry.registerPrintFormat(definePrintFormat({
      name: "Printable Optional Template",
      doctype: "Printable Optional",
      template: "<p>{{ doc.title }}</p><p>{{ doc.empty_note }}</p><p>{{ doc.zero_count }}</p>",
      roles: ["User"]
    }));
    await services.documents.create({
      actor: owner,
      doctype: "Printable Optional",
      data: { title: "Optional Memo", empty_note: "", zero_count: 0 }
    });

    const sectionResponse = await app.request("/api/print/Printable%20Optional%20Standard/Optional%20Memo", { headers: userHeaders });
    const templateResponse = await app.request("/api/print/Printable%20Optional%20Template/Optional%20Memo", { headers: userHeaders });

    expect(sectionResponse.status).toBe(200);
    const sectionHtml = await sectionResponse.text();
    expect(sectionHtml).not.toContain("Empty Note");
    expect(sectionHtml).toContain("Zero Count");
    expect(sectionHtml).toContain(">0<");

    expect(templateResponse.status).toBe(200);
    const templateHtml = await templateResponse.text();
    expect(templateHtml).toContain("Optional Memo");
    expect(templateHtml).toContain(">0<");
  });

  it("exposes print layout metadata and renders it into printable HTML", async () => {
    const { app, services } = makeApp();
    services.registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Layout",
        doctype: "Note",
        sections: [{ fields: [{ field: "title", label: "Title" }, { field: "body", label: "Body" }] }],
        layout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
          font: { family: "Inter", sizePt: 10 }
        }
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Layout Note", priority: "High", body: "Layout body" })
    });

    const metadata = await app.request("/api/meta/print-formats/Note%20Layout", { headers: userHeaders });
    await expect(metadata.json()).resolves.toMatchObject({
      data: {
        name: "Note Layout",
        layout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
          font: { family: "Inter", sizePt: 10 }
        }
      }
    });

    const response = await app.request("/api/print/Note%20Layout/Layout%20Note", { headers: userHeaders });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("@page { size: A4 landscape; margin: 12mm 10mm 14mm 10mm; }");
    expect(html).toContain('--print-page-padding: 12mm 10mm 14mm 10mm;');
    expect(html).toContain('--print-font-family: "Inter", ui-serif, Georgia, Cambria, "Times New Roman", serif;');
    expect(html).toContain("--print-font-size: 10pt;");
  });

  it("stores global print settings and applies them as print layout defaults", async () => {
    const { app, services } = makeApp();
    services.registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Margin Override",
        doctype: "Note",
        sections: [{ fields: [{ field: "title", label: "Title" }] }],
        layout: {
          margins: { topMm: 6 }
        }
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Settings Print", priority: "High", body: "Settings body" })
    });

    const updated = await app.request("/api/print-settings", {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 0,
        defaultLayout: {
          pageSize: "Letter",
          orientation: "portrait",
          margins: { topMm: 12, rightMm: 11, bottomMm: 13, leftMm: 11 },
          font: { family: "Inter", sizePt: 10 }
        }
      })
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        version: 1,
        settings: {
          defaultLayout: {
            pageSize: "Letter",
            orientation: "portrait",
            margins: { topMm: 12, rightMm: 11, bottomMm: 13, leftMm: 11 },
            font: { family: "Inter", sizePt: 10 }
          }
        }
      }
    });

    const settingsResponse = await app.request("/api/print-settings", { headers: adminHeaders });
    await expect(settingsResponse.json()).resolves.toMatchObject({
      data: { version: 1, settings: { defaultLayout: { pageSize: "Letter" } } }
    });

    const standard = await app.request("/api/print/Note%20Standard/Settings%20Print", { headers: userHeaders });
    const overridden = await app.request("/api/print/Note%20Margin%20Override/Settings%20Print", { headers: userHeaders });

    expect(await standard.text()).toContain("@page { size: Letter portrait; margin: 12mm 11mm 13mm 11mm; }");
    expect(await overridden.text()).toContain("@page { size: Letter portrait; margin: 6mm 11mm 13mm 11mm; }");
  });

  it("renders a printable document as PDF through the configured renderer", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const renderer = new RecordingPrintPdfRenderer({ body: pdf, contentLength: pdf.byteLength });
    const { app, services } = makeApp({ printPdfRenderer: renderer });
    services.registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Layout",
        doctype: "Note",
        sections: [{ fields: [{ field: "title", label: "Title" }, { field: "body", label: "Body" }] }],
        layout: {
          pageSize: "A4",
          orientation: "portrait",
          margins: { topMm: 8, rightMm: 8, bottomMm: 12, leftMm: 8 },
          font: { family: "Inter", sizePt: 11 }
        }
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Printable", priority: "High", body: "<script>alert('x')</script>" })
    });

    const response = await app.request("/api/print/Note%20Layout/Printable/pdf", { headers: userHeaders });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Printable.Note-Layout.pdf"');
    expect(response.headers.get("content-length")).toBe(String(pdf.byteLength));
    await expect(response.arrayBuffer()).resolves.toEqual(pdf.buffer);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0]).toMatchObject({
      actorId: owner.id,
      tenantId: owner.tenantId,
      formatName: "Note Layout",
      documentName: "Printable",
      documentDoctype: "Note",
      title: "Note Layout - Printable",
      layout: {
        pageSize: "A4",
        orientation: "portrait",
        margins: { topMm: 8, rightMm: 8, bottomMm: 12, leftMm: 8 },
        font: { family: "Inter", sizePt: 11 }
      }
    });
    expect(renderer.calls[0]?.html).toContain("Printable");
    expect(renderer.calls[0]?.html).toContain("@page { size: A4 portrait; margin: 8mm 8mm 12mm 8mm; }");
    expect(renderer.calls[0]?.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("rejects PDF rendering when no renderer is configured", async () => {
    const { app, services } = makeApp();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Printable", priority: "Low", body: "Body" })
    });

    const response = await app.request("/api/print/Note%20Standard/Printable/pdf", { headers: userHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: "PDF print rendering is not configured"
      }
    });
  });

  it("renders custom print templates with escaped document values", async () => {
    const { app, services } = makeApp();
    services.registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Template",
        label: "Templated Note",
        doctype: "Note",
        template: [
          "<article><h2>{{ doc.title }}</h2>",
          "<p>{{ doc.body }}</p>",
          "<small>{{ format.label }} / {{ doc.name }}</small></article>"
        ].join("")
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Template Note", priority: "High", body: "<script>alert('x')</script>" })
    });

    const response = await app.request("/api/print/Note%20Template/Template%20Note", { headers: userHeaders });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<article><h2>Template Note</h2>");
    expect(html).toContain("<small>Templated Note / Template Note</small>");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("renders print letterhead header and footer HTML", async () => {
    const { app, services } = makeApp();
    services.registry.registerPrintLetterhead(
      definePrintLetterhead({
        name: "Company Letterhead",
        headerHtml: '<div class="brand">ACME Cloud</div>',
        footerHtml: "<small>Confidential</small>"
      })
    );
    services.registry.registerPrintFormat(
      definePrintFormat({
        name: "Note Letterhead",
        doctype: "Note",
        letterhead: "Company Letterhead",
        sections: [{ fields: [{ field: "title", label: "Title" }] }]
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Letterheaded", priority: "High", body: "Ready" })
    });

    const response = await app.request("/api/print/Note%20Letterhead/Letterheaded", { headers: userHeaders });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<section class="print-letterhead print-letterhead-header"><div class="brand">ACME Cloud</div></section>');
    expect(html).toContain("<dd>Letterheaded</dd>");
    expect(html).toContain('<section class="print-letterhead print-letterhead-footer"><small>Confidential</small></section>');
  });
});
