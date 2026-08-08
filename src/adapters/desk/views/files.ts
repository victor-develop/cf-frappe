import { type DocTypeDefinition, type DocumentSnapshot } from "../../../core/types.js";
import { type FileDashboard } from "../../../application/file-service.js";
import { doctypeOptions, documentOptions } from "../meta-options.js";
import { renderDocumentReferencePickerControls } from "../meta-controls.js";
import { escapeHtml, renderTableCell } from "./shared.js";

interface FileManagerRenderOptions {
  readonly error?: string;
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly documentSuggestions?: readonly DocumentSnapshot[];
}

export function renderFileManager(
  dashboard: FileDashboard,
  options: FileManagerRenderOptions = {}
): string {
  const bulkFileActionFormId = "bulk-file-action";
  const hasBulkDelete = dashboard.files.some((file) => file.deletable);
  const hasBulkMetadata = dashboard.files.some((file) => file.editable);
  const hasBulkActions = hasBulkDelete || hasBulkMetadata;
  const uploadError = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : "";
  const uploadMode = dashboard.directUpload ? ' data-upload-mode="direct"' : "";
  const uploadReferenceControls = renderDocumentReferencePickerControls({
    doctypeName: "attached_to_doctype",
    documentName: "attached_to_name",
    doctypeLabel: "Attached To DocType",
    documentLabel: "Attached To Name",
    selectedDoctype: dashboard.filters.attachedToDoctype ?? "",
    selectedDocumentName: dashboard.filters.attachedToName ?? "",
    doctypes: doctypeOptions(options.doctypes ?? [], dashboard.filters.attachedToDoctype ?? ""),
    documents: documentOptions(options.documentSuggestions ?? [], dashboard.filters.attachedToName ?? ""),
    doctypeDatalistId: "file-upload-attached-doctype-options",
    documentDatalistId: "file-upload-attached-name-options"
  });
  const filterReferenceControls = renderDocumentReferencePickerControls({
    doctypeName: "attached_to_doctype",
    documentName: "attached_to_name",
    doctypeLabel: "Attached To DocType",
    documentLabel: "Attached To Name",
    selectedDoctype: dashboard.filters.attachedToDoctype ?? "",
    selectedDocumentName: dashboard.filters.attachedToName ?? "",
    doctypes: doctypeOptions(options.doctypes ?? [], dashboard.filters.attachedToDoctype ?? ""),
    documents: documentOptions(options.documentSuggestions ?? [], dashboard.filters.attachedToName ?? ""),
    doctypeDatalistId: "file-filter-attached-doctype-options",
    documentDatalistId: "file-filter-attached-name-options"
  });
  const uploadForm = dashboard.canUpload
    ? `<form class="panel form file-upload" method="post" action="/desk/files" enctype="multipart/form-data" data-max-file-bytes="${String(dashboard.maxUploadBytes)}"${uploadMode}>
        <div class="form-head">
          <h2>Upload File</h2>
        </div>
        ${uploadError}
        <div class="fields">
          <label class="field"><span>File</span><input name="file" type="file" required></label>
          ${uploadReferenceControls}
          <label class="field checkbox-field"><span>Private</span><input name="is_private" type="checkbox" value="1" checked></label>
        </div>
        <div class="actions"><button class="button primary" type="submit">Upload</button></div>
      </form>`
    : uploadError;
  const rows = dashboard.files
    .map((file) => {
      const attachedTo = attachmentLabel(file);
      return `<tr>
        ${renderTableCell("Select", file.deletable || file.editable ? renderFileBulkSelection(file, bulkFileActionFormId) : "")}
        ${renderTableCell("Filename", renderFileContentLinks(file))}
        ${renderTableCell("ID", escapeHtml(file.name))}
        ${renderTableCell("Content Type", escapeHtml(file.contentType))}
        ${renderTableCell("Size", escapeHtml(formatBytes(file.size)))}
        ${renderTableCell("Private", file.isPrivate ? "yes" : "no")}
        ${renderTableCell("Attached To", escapeHtml(attachedTo))}
        ${renderTableCell("Uploaded By", escapeHtml(file.uploadedBy))}
        ${renderTableCell("Uploaded At", `<time datetime="${escapeHtml(file.uploadedAt)}">${escapeHtml(file.uploadedAt)}</time>`)}
        ${renderTableCell("Action", `${file.editable ? renderFileMetadataAction(file, options) : ""}${file.deletable ? renderFileDeleteAction(file) : ""}`)}
      </tr>`;
    })
    .join("");
  return `${uploadForm}
  <form class="panel form list-filters" method="get" action="/desk/files">
    <div class="fields">
      ${filterReferenceControls}
      <label class="field"><span>Filename</span><input name="filename" value="${escapeHtml(dashboard.filters.filename ?? "")}"></label>
      <label class="field"><span>Content Type</span><input name="content_type" value="${escapeHtml(dashboard.filters.contentType ?? "")}"></label>
      <label class="field"><span>Uploaded By</span><input name="uploaded_by" value="${escapeHtml(dashboard.filters.uploadedBy ?? "")}"></label>
      <label class="field"><span>Storage State</span><select name="storage_state">${renderFileFilterOptions(FILE_STORAGE_STATE_FILTER_OPTIONS, dashboard.filters.storageState, "Any state")}</select></label>
      <label class="field"><span>Scan Status</span><select name="scan_status">${renderFileFilterOptions(FILE_SCAN_STATUS_FILTER_OPTIONS, dashboard.filters.scanStatus, "Any status")}</select></label>
      <label class="field"><span>Private</span><select name="is_private">${renderFilePrivacyFilterOptions(dashboard.filters.isPrivate)}</select></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value="${String(dashboard.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button><a class="button" href="/desk/files">Clear</a></div>
  </form>
  <section class="toolbar">
    ${hasBulkActions ? `<form id="${bulkFileActionFormId}" method="post" action="/desk/files/bulk-delete"></form>` : ""}
    ${hasBulkMetadata ? renderBulkFileMetadataControls(bulkFileActionFormId, options) : ""}
    ${hasBulkDelete ? `<button class="button danger" type="submit" form="${bulkFileActionFormId}" formaction="/desk/files/bulk-delete">Delete selected</button>` : ""}
    ${hasBulkMetadata ? `<button class="button" type="submit" form="${bulkFileActionFormId}" formaction="/desk/files/bulk-metadata">Update selected metadata</button>` : ""}
  </section>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Select</th><th>Filename</th><th>ID</th><th>Content Type</th><th>Size</th><th>Private</th><th>Attached To</th><th>Uploaded By</th><th>Uploaded At</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10" class="empty">No files found.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderFileAttachmentPanel(
  doctype: string,
  documentName: string,
  dashboard: FileDashboard,
  options: { readonly error?: string } = {}
): string {
  const documentHref = `/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}`;
  const uploadError = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : "";
  const uploadMode = dashboard.directUpload ? ' data-upload-mode="direct"' : "";
  const uploadForm = dashboard.canUpload
    ? `<form class="form attachment-upload" method="post" action="${escapeHtml(documentHref)}/files" enctype="multipart/form-data" data-max-file-bytes="${String(dashboard.maxUploadBytes)}"${uploadMode} data-attached-to-doctype="${escapeHtml(doctype)}" data-attached-to-name="${escapeHtml(documentName)}">
        ${uploadError}
        <div class="fields">
          <label class="field"><span>File</span><input name="file" type="file" required></label>
          <label class="field checkbox-field"><span>Private</span><input name="is_private" type="checkbox" value="1" checked></label>
        </div>
        <div class="actions"><button class="button primary" type="submit">Upload</button></div>
      </form>`
    : uploadError;
  const rows = dashboard.files
    .map(
      (file) => `<tr>
        ${renderTableCell("Filename", renderFileContentLinks(file))}
        ${renderTableCell("Content Type", escapeHtml(file.contentType))}
        ${renderTableCell("Size", escapeHtml(formatBytes(file.size)))}
        ${renderTableCell("Private", file.isPrivate ? "yes" : "no")}
        ${renderTableCell("Uploaded By", escapeHtml(file.uploadedBy))}
        ${renderTableCell("Uploaded At", escapeHtml(file.uploadedAt))}
        ${renderTableCell("Action", file.deletable ? renderAttachedFileDeleteAction(doctype, documentName, file) : "")}
      </tr>`
    )
    .join("");
  const managerHref = `/desk/files?attached_to_doctype=${encodeURIComponent(doctype)}&attached_to_name=${encodeURIComponent(documentName)}`;
  return `<section class="panel attachments" aria-labelledby="document-attachments">
    <div class="attachment-head">
      <h2 id="document-attachments">Attachments</h2>
      <a class="button" href="${escapeHtml(managerHref)}">Open file manager</a>
    </div>
    ${uploadForm}
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Filename</th><th>Content Type</th><th>Size</th><th>Private</th><th>Uploaded By</th><th>Uploaded At</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No files attached.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderFileContentLinks(file: FileDashboard["files"][number]): string {
  const downloadHref = `/desk/files/${encodeURIComponent(file.name)}/content`;
  const previewHref = `/desk/files/${encodeURIComponent(file.name)}/preview`;
  const preview = file.previewable ? ` <a href="${previewHref}">Preview</a>` : "";
  return `<a href="${downloadHref}">${escapeHtml(file.filename)}</a>${preview}`;
}

function renderFileMetadataAction(
  file: FileDashboard["files"][number],
  options: FileManagerRenderOptions
): string {
  const attachedToDoctype = file.attachedTo?.doctype ?? "";
  const attachedToName = file.attachedTo?.name ?? "";
  const referenceControls = renderDocumentReferencePickerControls({
    doctypeName: "attached_to_doctype",
    documentName: "attached_to_name",
    doctypeLabel: "Attached To DocType",
    documentLabel: "Attached To Name",
    selectedDoctype: attachedToDoctype,
    selectedDocumentName: attachedToName,
    doctypes: doctypeOptions(options.doctypes ?? [], attachedToDoctype),
    documents: documentOptions(options.documentSuggestions ?? [], attachedToName),
    doctypeDatalistId: `file-metadata-${file.name}-doctype-options`,
    documentDatalistId: `file-metadata-${file.name}-document-options`,
    className: "field compact-field"
  });
  return `<form class="inline-action file-metadata-action" method="post" action="/desk/files/${encodeURIComponent(file.name)}/metadata">
    <input type="hidden" name="expectedVersion" value="${String(file.expectedVersion)}">
    <input aria-label="Filename" name="filename" value="${escapeHtml(file.filename)}">
    ${referenceControls}
    <label class="inline-checkbox"><span>Private</span><input name="is_private" type="checkbox" value="1"${file.isPrivate ? " checked" : ""}></label>
    <button class="button" type="submit">Save</button>
  </form>`;
}

function renderFileBulkSelection(file: FileDashboard["files"][number], formId: string): string {
  return `<input class="bulk-select" form="${formId}" aria-label="Select ${escapeHtml(file.filename)}" name="file" value="${escapeHtml(file.name)}" type="checkbox">
    <input form="${formId}" name="expectedVersion:${escapeHtml(file.name)}" value="${String(file.expectedVersion)}" type="hidden">`;
}

function renderBulkFileMetadataControls(formId: string, options: FileManagerRenderOptions): string {
  const referenceControls = renderDocumentReferencePickerControls({
    doctypeName: "bulk_attached_to_doctype",
    documentName: "bulk_attached_to_name",
    doctypeLabel: "Attach To DocType",
    documentLabel: "Attach To Name",
    doctypes: doctypeOptions(options.doctypes ?? []),
    documents: documentOptions(options.documentSuggestions ?? []),
    doctypeDatalistId: "bulk-file-attached-doctype-options",
    documentDatalistId: "bulk-file-attached-name-options",
    className: "field compact-field",
    form: formId
  });
  return `<label class="field compact-field"><span>Privacy</span><select form="${formId}" name="bulk_is_private">
      <option value="">Keep privacy</option>
      <option value="1">Private</option>
      <option value="0">Public</option>
    </select></label>
    ${referenceControls}
    <label class="inline-checkbox"><span>Clear attachment</span><input form="${formId}" name="bulk_clear_attachment" type="checkbox" value="1"></label>`;
}

function renderFileDeleteAction(file: FileDashboard["files"][number]): string {
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(file.expectedVersion)}">
    <button class="button danger" type="submit" formaction="/desk/files/${encodeURIComponent(file.name)}/delete">Delete</button>
  </form>`;
}

function renderAttachedFileDeleteAction(
  doctype: string,
  documentName: string,
  file: FileDashboard["files"][number]
): string {
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(file.expectedVersion)}">
    <button class="button danger" type="submit" formaction="/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}/files/${encodeURIComponent(file.name)}/delete">Delete</button>
  </form>`;
}

function attachmentLabel(file: FileDashboard["files"][number]): string {
  if (!file.attachedTo) {
    return "";
  }
  return `${file.attachedTo.doctype}/${file.attachedTo.name}`;
}

const FILE_STORAGE_STATE_FILTER_OPTIONS = [
  { value: "upload_pending", label: "Upload Pending" },
  { value: "available", label: "Available" },
  { value: "scan_failed", label: "Scan Failed" },
  { value: "delete_requested", label: "Delete Requested" }
] as const;

const FILE_SCAN_STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "clean", label: "Clean" },
  { value: "infected", label: "Infected" }
] as const;

function renderFileFilterOptions(
  options: readonly { readonly value: string; readonly label: string }[],
  selectedValue: string | undefined,
  emptyLabel: string
): string {
  const selected = selectedValue ?? "";
  const rendered = [`<option value=""${selected === "" ? " selected" : ""}>${escapeHtml(emptyLabel)}</option>`];
  if (selected && !options.some((option) => option.value === selected)) {
    rendered.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  rendered.push(
    ...options.map((option) => {
      const selectedAttribute = option.value === selected ? " selected" : "";
      return `<option value="${escapeHtml(option.value)}"${selectedAttribute}>${escapeHtml(option.label)}</option>`;
    })
  );
  return rendered.join("");
}

function renderFilePrivacyFilterOptions(value: boolean | undefined): string {
  const selected = value === undefined ? "" : value ? "1" : "0";
  return [
    `<option value=""${selected === "" ? " selected" : ""}>Any privacy</option>`,
    `<option value="1"${selected === "1" ? " selected" : ""}>Private</option>`,
    `<option value="0"${selected === "0" ? " selected" : ""}>Public</option>`
  ].join("");
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${String(value)} B`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(1)} MiB`;
}
