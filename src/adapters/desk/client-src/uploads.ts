/**
 * File upload machinery + upload-form hydration ported from the legacy desk client string
 * (`renderDeskClientScript` lines ~701-1021 and ~1226-1357).
 *
 * Contributes `upload` / `uploadDirect` / `uploadMultipart` / `uploadMultipartPart` /
 * `prepareDirectUpload` / `prepareMultipartUpload` / `completeDirectUpload` /
 * `completeMultipartUpload` / `abortMultipartUpload` to `cfFrappe.files`, and hydrates
 * `form.file-upload[data-max-file-bytes]` / `form.attachment-upload[data-max-file-bytes]`
 * (size preflight, direct-upload interception, redirect to `data-success-url`).
 */

import {
  fileAttachmentParams,
  versionBody,
  withoutKeys,
  type AttachedToOptions,
  type ParamOptions,
  type UnknownRecord,
  type VersionOptions
} from "./bodies.js";
import { registerHydrator, registerNamespaceContribution } from "./boot.js";
import { MAX_MULTIPART_FILE_PARTS, MIN_MULTIPART_FILE_PART_BYTES } from "./constants.js";
import {
  encodePart,
  filePath,
  readResponsePayload,
  request,
  throwResponseError,
  unwrapData,
  withQuery
} from "./http.js";
import { msgprint } from "./namespace.js";
import type { FilesUploadExtension } from "./seams.js";
import { setParam, type MutableQueryParams, type QueryParams, type QueryPrimitive } from "./url.js";

/* ------------------------------ option helpers ----------------------------- */

function optionValue(options: ParamOptions | undefined, camel: string, snake: string): unknown {
  if (!options) {
    return undefined;
  }
  return options[camel] !== undefined ? options[camel] : options[snake];
}

export function fileUploadParams(options?: AttachedToOptions): QueryParams {
  const params: MutableQueryParams = {};
  fileAttachmentParams(params, options ?? {});
  setParam(params, "filename", options?.filename as QueryPrimitive | undefined);
  setParam(params, "is_private", optionValue(options, "isPrivate", "is_private") as QueryPrimitive | undefined);
  return params;
}

export function fileUploadHeaders(options?: ParamOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const contentType = optionValue(options, "contentType", "content_type");
  if (contentType !== undefined && contentType !== null) {
    headers["content-type"] = contentType as string;
  }
  return headers;
}

export function fileUploadLimit(options?: ParamOptions): number | undefined {
  const raw = optionValue(options, "maxUploadBytes", "max_upload_bytes");
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function preflightKnownUploadSize(size: unknown, options?: ParamOptions): void {
  const maxUploadBytes = fileUploadLimit(options ?? {});
  if (maxUploadBytes === undefined || typeof size !== "number" || !Number.isFinite(size)) {
    return;
  }
  if (size > maxUploadBytes) {
    throw new Error(`File exceeds ${String(maxUploadBytes)} bytes`);
  }
}

function uploadBodySize(body: unknown): number | undefined {
  const size = (body as { size?: unknown } | null | undefined)?.size;
  return typeof size === "number" && Number.isFinite(size) ? size : undefined;
}

function directUploadRequestBody(input?: UnknownRecord): UnknownRecord {
  return withoutKeys(input ?? {}, ["maxUploadBytes", "max_upload_bytes"]);
}

const uploadReservationRequestBody = directUploadRequestBody;

/* --------------------------- multipart plan helpers ------------------------ */

const defaultMultipartChunkBytes = MIN_MULTIPART_FILE_PART_BYTES;

function fileBodySize(body: unknown): number {
  const size = uploadBodySize(body);
  if (size === undefined) {
    throw new Error("Multipart file body must expose a numeric size");
  }
  return size;
}

function multipartFilename(body: unknown, options?: ParamOptions): unknown {
  const filename = options?.filename;
  if (filename !== undefined && filename !== null && String(filename) !== "") {
    return filename;
  }
  const name = (body as { name?: unknown } | null | undefined)?.name;
  if (typeof name === "string" && name !== "") {
    return name;
  }
  throw new Error("filename is required for multipart uploads");
}

function multipartContentType(body: unknown, options?: ParamOptions): unknown {
  const contentType = optionValue(options, "contentType", "content_type");
  if (contentType !== undefined && contentType !== null && String(contentType) !== "") {
    return contentType;
  }
  const type = (body as { type?: unknown } | null | undefined)?.type;
  return typeof type === "string" && type !== "" ? type : "application/octet-stream";
}

function multipartChunkSize(options?: ParamOptions): number {
  const chunkSize = options && options.chunkSize !== undefined ? Number(options.chunkSize) : defaultMultipartChunkBytes;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer");
  }
  return chunkSize;
}

function assertMultipartUploadPlan(size: number, chunkSize: number): number {
  const totalParts = Math.max(1, Math.ceil(size / chunkSize));
  if (totalParts > 1 && chunkSize < MIN_MULTIPART_FILE_PART_BYTES) {
    throw new Error(`chunkSize must be at least ${String(MIN_MULTIPART_FILE_PART_BYTES)} bytes for multi-part R2 uploads`);
  }
  if (totalParts > MAX_MULTIPART_FILE_PARTS) {
    throw new Error(`Multipart upload cannot exceed ${String(MAX_MULTIPART_FILE_PARTS)} parts`);
  }
  return totalParts;
}

function multipartReservationBody(body: unknown, options?: AttachedToOptions): UnknownRecord {
  const input: UnknownRecord = {
    filename: multipartFilename(body, options ?? {}),
    size: fileBodySize(body),
    contentType: multipartContentType(body, options ?? {})
  };
  fileAttachmentParams(input, options ?? {});
  if (options && (options.isPrivate !== undefined || options.is_private !== undefined)) {
    input.isPrivate = options.isPrivate !== undefined ? options.isPrivate : options.is_private;
  }
  if (options && options.expiresInSeconds !== undefined) {
    input.expiresInSeconds = options.expiresInSeconds;
  }
  return input;
}

function directReservationBody(body: unknown, options?: AttachedToOptions): UnknownRecord {
  const input = multipartReservationBody(body, options ?? {});
  const maxUploadBytes = optionValue(options, "maxUploadBytes", "max_upload_bytes");
  if (maxUploadBytes !== undefined) {
    input.maxUploadBytes = maxUploadBytes;
  }
  return input;
}

function multipartPartBody(body: unknown, start: number, end: number): unknown {
  const sliceable = body as { slice?(start: number, end: number): unknown } | null | undefined;
  if (sliceable && typeof sliceable.slice === "function") {
    return sliceable.slice(start, end);
  }
  throw new Error("Multipart file body must support slice(start, end)");
}

function snapshotVersion(payload: unknown, fallback: unknown): unknown {
  const version = (payload as { data?: { version?: unknown } } | null | undefined)?.data?.version;
  return version !== undefined ? version : fallback;
}

function multipartProgress(callback: unknown, event: UnknownRecord): void {
  if (typeof callback === "function") {
    (callback as (event: UnknownRecord) => void)(event);
  }
}

/* ------------------------------- upload API -------------------------------- */

export async function prepareMultipartUpload(input?: UnknownRecord): Promise<unknown> {
  preflightKnownUploadSize(input?.size, input ?? {});
  return request("/api/files/multipart-upload", { method: "POST", body: uploadReservationRequestBody(input ?? {}) });
}

export async function prepareDirectUpload(input?: UnknownRecord): Promise<unknown> {
  preflightKnownUploadSize(input?.size, input ?? {});
  return request("/api/files/direct-upload", { method: "POST", body: directUploadRequestBody(input ?? {}) });
}

export function completeDirectUpload(name: string, options?: VersionOptions): Promise<unknown> {
  return request(filePath(name, "complete-upload"), { method: "POST", body: versionBody(options) }).then(unwrapData);
}

interface DirectUploadReservation {
  data?: { name?: unknown; version?: unknown };
  upload?: { url?: unknown; method?: unknown; headers?: unknown };
}

export async function uploadDirectFile(body: unknown, options?: ParamOptions): Promise<unknown> {
  const prepared = (await prepareDirectUpload(
    directReservationBody(body, (options ?? {}) as AttachedToOptions)
  )) as DirectUploadReservation | null;
  const file = prepared?.data;
  const upload = prepared?.upload;
  if (!file || !file.name || !upload || !upload.url) {
    throw new Error("Direct upload reservation did not return upload instructions");
  }
  const uploadResponse = await fetch(upload.url as string, {
    method: (upload.method as string | undefined) || "PUT",
    headers: (upload.headers as HeadersInit | undefined) || {},
    body: body as BodyInit
  });
  if (!uploadResponse.ok) {
    throwResponseError(uploadResponse, await readResponsePayload(uploadResponse));
  }
  return {
    data: await completeDirectUpload(file.name as string, { expectedVersion: file.version } as VersionOptions),
    upload
  };
}

export function uploadMultipartPart(
  name: string,
  partNumber: number,
  body: unknown,
  options?: ParamOptions
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (options && options.size !== undefined) {
    headers["x-cf-frappe-part-size"] = String(options.size);
  }
  return request(filePath(name, `multipart-parts/${encodePart(partNumber)}`), {
    method: "PUT",
    body,
    headers
  });
}

export function completeMultipartUpload(
  name: string,
  parts: readonly unknown[],
  options?: VersionOptions
): Promise<unknown> {
  return request(filePath(name, "complete-multipart-upload"), {
    method: "POST",
    body: Object.assign({ parts }, versionBody(options))
  }).then(unwrapData);
}

export function abortMultipartUpload(name: string, options?: VersionOptions): Promise<unknown> {
  return request(filePath(name, "abort-multipart-upload"), { method: "POST", body: versionBody(options) }).then(
    unwrapData
  );
}

export async function uploadMultipartFile(body: unknown, options?: ParamOptions): Promise<unknown> {
  const uploadOptions = (options ?? {}) as AttachedToOptions;
  const input = multipartReservationBody(body, uploadOptions);
  const chunkSize = multipartChunkSize(uploadOptions);
  const size = input.size as number;
  preflightKnownUploadSize(size, uploadOptions);
  const totalParts = assertMultipartUploadPlan(size, chunkSize);
  const prepared = (await prepareMultipartUpload(input)) as
    | ({ data?: { name?: unknown }; upload?: unknown } & UnknownRecord)
    | null;
  const fileName = prepared?.data?.name;
  if (!fileName) {
    throw new Error("Multipart upload reservation did not return a file name");
  }
  let expectedVersion = snapshotVersion(prepared, undefined);
  const parts: unknown[] = [];
  let uploadedBytes = 0;
  let canAbort = true;
  try {
    for (let partNumber = 1, start = 0; partNumber <= totalParts; partNumber += 1, start += chunkSize) {
      const end = Math.min(start + chunkSize, size);
      const chunk = multipartPartBody(body, start, end);
      const uploaded = (await uploadMultipartPart(fileName as string, partNumber, chunk, {
        size: end - start
      })) as { part?: unknown } | null;
      parts.push(uploaded?.part);
      expectedVersion = snapshotVersion(uploaded, expectedVersion);
      uploadedBytes += end - start;
      multipartProgress(uploadOptions.onProgress, {
        file: prepared?.data,
        part: uploaded?.part,
        partNumber,
        totalParts,
        uploadedBytes,
        totalBytes: size
      });
    }
    canAbort = false;
    const completed = await completeMultipartUpload(fileName as string, parts, {
      expectedVersion
    } as VersionOptions);
    return {
      data: completed,
      upload: prepared?.upload,
      parts
    };
  } catch (error) {
    if (canAbort && (!options || options.abortOnError !== false)) {
      await abortMultipartUpload(fileName as string, { expectedVersion } as VersionOptions).catch(() => {});
    }
    throw error;
  }
}

export async function uploadFile(body: unknown, options?: ParamOptions): Promise<unknown> {
  preflightKnownUploadSize(uploadBodySize(body), options ?? {});
  return request(withQuery("/api/files", fileUploadParams((options ?? {}) as AttachedToOptions)), {
    method: "POST",
    body,
    headers: fileUploadHeaders(options ?? {})
  });
}

/* --------------------------- upload-form hydration ------------------------- */

interface UploadFormElement extends HTMLFormElement {
  __cfFrappeFileUploadHydrated?: boolean;
  __cfFrappeFileUploadInFlight?: boolean;
}

export function hydrateFileUploadForms(): void {
  const forms = document.querySelectorAll<UploadFormElement>(
    "form.file-upload[data-max-file-bytes], form.attachment-upload[data-max-file-bytes]"
  );
  forms.forEach((form) => {
    hydrateFileUploadForm(form);
  });
}

function hydrateFileUploadForm(form: UploadFormElement): void {
  if (form.__cfFrappeFileUploadHydrated) {
    return;
  }
  form.__cfFrappeFileUploadHydrated = true;
  form.addEventListener("submit", (event) => {
    void handleUploadFormSubmit(form, event);
  });
}

async function handleUploadFormSubmit(form: UploadFormElement, event: Event): Promise<void> {
  const maxFileBytes = uploadFormMaxFileBytes(form);
  const file = selectedUploadFile(form);
  if (!file) {
    clearUploadFileValidity(form);
    return;
  }
  if (
    maxFileBytes !== undefined &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size > maxFileBytes
  ) {
    const message = `File exceeds ${String(maxFileBytes)} bytes`;
    event.preventDefault();
    setUploadFileValidity(form, message, true);
    msgprint(message);
    return;
  }
  clearUploadFileValidity(form);
  if (form.dataset.uploadMode !== "direct") {
    return;
  }
  event.preventDefault();
  if (form.__cfFrappeFileUploadInFlight) {
    return;
  }
  form.__cfFrappeFileUploadInFlight = true;
  try {
    await uploadDirectFile(file, uploadFormDirectOptions(form, file, maxFileBytes));
    clearUploadFileValidity(form);
    window.location.href = uploadFormSuccessUrl(form);
  } catch (error) {
    const withMessage = error as { message?: unknown } | null | undefined;
    const errorMessage = withMessage && withMessage.message ? String(withMessage.message) : String(error);
    setUploadFileValidity(form, errorMessage, true);
    msgprint(errorMessage);
  } finally {
    form.__cfFrappeFileUploadInFlight = false;
  }
}

function uploadFormMaxFileBytes(form: HTMLFormElement): number | undefined {
  const raw = form.dataset.maxFileBytes;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uploadFileInput(form: HTMLFormElement): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>('input[type="file"][name="file"], input[type="file"]');
}

function selectedUploadFile(form: HTMLFormElement): File | undefined {
  const input = uploadFileInput(form);
  if (!input || !input.files || input.files.length === 0) {
    return undefined;
  }
  return input.files[0];
}

function uploadFormControl(form: HTMLFormElement, name: string): Element | null {
  return form.querySelector(`[name="${name}"]`);
}

function uploadFormValue(form: HTMLFormElement, name: string): unknown {
  const control = uploadFormControl(form, name) as { value?: unknown } | null;
  if (!control || control.value === undefined || control.value === null || String(control.value) === "") {
    return undefined;
  }
  return control.value;
}

function uploadFormChecked(form: HTMLFormElement, name: string): boolean | undefined {
  const control = uploadFormControl(form, name) as { checked?: unknown } | null;
  return control ? Boolean(control.checked) : undefined;
}

function uploadFormDirectOptions(
  form: HTMLFormElement,
  file: File,
  maxFileBytes: number | undefined
): AttachedToOptions {
  const options: AttachedToOptions = {
    filename: file.name ? file.name : uploadFormValue(form, "filename"),
    contentType: file.type ? file.type : undefined
  };
  const attachedToDoctype = form.dataset.attachedToDoctype
    ? form.dataset.attachedToDoctype
    : uploadFormValue(form, "attached_to_doctype");
  const attachedToName = form.dataset.attachedToName
    ? form.dataset.attachedToName
    : uploadFormValue(form, "attached_to_name");
  if (attachedToDoctype || attachedToName) {
    options.attachedTo = { doctype: attachedToDoctype, name: attachedToName };
  }
  const isPrivate = uploadFormChecked(form, "is_private");
  if (isPrivate !== undefined) {
    options.isPrivate = isPrivate;
  }
  if (maxFileBytes !== undefined) {
    options.maxUploadBytes = maxFileBytes;
  }
  return options;
}

function uploadFormSuccessUrl(form: HTMLFormElement): string {
  return form.dataset.successUrl ? form.dataset.successUrl : window.location.href;
}

function setUploadFileValidity(form: HTMLFormElement, message: string, report: boolean): void {
  const input = uploadFileInput(form);
  if (input && typeof input.setCustomValidity === "function") {
    input.setCustomValidity(message);
  }
  if (report && input && typeof input.reportValidity === "function") {
    input.reportValidity();
  }
}

function clearUploadFileValidity(form: HTMLFormElement): void {
  setUploadFileValidity(form, "", false);
}

/* -------------------------------- registration ----------------------------- */

const filesUploadExtension: FilesUploadExtension = {
  abortMultipartUpload,
  completeDirectUpload,
  completeMultipartUpload,
  prepareDirectUpload,
  prepareMultipartUpload,
  upload: uploadFile,
  uploadDirect: uploadDirectFile,
  uploadMultipart: uploadMultipartFile,
  uploadMultipartPart
};

/**
 * Registers the uploads namespace contribution (merged into `cfFrappe.files`) and the
 * upload-form hydrator. Invoked at module import time; the Flip agent adds
 * `import "./uploads.js";` to `hydrators.ts` (exported separately as a test seam).
 */
export function registerUploads(): void {
  registerNamespaceContribution(() => ({ files: { ...filesUploadExtension } }));
  registerHydrator({ name: "file-upload-forms", hydrate: hydrateFileUploadForms });
}

registerUploads();
