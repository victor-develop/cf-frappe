import type { PrintDocumentView, PrintFieldView } from "../../application/print-service";
import type { JsonValue } from "../../core/types";

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
    <header class="print-header">
      <p>${escapeHtml(view.document.doctype)}</p>
      <h1>${escapeHtml(view.document.name)}</h1>
      <span>${escapeHtml(view.format.label ?? view.format.name)}</span>
    </header>
    ${sections}
    <footer class="print-footer">Version ${String(view.document.version)} · ${escapeHtml(view.document.updatedAt)}</footer>
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

function formatValue(value: JsonValue): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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
.print-footer { padding-top: 18px; font-size: 12px; }
@media print {
  body { background: #fff; }
  .print-page { width: auto; min-height: 0; margin: 0; padding: 0; border: 0; }
}
@media (max-width: 640px) {
  .print-page { padding: 24px; }
  dl { grid-template-columns: 1fr; }
}`;
}
