import type { PrintDocumentView, PrintFieldView } from "../../application/print-service.js";
import type { ReportRunResult } from "../../application/report-service.js";
import {
  parsePrintTemplatePath,
  substitutePrintTemplate,
  type PrintTemplateReference
} from "../../core/print-format.js";
import type { JsonValue } from "../../core/types.js";

export function renderPrintDocument(view: PrintDocumentView): string {
  const title = `${view.format.label ?? view.format.name} - ${view.document.name}`;
  const sections = view.sections
    .map(
      (section) => `<section class="print-section">
        ${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ""}
        <dl>${section.fields.map(renderField).join("")}</dl>
      </section>`
    )
    .join("");
  const content = view.format.template && view.format.template.trim().length > 0
    ? `<section class="print-template">${renderTemplate(view.format.template, view)}</section>`
    : sections;
  const letterheadHeader = view.letterhead?.headerHtml
    ? `<section class="print-letterhead print-letterhead-header">${view.letterhead.headerHtml}</section>`
    : "";
  const letterheadFooter = view.letterhead?.footerHtml
    ? `<section class="print-letterhead print-letterhead-footer">${view.letterhead.footerHtml}</section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${printCss()}</style>
</head>
<body>
  <main class="print-page">
    ${letterheadHeader}
    <header class="print-header">
      <p>${escapeHtml(view.document.doctype)}</p>
      <h1>${escapeHtml(view.document.name)}</h1>
      <span>${escapeHtml(view.format.label ?? view.format.name)}</span>
    </header>
    ${content}
    ${letterheadFooter}
    <footer class="print-footer">Version ${String(view.document.version)} · ${escapeHtml(view.document.updatedAt)}</footer>
  </main>
</body>
</html>`;
}

export function renderPrintReport(result: ReportRunResult, options: { readonly title?: string } = {}): string {
  const title = options.title ?? result.report.label ?? result.report.name;
  const filters = result.filters.filter((filter) => filter.value !== undefined && filter.value !== "");
  const filterSection = filters.length > 0
    ? `<section class="print-section report-print-filters">
        <h2>Applied Filters</h2>
        <dl>${filters.map(renderReportFilter).join("")}</dl>
      </section>`
    : "";
  const summarySection = result.summary.length > 0
    ? `<section class="print-section report-print-summary">
        <h2>Summary</h2>
        <dl>${result.summary.map(renderReportSummaryValue).join("")}</dl>
      </section>`
    : "";
  const groups = result.groups.map(renderReportGroup).join("");
  const headers = result.columns.map((column) => `<th>${escapeHtml(column.label ?? column.name)}</th>`).join("");
  const rows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((column) => `<td>${escapeHtml(formatValue(row[column.name]))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Report</title>
  <style>${printCss()}</style>
</head>
<body>
  <main class="print-page report-print-page">
    <header class="print-header">
      <p>${escapeHtml(result.report.doctype)}</p>
      <h1>${escapeHtml(title)}</h1>
      <span>${String(result.total)} total rows</span>
    </header>
    ${filterSection}
    ${summarySection}
    ${groups}
    <section class="print-section report-print-rows">
      <h2>Rows</h2>
      <div class="print-table-wrap">
        <table>
          <thead><tr>${headers}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${String(result.columns.length)}">No rows matched.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
    <footer class="print-footer">Showing ${String(result.rows.length)} of ${String(result.total)} rows</footer>
  </main>
</body>
</html>`;
}

function renderField(field: PrintFieldView): string {
  return `<div class="print-field">
    <dt>${escapeHtml(field.label)}</dt>
    <dd>${escapeHtml(formatValue(field.value))}</dd>
  </div>`;
}

function renderReportFilter(filter: ReportRunResult["filters"][number]): string {
  return `<div class="print-field"><dt>${escapeHtml(reportFilterLabel(filter))}</dt><dd>${escapeHtml(formatValue(filter.value))}</dd></div>`;
}

function renderReportSummaryValue(summary: ReportRunResult["summary"][number]): string {
  return `<div class="print-field"><dt>${escapeHtml(summary.label)}</dt><dd>${escapeHtml(formatValue(summary.value))}</dd></div>`;
}

function renderReportGroup(group: ReportRunResult["groups"][number]): string {
  const summaryHeaders = (group.rows[0]?.summaries ?? [])
    .map((summary) => `<th>${escapeHtml(summary.label)}</th>`)
    .join("");
  const rows = group.rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td>${row.summaries
          .map((summary) => `<td>${escapeHtml(formatValue(summary.value))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<section class="print-section report-print-group">
    <h2>${escapeHtml(group.label)}</h2>
    <div class="print-table-wrap">
      <table>
        <thead><tr><th>${escapeHtml(group.field)}</th>${summaryHeaders}</tr></thead>
        <tbody>${rows || `<tr><td colspan="2">No rows matched.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function reportFilterLabel(filter: ReportRunResult["filters"][number]): string {
  return filter.label === filter.name || filter.label === filter.field ? humanizeIdentifier(filter.label) : filter.label;
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderTemplate(template: string, view: PrintDocumentView): string {
  return substitutePrintTemplate(template, (path) => escapeHtml(formatValue(resolveTemplateValue(path, view))));
}

function resolveTemplateValue(path: string, view: PrintDocumentView): JsonValue {
  const reference = parsePrintTemplatePath(path);
  if (!reference) {
    return "";
  }
  if (reference.scope === "format") {
    return formatMetadata(reference.field, view);
  }
  if (reference.kind === "metadata") {
    return documentMetadata(reference.field, view);
  }
  return view.document.data[reference.field] ?? null;
}

function documentMetadata(
  field: Extract<PrintTemplateReference, { readonly scope: "doc"; readonly kind: "metadata" }>["field"],
  view: PrintDocumentView
): JsonValue {
  switch (field) {
    case "doctype":
      return view.document.doctype;
    case "name":
      return view.document.name;
    case "tenantId":
      return view.document.tenantId;
    case "version":
      return view.document.version;
    case "docstatus":
      return view.document.docstatus;
    case "createdAt":
      return view.document.createdAt;
    case "updatedAt":
      return view.document.updatedAt;
  }
}

function formatMetadata(
  field: Extract<PrintTemplateReference, { readonly scope: "format" }>["field"],
  view: PrintDocumentView
): JsonValue {
  switch (field) {
    case "doctype":
      return view.format.doctype;
    case "name":
      return view.format.name;
    case "label":
      return view.format.label ?? null;
    case "module":
      return view.format.module ?? null;
    case "description":
      return view.format.description ?? null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printCss(): string {
  return `
:root {
  color-scheme: light;
  --text: #111827;
  --muted: #5b6472;
  --border: #d9dee7;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--text);
  background: #f5f6f8;
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.55;
}
.print-page {
  width: min(840px, calc(100vw - 32px));
  min-height: calc(100vh - 32px);
  margin: 16px auto;
  padding: 40px;
  background: #fff;
  border: 1px solid var(--border);
}
.print-header {
  display: grid;
  gap: 4px;
  padding-bottom: 18px;
  border-bottom: 2px solid var(--text);
}
.print-header p, .print-header span, .print-footer {
  margin: 0;
  color: var(--muted);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 30px; line-height: 1.2; }
h2 { font-size: 18px; line-height: 1.3; margin-bottom: 12px; }
.print-letterhead {
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.print-letterhead-header {
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.print-letterhead-footer {
  padding-top: 18px;
  margin-top: 18px;
  border-top: 1px solid var(--border);
}
.print-section { padding: 22px 0; border-bottom: 1px solid var(--border); }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; margin: 0; }
dt {
  color: var(--muted);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
dd { margin: 4px 0 0; white-space: pre-wrap; }
.print-table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
}
th, td {
  padding: 8px 10px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
}
.print-footer { padding-top: 18px; font-size: 12px; }
@media print {
  body { background: #fff; }
  .print-page { width: auto; min-height: 0; margin: 0; padding: 0; border: 0; }
  .print-table-wrap { overflow: visible; }
}
@media (max-width: 640px) {
  .print-page { padding: 24px; }
  dl { grid-template-columns: 1fr; }
}`;
}
