import { type PrintSettingsState } from "../../src/core/print-settings.js";
import {
  renderPrintFormatInspection,
  renderPrintingWorkspace,
  renderPrintLetterheadInspection,
  renderPrintSettingsAdmin
} from "../../src/adapters/desk/views/printing.js";

function settings(defaultLayout?: PrintSettingsState["settings"]["defaultLayout"]): PrintSettingsState {
  return {
    tenantId: "tenant-a",
    version: 2,
    settings: defaultLayout === undefined ? {} : { defaultLayout }
  };
}

describe("Desk printing views", () => {
  it("renders the editable settings form with defaults when options are omitted", () => {
    const html = renderPrintSettingsAdmin(settings());
    expect(html).toContain('action="/desk/admin/print-settings"');
    expect(html).toContain('name="pageSize"');
    expect(html).toContain("Clear Default Layout");
    expect(html).not.toContain('class="notice error"');
  });

  it("renders an error notice, custom action, and selected layout values", () => {
    const html = renderPrintSettingsAdmin(
      settings({
        pageSize: { widthMm: 100, heightMm: 200 },
        orientation: "landscape",
        margins: { topMm: 5, rightMm: 6, bottomMm: 7, leftMm: 8 },
        font: { family: "Inter", sizePt: 11 }
      }),
      { error: "Version conflict", action: "/desk/printing/default-layout" }
    );
    expect(html).toContain("Version conflict");
    expect(html).toContain('action="/desk/printing/default-layout"');
    expect(html).toContain('value="100"');
    expect(html).toContain('value="200"');
    expect(html).toContain('value="Inter"');
    expect(html).toContain('value="11"');
  });

  it("renders selected named page size and orientation options", () => {
    const html = renderPrintSettingsAdmin(settings({ pageSize: "A4", orientation: "portrait" }));
    expect(html).toContain('<option value="A4" selected>A4</option>');
    expect(html).toContain('<option value="portrait" selected>Portrait</option>');
    expect(html).toContain('<option value="landscape">Landscape</option>');
  });

  it("renders a read-only layout panel when not editable", () => {
    const html = renderPrintSettingsAdmin(settings(), { editable: false, error: "Denied" });
    expect(html).toContain("No tenant default is configured.");
    expect(html).toContain("Denied");
    expect(html).not.toContain("<form");
  });

  it("renders read-only layout details for a configured default layout", () => {
    const html = renderPrintSettingsAdmin(settings({ pageSize: "A5" }), { editable: false });
    expect(html).toContain("<dd>A5</dd>");
    expect(html).toContain("<dd>Renderer default</dd>");
  });

  it("renders an empty printing workspace", () => {
    const html = renderPrintingWorkspace({
      formats: [],
      letterheads: [],
      settings: settings(),
      canManageDefaultLayout: false
    });
    expect(html).toContain("No Print Formats are visible for your roles.");
    expect(html).toContain("No Letterheads are visible for your roles.");
    expect(html).toContain("No tenant default is configured.");
  });

  it("renders grouped formats and letterheads with optional descriptions", () => {
    const html = renderPrintingWorkspace(
      {
        formats: [
          { name: "invoice", label: "Invoice", doctype: "Sales Invoice", module: "Accounts", description: "Default invoice" },
          { name: "invoice-compact", label: "Compact Invoice", doctype: "Sales Invoice", module: "Accounts" },
          { name: "task", label: "Task", doctype: "Task" }
        ],
        letterheads: [{ name: "corp", label: "Corporate" }],
        settings: settings(),
        canManageDefaultLayout: true
      },
      { error: "Save failed" }
    );
    expect(html).toContain("Accounts · Sales Invoice");
    expect(html).toContain("General · Task");
    expect(html).toContain("· Default invoice");
    expect(html).toContain('href="/desk/printing/letterheads/corp"');
    expect(html).toContain("Save failed");
    expect(html).toContain('action="/desk/printing/default-layout"');
  });

  it("renders a minimal format inspection with all fallbacks", () => {
    const html = renderPrintFormatInspection({
      format: { name: "task-print", doctype: "Task" },
      previewDocuments: []
    });
    expect(html).toContain("task-print");
    expect(html).toContain("<dd>-</dd>");
    expect(html).toContain("<dd>read</dd>");
    expect(html).toContain("Any authorized role");
    expect(html).toContain("Not configured");
    expect(html).toContain("No override");
    expect(html).toContain("Renderer defaults");
    expect(html).toContain("No readable documents are available for preview.");
    expect(html).not.toContain("Template Source");
    expect(html).not.toContain("Sections");
  });

  it("renders a fully specified format inspection with PDF links", () => {
    const html = renderPrintFormatInspection(
      {
        format: {
          name: "invoice",
          label: "Invoice Print",
          module: "Accounts",
          description: "Customer facing",
          doctype: "Sales Invoice",
          letterhead: "corp",
          permissionAction: "submit",
          roles: ["Accounts Manager"],
          sections: [
            { heading: "Header", fields: [{ field: "customer", label: "Customer" }] },
            { fields: [{ field: "total" }] }
          ],
          template: "<p>{{ doc.name }}</p>",
          layout: { pageSize: "A4", orientation: "portrait", font: { family: "Inter" } }
        },
        inheritedLayout: { margins: { topMm: 10 }, font: { sizePt: 9 } },
        effectiveLayout: { pageSize: { widthMm: 80, heightMm: 120 }, font: { family: "Mono", sizePt: 8 } },
        previewDocuments: [{ name: "INV-1" }]
      },
      { printPdfEnabled: true }
    );
    expect(html).toContain("Invoice Print");
    expect(html).toContain("Customer facing");
    expect(html).toContain("<dd>Accounts</dd>");
    expect(html).toContain("<dd>submit</dd>");
    expect(html).toContain("Accounts Manager");
    expect(html).toContain('href="/desk/printing/letterheads/corp"');
    expect(html).toContain("<h3>Header</h3>");
    expect(html).toContain("<h3>Fields</h3>");
    expect(html).toContain("Template Source");
    expect(html).toContain("T 10 · R - · B - · L - mm");
    expect(html).toContain("Renderer default · 9 pt");
    expect(html).toContain("80 × 120 mm");
    expect(html).toContain("Mono · 8 pt");
    expect(html).toContain('href="/desk/print/invoice/INV-1"');
    expect(html).toContain('href="/desk/print/invoice/INV-1/pdf"');
  });

  it("hides PDF links when PDF rendering is disabled", () => {
    const html = renderPrintFormatInspection({
      format: { name: "task-print", doctype: "Task" },
      previewDocuments: [{ name: "TASK-1" }]
    });
    expect(html).toContain('href="/desk/print/task-print/TASK-1"');
    expect(html).not.toContain("/pdf");
  });

  it("renders letterhead inspection with fallbacks and with full content", () => {
    const bare = renderPrintLetterheadInspection({ name: "plain" });
    expect(bare).toContain("plain");
    expect(bare).toContain("Any authorized role");

    const full = renderPrintLetterheadInspection({
      name: "corp",
      label: "Corporate",
      headerHtml: "<h1>ACME</h1>",
      footerHtml: "<small>fine print</small>",
      roles: ["System Manager"]
    });
    expect(full).toContain("Corporate");
    expect(full).toContain("System Manager");
    expect(full).toContain("&lt;h1&gt;ACME&lt;/h1&gt;");
    expect(full).toContain("&lt;small&gt;fine print&lt;/small&gt;");
  });
});
