import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  FieldDefinition,
  JsonValue
} from "../../core/types";

export interface DeskLayoutOptions {
  readonly title: string;
  readonly body: string;
  readonly active?: string;
  readonly doctypes: readonly DocTypeDefinition[];
  readonly message?: string;
}

export function renderDeskLayout(options: DeskLayoutOptions): string {
  const nav = options.doctypes
    .map(
      (doctype) =>
        `<a class="nav-link${doctype.name === options.active ? " is-active" : ""}" href="/desk/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a>`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} - cf-frappe Desk</title>
  <style>${deskCss()}</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <aside class="sidebar" aria-label="DocTypes">
    <a class="brand" href="/desk">cf-frappe</a>
    <nav>${nav}</nav>
  </aside>
  <main id="main" class="main">
    <header class="topbar">
      <div>
        <p class="kicker">Desk</p>
        <h1>${escapeHtml(options.title)}</h1>
      </div>
    </header>
    ${options.message ? `<p class="notice" role="status">${escapeHtml(options.message)}</p>` : ""}
    ${options.body}
  </main>
</body>
</html>`;
}

export function renderDeskHome(doctypes: readonly DocTypeDefinition[]): string {
  const rows = doctypes
    .map(
      (doctype) => `<tr>
        <td><a href="/desk/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a></td>
        <td>${escapeHtml(doctype.module ?? "")}</td>
        <td>${String(doctype.fields.length)}</td>
        <td>${escapeHtml(doctype.description ?? "")}</td>
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>DocType</th><th>Module</th><th>Fields</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable DocTypes.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderListView(
  doctype: DocTypeDefinition,
  documents: readonly DocumentSnapshot[]
): string {
  const fields = visibleListFields(doctype);
  const header = fields.map((field) => `<th>${escapeHtml(field.label ?? field.name)}</th>`).join("");
  const rows = documents
    .map((document) => {
      const cells = fields
        .map((field) => `<td>${escapeHtml(formatValue(document.data[field.name]))}</td>`)
        .join("");
      return `<tr>
        <td><a href="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}">${escapeHtml(document.name)}</a></td>
        ${cells}
        <td>${String(document.version)}</td>
        <td>${escapeHtml(document.updatedAt)}</td>
      </tr>`;
    })
    .join("");
  return `<section class="toolbar">
    <a class="button primary" href="/desk/${encodeURIComponent(doctype.name)}/new">New ${escapeHtml(labelFor(doctype))}</a>
  </section>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th>${header}<th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${fields.length + 3}" class="empty">No documents yet.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderFormView(
  doctype: DocTypeDefinition,
  options: {
    readonly mode: "create" | "update";
    readonly document?: DocumentSnapshot;
    readonly error?: string;
  }
): string {
  const action =
    options.mode === "create"
      ? `/desk/${encodeURIComponent(doctype.name)}`
      : `/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document?.name ?? "")}`;
  const title = options.mode === "create" ? `New ${labelFor(doctype)}` : options.document?.name ?? doctype.name;
  const fields = doctype.fields
    .filter((field) => !field.hidden)
    .map((field) => renderField(field, options.document?.data[field.name], options.mode))
    .join("");
  const commands =
    options.mode === "update" && doctype.commands?.length
      ? `<section class="command-row" aria-label="Commands">${doctype.commands
          .map(
            (command) =>
              `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document?.name ?? "")}/command/${encodeURIComponent(command.name)}">${escapeHtml(command.name)}</button>`
          )
          .join("")}</section>`
      : "";
  const versionField = options.document
    ? `<input type="hidden" name="expectedVersion" value="${String(options.document.version)}">`
    : "";
  return `<form class="panel form" method="post" action="${action}">
    <div class="form-head">
      <h2>${escapeHtml(title)}</h2>
      ${options.document ? `<p>v${String(options.document.version)} · ${escapeHtml(options.document.docstatus)}</p>` : ""}
    </div>
    ${versionField}
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    <div class="fields">${fields}</div>
    <div class="actions">
      <a class="button" href="/desk/${encodeURIComponent(doctype.name)}">Cancel</a>
      <button class="button primary" type="submit">${options.mode === "create" ? "Create" : "Save"}</button>
    </div>
    ${commands}
  </form>`;
}

export function renderNotFound(message: string): string {
  return `<section class="panel"><p class="empty">${escapeHtml(message)}</p></section>`;
}

export function renderErrorPanel(message: string): string {
  return `<section class="panel"><p class="error" role="alert">${escapeHtml(message)}</p></section>`;
}

function renderField(field: FieldDefinition, value: JsonValue | undefined, mode: "create" | "update"): string {
  const id = `field-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const required = field.required ? " required" : "";
  const readonly = field.readOnly || (mode === "update" && field.readOnly) ? " readonly" : "";
  const common = `id="${id}" name="${escapeHtml(field.name)}"${required}${readonly}`;
  const formatted = formatFormValue(value);
  const help = field.readOnly ? `<small>Read only</small>` : "";
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}"${option === formatted ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("");
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><select ${common}>${options}</select>${help}</label>`;
  }
  if (field.type === "longText" || field.type === "json") {
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><textarea ${common}>${escapeHtml(formatted)}</textarea>${help}</label>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}>${help}</label>`;
}

function inputType(field: FieldDefinition): string {
  switch (field.type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "boolean":
      return "checkbox";
    default:
      return "text";
  }
}

function visibleListFields(doctype: DocTypeDefinition): readonly FieldDefinition[] {
  return doctype.fields.filter((field) => !field.hidden).slice(0, 5);
}

function labelFor(doctype: DocTypeDefinition): string {
  return doctype.label ?? doctype.name;
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

function formatFormValue(value: JsonValue | undefined): string {
  return formatValue(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
}

function deskCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #d9dee7;
  --text: #1f2937;
  --muted: #5b6472;
  --primary: #185abc;
  --primary-dark: #123f83;
  --danger: #b42318;
  --focus: #b45309;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
a { color: var(--primary); }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.skip-link {
  position: absolute;
  left: 12px;
  top: -48px;
  background: var(--surface);
  padding: 8px 12px;
  border: 1px solid var(--border);
  z-index: 2;
}
.skip-link:focus { top: 12px; }
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 240px;
  padding: 20px 14px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.brand {
  display: block;
  margin: 0 8px 20px;
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}
.nav-link {
  display: block;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.nav-link:hover, .nav-link.is-active { background: #e9eef7; }
.main { margin-left: 240px; padding: 24px; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.kicker {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 28px; line-height: 1.2; }
h2 { font-size: 20px; line-height: 1.3; }
.toolbar { margin-bottom: 16px; }
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}
tr:last-child td { border-bottom: 0; }
.empty { color: var(--muted); }
.notice, .error {
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
}
.error {
  color: var(--danger);
  background: #fef3f2;
  border-color: #fecdca;
}
.form { padding: 18px; max-width: 860px; }
.form-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.form-head p { margin: 0; color: var(--muted); }
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.field { display: grid; gap: 6px; }
.field span { font-weight: 650; }
.field small { color: var(--muted); }
input, select, textarea {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  padding: 9px 10px;
  font: inherit;
}
textarea { min-height: 120px; resize: vertical; }
input[readonly], textarea[readonly] { background: #f3f4f6; color: var(--muted); }
.actions, .command-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.command-row {
  justify-content: flex-start;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 650;
  text-decoration: none;
  cursor: pointer;
}
.button.primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.button.primary:hover { background: var(--primary-dark); }
@media (max-width: 760px) {
  .sidebar {
    position: static;
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .main { margin-left: 0; padding: 16px; }
  .topbar, .form-head { align-items: flex-start; flex-direction: column; }
  .fields { grid-template-columns: 1fr; }
}`;
}
