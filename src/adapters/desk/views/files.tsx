import type { FC } from "hono/jsx";
import { type DocTypeDefinition, type DocumentSnapshot } from "../../../core/types.js";
import { type FileDashboard } from "../../../application/file-service.js";
import { doctypeOptions, documentOptions } from "../meta-options.js";
import { renderDocumentReferencePickerControls } from "../meta-controls.js";
import {
  ActionBar,
  Field,
  FormRow,
  Notice,
  SelectOptions,
  Toolbar,
  UnsafeRawHtml,
  renderFragment,
  type SelectOptionSpec
} from "../ui/primitives.js";

interface FileManagerRenderOptions {
  readonly error?: string;
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly documentSuggestions?: readonly DocumentSnapshot[];
}

type FileEntry = FileDashboard["files"][number];

const REFERENCE_PICKER_REASON =
  "output of renderDocumentReferencePickerControls (meta-controls.ts), escaped internally via escapeHtml";

export function renderFileManager(
  dashboard: FileDashboard,
  options: FileManagerRenderOptions = {}
): string {
  return renderFragment(<FileManager dashboard={dashboard} options={options} />);
}

const FileManager: FC<{ dashboard: FileDashboard; options: FileManagerRenderOptions }> = ({
  dashboard,
  options
}) => {
  const bulkFileActionFormId = "bulk-file-action";
  const hasBulkDelete = dashboard.files.some((file) => file.deletable);
  const hasBulkMetadata = dashboard.files.some((file) => file.editable);
  const hasBulkActions = hasBulkDelete || hasBulkMetadata;
  const uploadError = options.error ? <Notice tone="error">{options.error}</Notice> : null;
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
  return (
    <>
      {dashboard.canUpload ? (
        <form
          class="panel form file-upload"
          method="post"
          action="/desk/files"
          enctype="multipart/form-data"
          data-max-file-bytes={String(dashboard.maxUploadBytes)}
          data-upload-mode={dashboard.directUpload ? "direct" : undefined}
        >
          <div class="form-head">
            <h2>Upload File</h2>
          </div>
          {uploadError}
          <FormRow>
            <Field label="File">
              <input name="file" type="file" required />
            </Field>
            <UnsafeRawHtml reason={REFERENCE_PICKER_REASON} html={uploadReferenceControls} />
            <Field label="Private" variant="checkbox-field">
              <input name="is_private" type="checkbox" value="1" checked />
            </Field>
          </FormRow>
          <ActionBar>
            <button class="button primary" type="submit">Upload</button>
          </ActionBar>
        </form>
      ) : (
        uploadError
      )}
      <form class="panel form list-filters" method="get" action="/desk/files">
        <FormRow>
          <UnsafeRawHtml reason={REFERENCE_PICKER_REASON} html={filterReferenceControls} />
          <Field label="Filename">
            <input name="filename" value={dashboard.filters.filename ?? ""} />
          </Field>
          <Field label="Content Type">
            <input name="content_type" value={dashboard.filters.contentType ?? ""} />
          </Field>
          <Field label="Uploaded By">
            <input name="uploaded_by" value={dashboard.filters.uploadedBy ?? ""} />
          </Field>
          <Field label="Storage State">
            <select name="storage_state">
              <SelectOptions options={fileFilterOptions(FILE_STORAGE_STATE_FILTER_OPTIONS, dashboard.filters.storageState, "Any state")} />
            </select>
          </Field>
          <Field label="Scan Status">
            <select name="scan_status">
              <SelectOptions options={fileFilterOptions(FILE_SCAN_STATUS_FILTER_OPTIONS, dashboard.filters.scanStatus, "Any status")} />
            </select>
          </Field>
          <Field label="Private">
            <select name="is_private">
              <SelectOptions options={filePrivacyFilterOptions(dashboard.filters.isPrivate)} />
            </select>
          </Field>
          <Field label="Limit">
            <input name="limit" type="number" min="1" max="200" value={String(dashboard.limit)} />
          </Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Filter</button>
          <a class="button" href="/desk/files">Clear</a>
        </ActionBar>
      </form>
      <Toolbar>
        {hasBulkActions ? <form id={bulkFileActionFormId} method="post" action="/desk/files/bulk-delete"></form> : null}
        {hasBulkMetadata ? <BulkFileMetadataControls formId={bulkFileActionFormId} options={options} /> : null}
        {hasBulkDelete ? (
          <button class="button danger" type="submit" form={bulkFileActionFormId} formaction="/desk/files/bulk-delete">
            Delete selected
          </button>
        ) : null}
        {hasBulkMetadata ? (
          <button class="button" type="submit" form={bulkFileActionFormId} formaction="/desk/files/bulk-metadata">
            Update selected metadata
          </button>
        ) : null}
      </Toolbar>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Filename</th>
                <th>ID</th>
                <th>Content Type</th>
                <th>Size</th>
                <th>Private</th>
                <th>Attached To</th>
                <th>Uploaded By</th>
                <th>Uploaded At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.files.length === 0 ? (
                <tr>
                  <td colspan={10} class="empty">No files found.</td>
                </tr>
              ) : (
                dashboard.files.map((file) => (
                  <tr>
                    <td data-label="Select">
                      {file.deletable || file.editable ? (
                        <FileBulkSelection file={file} formId={bulkFileActionFormId} />
                      ) : null}
                    </td>
                    <td data-label="Filename">
                      <FileContentLinks file={file} />
                    </td>
                    <td data-label="ID">{file.name}</td>
                    <td data-label="Content Type">{file.contentType}</td>
                    <td data-label="Size">{formatBytes(file.size)}</td>
                    <td data-label="Private">{file.isPrivate ? "yes" : "no"}</td>
                    <td data-label="Attached To">{attachmentLabel(file)}</td>
                    <td data-label="Uploaded By">{file.uploadedBy}</td>
                    <td data-label="Uploaded At">
                      <time datetime={file.uploadedAt}>{file.uploadedAt}</time>
                    </td>
                    <td data-label="Action">
                      {file.editable ? <FileMetadataAction file={file} options={options} /> : null}
                      {file.deletable ? <FileDeleteAction file={file} /> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

export function renderFileAttachmentPanel(
  doctype: string,
  documentName: string,
  dashboard: FileDashboard,
  options: { readonly error?: string } = {}
): string {
  return renderFragment(
    <FileAttachmentPanel doctype={doctype} documentName={documentName} dashboard={dashboard} options={options} />
  );
}

const FileAttachmentPanel: FC<{
  doctype: string;
  documentName: string;
  dashboard: FileDashboard;
  options: { readonly error?: string | undefined };
}> = ({ doctype, documentName, dashboard, options }) => {
  const documentHref = `/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}`;
  const uploadError = options.error ? <Notice tone="error">{options.error}</Notice> : null;
  const managerHref = `/desk/files?attached_to_doctype=${encodeURIComponent(doctype)}&attached_to_name=${encodeURIComponent(documentName)}`;
  return (
    <section class="panel attachments" aria-labelledby="document-attachments">
      <div class="attachment-head">
        <h2 id="document-attachments">Attachments</h2>
        <a class="button" href={managerHref}>Open file manager</a>
      </div>
      {dashboard.canUpload ? (
        <form
          class="form attachment-upload"
          method="post"
          action={`${documentHref}/files`}
          enctype="multipart/form-data"
          data-max-file-bytes={String(dashboard.maxUploadBytes)}
          data-upload-mode={dashboard.directUpload ? "direct" : undefined}
          data-attached-to-doctype={doctype}
          data-attached-to-name={documentName}
        >
          {uploadError}
          <FormRow>
            <Field label="File">
              <input name="file" type="file" required />
            </Field>
            <Field label="Private" variant="checkbox-field">
              <input name="is_private" type="checkbox" value="1" checked />
            </Field>
          </FormRow>
          <ActionBar>
            <button class="button primary" type="submit">Upload</button>
          </ActionBar>
        </form>
      ) : (
        uploadError
      )}
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Content Type</th>
              <th>Size</th>
              <th>Private</th>
              <th>Uploaded By</th>
              <th>Uploaded At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.files.length === 0 ? (
              <tr>
                <td colspan={7} class="empty">No files attached.</td>
              </tr>
            ) : (
              dashboard.files.map((file) => (
                <tr>
                  <td data-label="Filename">
                    <FileContentLinks file={file} />
                  </td>
                  <td data-label="Content Type">{file.contentType}</td>
                  <td data-label="Size">{formatBytes(file.size)}</td>
                  <td data-label="Private">{file.isPrivate ? "yes" : "no"}</td>
                  <td data-label="Uploaded By">{file.uploadedBy}</td>
                  <td data-label="Uploaded At">{file.uploadedAt}</td>
                  <td data-label="Action">
                    {file.deletable ? (
                      <AttachedFileDeleteAction doctype={doctype} documentName={documentName} file={file} />
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const FileContentLinks: FC<{ file: FileEntry }> = ({ file }) => {
  const downloadHref = `/desk/files/${encodeURIComponent(file.name)}/content`;
  const previewHref = `/desk/files/${encodeURIComponent(file.name)}/preview`;
  return (
    <>
      <a href={downloadHref}>{file.filename}</a>
      {file.previewable ? <> <a href={previewHref}>Preview</a></> : null}
    </>
  );
};

const FileMetadataAction: FC<{ file: FileEntry; options: FileManagerRenderOptions }> = ({ file, options }) => {
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
  return (
    <form
      class="inline-action file-metadata-action"
      method="post"
      action={`/desk/files/${encodeURIComponent(file.name)}/metadata`}
    >
      <input type="hidden" name="expectedVersion" value={String(file.expectedVersion)} />
      <input aria-label="Filename" name="filename" value={file.filename} />
      <UnsafeRawHtml reason={REFERENCE_PICKER_REASON} html={referenceControls} />
      <label class="inline-checkbox">
        <span>Private</span>
        <input name="is_private" type="checkbox" value="1" checked={file.isPrivate} />
      </label>
      <button class="button" type="submit">Save</button>
    </form>
  );
};

const FileBulkSelection: FC<{ file: FileEntry; formId: string }> = ({ file, formId }) => (
  <>
    <input
      class="bulk-select"
      form={formId}
      aria-label={`Select ${file.filename}`}
      name="file"
      value={file.name}
      type="checkbox"
    />
    <input form={formId} name={`expectedVersion:${file.name}`} value={String(file.expectedVersion)} type="hidden" />
  </>
);

const BulkFileMetadataControls: FC<{ formId: string; options: FileManagerRenderOptions }> = ({ formId, options }) => {
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
  return (
    <>
      <Field label="Privacy" variant="compact-field">
        <select form={formId} name="bulk_is_private">
          <option value="">Keep privacy</option>
          <option value="1">Private</option>
          <option value="0">Public</option>
        </select>
      </Field>
      <UnsafeRawHtml reason={REFERENCE_PICKER_REASON} html={referenceControls} />
      <label class="inline-checkbox">
        <span>Clear attachment</span>
        <input form={formId} name="bulk_clear_attachment" type="checkbox" value="1" />
      </label>
    </>
  );
};

const FileDeleteAction: FC<{ file: FileEntry }> = ({ file }) => (
  <form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value={String(file.expectedVersion)} />
    <button class="button danger" type="submit" formaction={`/desk/files/${encodeURIComponent(file.name)}/delete`}>
      Delete
    </button>
  </form>
);

const AttachedFileDeleteAction: FC<{ doctype: string; documentName: string; file: FileEntry }> = ({
  doctype,
  documentName,
  file
}) => (
  <form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value={String(file.expectedVersion)} />
    <button
      class="button danger"
      type="submit"
      formaction={`/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}/files/${encodeURIComponent(file.name)}/delete`}
    >
      Delete
    </button>
  </form>
);

function attachmentLabel(file: FileEntry): string {
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

function fileFilterOptions(
  options: readonly { readonly value: string; readonly label: string }[],
  selectedValue: string | undefined,
  emptyLabel: string
): readonly SelectOptionSpec[] {
  const selected = selectedValue ?? "";
  const specs: SelectOptionSpec[] = [{ value: "", label: emptyLabel, selected: selected === "" }];
  if (selected && !options.some((option) => option.value === selected)) {
    specs.push({ value: selected, selected: true });
  }
  specs.push(
    ...options.map((option) => ({
      value: option.value,
      label: option.label,
      selected: option.value === selected
    }))
  );
  return specs;
}

function filePrivacyFilterOptions(value: boolean | undefined): readonly SelectOptionSpec[] {
  const selected = value === undefined ? "" : value ? "1" : "0";
  return [
    { value: "", label: "Any privacy", selected: selected === "" },
    { value: "1", label: "Private", selected: selected === "1" },
    { value: "0", label: "Public", selected: selected === "0" }
  ];
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
