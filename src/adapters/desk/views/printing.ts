import { PRINT_PAGE_ORIENTATIONS, PRINT_PAGE_SIZE_NAMES, type PrintLayoutDefinition, type PrintLetterheadDefinition } from "../../../core/print-format.js";
import { type PrintFormatInspection, type PrintingWorkspaceOverview } from "../../../application/printing-workspace-service.js";
import { type PrintSettingsState } from "../../../core/print-settings.js";
import { escapeHtml } from "./shared.js";

export function renderPrintSettingsAdmin(
  state: PrintSettingsState,
  options: {
    readonly error?: string;
    readonly action?: string;
    readonly editable?: boolean;
  } = {}
): string {
  const layout = state.settings.defaultLayout;
  if (options.editable === false) {
    return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    <section id="default-layout" class="panel printing-section">
      <div class="form-head"><h2>Default Print Layout</h2><p>v${String(state.version)}</p></div>
      ${renderPrintLayoutDefinition(layout, "No tenant default is configured. Formats use their own layout or renderer defaults.")}
    </section>`;
  }
  return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form id="default-layout" class="panel form" method="post" action="${escapeHtml(options.action ?? "/desk/admin/print-settings")}">
    <input type="hidden" name="expectedVersion" value="${String(state.version)}">
    <div class="form-head"><h2>Default Print Layout</h2><p>v${String(state.version)}</p></div>
    <div class="fields">
      <label class="field"><span>Page Size</span><select name="pageSize">${renderPrintPageSizeOptions(layout)}</select></label>
      <label class="field"><span>Orientation</span><select name="orientation">${renderPrintOrientationOptions(layout)}</select></label>
      <label class="field"><span>Custom Width (mm)</span><input name="customWidthMm" type="number" step="any" min="1" max="2000" value="${printCustomPageSizeValue(layout, "widthMm")}"></label>
      <label class="field"><span>Custom Height (mm)</span><input name="customHeightMm" type="number" step="any" min="1" max="2000" value="${printCustomPageSizeValue(layout, "heightMm")}"></label>
      <label class="field"><span>Top Margin (mm)</span><input name="topMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "topMm")}"></label>
      <label class="field"><span>Right Margin (mm)</span><input name="rightMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "rightMm")}"></label>
      <label class="field"><span>Bottom Margin (mm)</span><input name="bottomMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "bottomMm")}"></label>
      <label class="field"><span>Left Margin (mm)</span><input name="leftMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "leftMm")}"></label>
      <label class="field"><span>Font Family</span><input name="fontFamily" value="${escapeHtml(layout?.font?.family ?? "")}"></label>
      <label class="field"><span>Font Size (pt)</span><input name="fontSizePt" type="number" step="any" min="6" max="72" value="${printNumberValue(layout?.font?.sizePt)}"></label>
    </div>
    <div class="choices">
      <label class="choice"><input type="checkbox" name="clearDefaultLayout" value="1"><span>Clear Default Layout</span></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save Settings</button></div>
  </form>`;
}

export function renderPrintingWorkspace(
  overview: PrintingWorkspaceOverview,
  options: { readonly error?: string } = {}
): string {
  const formatGroups = groupPrintFormatSummaries(overview.formats)
    .map(([group, formats]) => `<section class="printing-group">
      <h3>${escapeHtml(group)}</h3>
      <ul class="resource-row-list">${formats.map((format) => `<li><a class="resource-row" href="/desk/printing/formats/${encodeURIComponent(format.name)}">
        <span><strong>${escapeHtml(format.label)}</strong><small>${escapeHtml(format.doctype)}${format.description === undefined ? "" : ` · ${escapeHtml(format.description)}`}</small></span>
        <span class="related-resource-kind">Print Format</span>
      </a></li>`).join("")}</ul>
    </section>`).join("");
  const formats = `<section class="panel printing-section">
    <div class="form-head"><h2>Print Formats</h2><p>${String(overview.formats.length)}</p></div>
    ${formatGroups || '<p class="empty">No Print Formats are visible for your roles.</p>'}
  </section>`;
  const letterheads = `<section class="panel printing-section">
    <div class="form-head"><h2>Letterheads</h2><p>${String(overview.letterheads.length)}</p></div>
    ${overview.letterheads.length === 0
      ? '<p class="empty">No Letterheads are visible for your roles.</p>'
      : `<ul class="resource-row-list">${overview.letterheads.map((letterhead) => `<li><a class="resource-row" href="/desk/printing/letterheads/${encodeURIComponent(letterhead.name)}"><span><strong>${escapeHtml(letterhead.label)}</strong><small>${escapeHtml(letterhead.name)}</small></span><span class="related-resource-kind">Letterhead</span></a></li>`).join("")}</ul>`}
  </section>`;
  return `<section class="toolbar"><div><strong>Printing</strong><p class="muted-copy">Inspect app-defined output and tenant layout defaults.</p></div></section>
    ${formats}
    ${letterheads}
    ${renderPrintSettingsAdmin(overview.settings, {
      ...(options.error === undefined ? {} : { error: options.error }),
      action: "/desk/printing/default-layout",
      editable: overview.canManageDefaultLayout
    })}`;
}

export function renderPrintFormatInspection(
  inspection: PrintFormatInspection,
  options: { readonly printPdfEnabled?: boolean } = {}
): string {
  const format = inspection.format;
  const sections = (format.sections ?? []).length === 0
    ? ""
    : `<section class="panel printing-section"><div class="form-head"><h2>Sections</h2><p>${String(format.sections?.length ?? 0)}</p></div>${format.sections?.map((section) => `<section class="print-format-section"><h3>${escapeHtml(section.heading ?? "Fields")}</h3><ul class="value-list">${section.fields.map((field) => `<li><strong>${escapeHtml(field.label ?? field.field)}</strong><span>${escapeHtml(field.field)}</span></li>`).join("")}</ul></section>`).join("")}</section>`;
  const template = format.template === undefined
    ? ""
    : `<section class="panel printing-section"><div class="form-head"><h2>Template Source</h2><p>Read only</p></div><pre class="source-preview"><code>${escapeHtml(format.template)}</code></pre></section>`;
  const previews = inspection.previewDocuments.length === 0
    ? '<p class="empty">No readable documents are available for preview.</p>'
    : `<ul class="resource-row-list">${inspection.previewDocuments.map((document) => {
        const base = `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(document.name)}`;
        return `<li><div class="resource-row"><span><strong>${escapeHtml(document.name)}</strong><small>${escapeHtml(format.doctype)}</small></span><span class="related-resource-actions"><a class="button" href="${base}">HTML</a>${options.printPdfEnabled ? `<a class="button" href="${base}/pdf">PDF</a>` : ""}</span></div></li>`;
      }).join("")}</ul>`;
  return `<section class="toolbar"><a class="button" href="/desk/printing">Back to Printing</a></section>
    <section class="panel printing-section">
      <div class="form-head"><h2>${escapeHtml(format.label ?? format.name)}</h2><p>${escapeHtml(format.doctype)}</p></div>
      ${format.description === undefined ? "" : `<p>${escapeHtml(format.description)}</p>`}
      <dl class="definition-list">
        <div><dt>Name</dt><dd>${escapeHtml(format.name)}</dd></div>
        <div><dt>Module</dt><dd>${escapeHtml(format.module ?? "-")}</dd></div>
        <div><dt>Permission</dt><dd>${escapeHtml(format.permissionAction ?? "read")}</dd></div>
        <div><dt>Roles</dt><dd>${escapeHtml((format.roles ?? []).join(", ") || "Any authorized role")}</dd></div>
        <div><dt>Letterhead</dt><dd>${format.letterhead === undefined ? "-" : `<a href="/desk/printing/letterheads/${encodeURIComponent(format.letterhead)}">${escapeHtml(format.letterhead)}</a>`}</dd></div>
      </dl>
    </section>
    ${sections}${template}
    <section class="panel printing-section"><div class="form-head"><h2>Layout</h2><p>Effective output</p></div>
      <div class="layout-comparison">
        <section><h3>Tenant Default</h3>${renderPrintLayoutDefinition(inspection.inheritedLayout, "Not configured")}</section>
        <section><h3>Format Override</h3>${renderPrintLayoutDefinition(format.layout, "No override")}</section>
        <section><h3>Effective Layout</h3>${renderPrintLayoutDefinition(inspection.effectiveLayout, "Renderer defaults")}</section>
      </div>
    </section>
    <section class="panel printing-section"><div class="form-head"><h2>Preview Documents</h2><p>${String(inspection.previewDocuments.length)}</p></div>${previews}</section>`;
}

export function renderPrintLetterheadInspection(letterhead: PrintLetterheadDefinition): string {
  return `<section class="toolbar"><a class="button" href="/desk/printing">Back to Printing</a></section>
    <section class="panel printing-section">
      <div class="form-head"><h2>${escapeHtml(letterhead.label ?? letterhead.name)}</h2><p>Read only</p></div>
      <dl class="definition-list">
        <div><dt>Name</dt><dd>${escapeHtml(letterhead.name)}</dd></div>
        <div><dt>Roles</dt><dd>${escapeHtml((letterhead.roles ?? []).join(", ") || "Any authorized role")}</dd></div>
      </dl>
    </section>
    <section class="panel printing-section"><div class="form-head"><h2>Header HTML</h2><p>Escaped source</p></div><pre class="source-preview"><code>${escapeHtml(letterhead.headerHtml ?? "")}</code></pre></section>
    <section class="panel printing-section"><div class="form-head"><h2>Footer HTML</h2><p>Escaped source</p></div><pre class="source-preview"><code>${escapeHtml(letterhead.footerHtml ?? "")}</code></pre></section>`;
}

function groupPrintFormatSummaries(
  formats: PrintingWorkspaceOverview["formats"]
): Array<readonly [string, PrintingWorkspaceOverview["formats"]]> {
  const groups = new Map<string, PrintingWorkspaceOverview["formats"][number][]>();
  for (const format of formats) {
    const group = `${format.module ?? "General"} · ${format.doctype}`;
    const entries = groups.get(group) ?? [];
    entries.push(format);
    groups.set(group, entries);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function renderPrintLayoutDefinition(layout: PrintLayoutDefinition | undefined, emptyMessage: string): string {
  if (layout === undefined) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }
  const pageSize = typeof layout.pageSize === "string"
    ? layout.pageSize
    : layout.pageSize === undefined
      ? "Renderer default"
      : `${String(layout.pageSize.widthMm)} × ${String(layout.pageSize.heightMm)} mm`;
  const margins = layout.margins === undefined
    ? "Renderer default"
    : `T ${printLayoutValue(layout.margins.topMm)} · R ${printLayoutValue(layout.margins.rightMm)} · B ${printLayoutValue(layout.margins.bottomMm)} · L ${printLayoutValue(layout.margins.leftMm)} mm`;
  const font = layout.font === undefined
    ? "Renderer default"
    : `${layout.font.family ?? "Renderer default"}${layout.font.sizePt === undefined ? "" : ` · ${String(layout.font.sizePt)} pt`}`;
  return `<dl class="definition-list compact-definition-list">
    <div><dt>Page</dt><dd>${escapeHtml(pageSize)}</dd></div>
    <div><dt>Orientation</dt><dd>${escapeHtml(layout.orientation ?? "Renderer default")}</dd></div>
    <div><dt>Margins</dt><dd>${escapeHtml(margins)}</dd></div>
    <div><dt>Font</dt><dd>${escapeHtml(font)}</dd></div>
  </dl>`;
}

function printLayoutValue(value: number | undefined): string {
  return value === undefined ? "-" : String(value);
}

function renderPrintPageSizeOptions(layout: PrintLayoutDefinition | undefined): string {
  const selected = typeof layout?.pageSize === "string" ? layout.pageSize : "";
  return [
    `<option value=""${selected === "" ? " selected" : ""}></option>`,
    ...PRINT_PAGE_SIZE_NAMES.map(
      (pageSize) =>
        `<option value="${escapeHtml(pageSize)}"${pageSize === selected ? " selected" : ""}>${escapeHtml(pageSize)}</option>`
    )
  ].join("");
}

function renderPrintOrientationOptions(layout: PrintLayoutDefinition | undefined): string {
  const selected = layout?.orientation ?? "";
  return [
    `<option value=""${selected === "" ? " selected" : ""}></option>`,
    ...PRINT_PAGE_ORIENTATIONS.map(
      (orientation) =>
        `<option value="${escapeHtml(orientation)}"${orientation === selected ? " selected" : ""}>${escapeHtml(printOrientationLabel(orientation))}</option>`
    )
  ].join("");
}

function printOrientationLabel(orientation: (typeof PRINT_PAGE_ORIENTATIONS)[number]): string {
  return orientation === "landscape" ? "Landscape" : "Portrait";
}

function printMarginValue(
  layout: PrintLayoutDefinition | undefined,
  side: keyof NonNullable<PrintLayoutDefinition["margins"]>
): string {
  return printNumberValue(layout?.margins?.[side]);
}

function printCustomPageSizeValue(
  layout: PrintLayoutDefinition | undefined,
  dimension: "widthMm" | "heightMm"
): string {
  return layout?.pageSize === undefined || typeof layout.pageSize === "string"
    ? ""
    : printNumberValue(layout.pageSize[dimension]);
}

function printNumberValue(value: number | undefined): string {
  return value === undefined ? "" : escapeHtml(String(value));
}
