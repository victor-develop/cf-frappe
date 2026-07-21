import type { DeskOption } from "./meta-options.js";

interface ControlOptions {
  readonly id?: string | undefined;
  readonly label: string;
  readonly name: string;
  readonly value?: string | undefined;
  readonly options: readonly DeskOption[];
  readonly datalistId?: string | undefined;
  readonly className?: string | undefined;
  readonly includeBlank?: boolean | undefined;
  readonly form?: string | undefined;
  readonly type?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly required?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
}

interface DocumentReferencePickerOptions {
  readonly doctypeName: string;
  readonly documentName: string;
  readonly doctypeLabel: string;
  readonly documentLabel: string;
  readonly selectedDoctype?: string | undefined;
  readonly selectedDocumentName?: string | undefined;
  readonly doctypes: readonly DeskOption[];
  readonly documents: readonly DeskOption[];
  readonly doctypeDatalistId: string;
  readonly documentDatalistId: string;
  readonly className?: string | undefined;
  readonly form?: string | undefined;
}

export function renderSelectControl(options: ControlOptions): string {
  const value = options.value ?? "";
  return `<label class="${escapeHtml(options.className ?? "field")}"${options.id ? ` for="${escapeHtml(options.id)}"` : ""}><span>${escapeHtml(options.label)}</span><select ${controlAttributes(options)}>${renderSelectOptions(options.options, value, Boolean(options.includeBlank))}</select></label>`;
}

export function renderDatalistControl(options: ControlOptions): string {
  const value = options.value ?? "";
  const datalistId = options.datalistId ?? `${options.name}-options`;
  const placeholder = options.placeholder === undefined ? "" : ` placeholder="${escapeHtml(options.placeholder)}"`;
  return `<label class="${escapeHtml(options.className ?? "field")}"${options.id ? ` for="${escapeHtml(options.id)}"` : ""}><span>${escapeHtml(options.label)}</span><input ${controlAttributes({ ...options, datalistId })} value="${escapeHtml(value)}"${placeholder}>${renderDatalist(datalistId, options.options)}</label>`;
}

export function renderDocTypeSelectControl(options: ControlOptions): string {
  return renderSelectControl(options);
}

export function renderDocTypeDatalistControl(options: ControlOptions): string {
  return renderDatalistControl(options);
}

export function renderFieldSelectControl(options: ControlOptions): string {
  return renderSelectControl(options);
}

export function renderUserSelectorControl(options: ControlOptions): string {
  return renderDatalistControl({
    ...options,
    type: options.type ?? "email"
  });
}

export function renderRoleMultiSelectorControl(options: ControlOptions): string {
  return renderDatalistControl({
    ...options,
    type: options.type ?? "text"
  });
}

export function renderFetchFromControl(options: ControlOptions): string {
  return renderDatalistControl({
    ...options,
    placeholder: options.placeholder ?? "link_field.source_field"
  });
}

export function renderDocumentReferencePickerControls(options: DocumentReferencePickerOptions): string {
  return [
    renderDatalistControl({
      label: options.doctypeLabel,
      name: options.doctypeName,
      value: options.selectedDoctype ?? "",
      options: options.doctypes,
      datalistId: options.doctypeDatalistId,
      className: options.className,
      ...(options.form === undefined ? {} : { form: options.form })
    }),
    renderDatalistControl({
      label: options.documentLabel,
      name: options.documentName,
      value: options.selectedDocumentName ?? "",
      options: options.documents,
      datalistId: options.documentDatalistId,
      className: options.className,
      ...(options.form === undefined ? {} : { form: options.form })
    })
  ].join("");
}

export function renderDatalist(id: string, options: readonly DeskOption[]): string {
  return `<datalist id="${escapeHtml(id)}">${options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("")}</datalist>`;
}

export function renderSelectOptions(options: readonly DeskOption[], selected: string, includeBlank = false): string {
  const rendered = includeBlank ? [`<option value=""${selected === "" ? " selected" : ""}></option>`] : [];
  rendered.push(
    ...options.map((option) =>
      `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
  );
  return rendered.join("");
}

function controlAttributes(options: ControlOptions): string {
  return [
    options.id === undefined ? "" : `id="${escapeHtml(options.id)}"`,
    `name="${escapeHtml(options.name)}"`,
    options.type === undefined ? "" : `type="${escapeHtml(options.type)}"`,
    options.form === undefined ? "" : `form="${escapeHtml(options.form)}"`,
    options.datalistId === undefined ? "" : `list="${escapeHtml(options.datalistId)}"`,
    options.required ? "required" : "",
    options.ariaLabel === undefined ? "" : `aria-label="${escapeHtml(options.ariaLabel)}"`
  ].filter(Boolean).join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
