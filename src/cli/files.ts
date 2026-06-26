import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { requestRemoteAdmin, requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type FileRemoteAction = "bulk-delete" | "bulk-update" | "list" | "delete" | "rendition" | "update" | "upload";

export type FileHeaderOption = RemoteHeaderOption;

export interface FileRemoteCommand {
  readonly kind: "files";
  readonly action: FileRemoteAction;
  readonly url: string;
  readonly headers: readonly FileHeaderOption[];
  readonly name?: string;
  readonly path?: string;
  readonly files?: readonly FileRemoteSelection[];
  readonly attachedToDoctype?: string;
  readonly attachedToName?: string;
  readonly contentType?: string;
  readonly filename?: string;
  readonly isPrivate?: boolean;
  readonly limit?: number;
  readonly scanStatus?: string;
  readonly storageState?: string;
  readonly uploadedBy?: string;
  readonly expectedVersion?: number;
  readonly clearAttachment?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fit?: string;
  readonly format?: string;
  readonly quality?: number;
  readonly watermark?: string;
  readonly watermarkPlacement?: string;
  readonly watermarkOpacity?: number;
  readonly watermarkColor?: string;
  readonly watermarkFontSize?: number;
  readonly overlay?: string;
  readonly overlayPlacement?: string;
  readonly overlayOpacity?: number;
  readonly overlayWidth?: number;
  readonly overlayHeight?: number;
}

export interface FileRemoteSelection {
  readonly name: string;
  readonly expectedVersion?: number;
}

export interface FileRemoteIo extends RemoteAdminIo {
  readonly cwd?: string;
}

export class FileRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRemoteError";
  }
}

interface FileDashboardResponse {
  readonly canUpload?: boolean;
  readonly maxUploadBytes?: number;
  readonly files: readonly FileDashboardEntryResponse[];
  readonly limit?: number;
}

interface FileDashboardEntryResponse {
  readonly name: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly isPrivate?: boolean;
  readonly storageState?: string;
  readonly scanStatus?: string;
  readonly uploadedBy?: string;
  readonly uploadedAt?: string;
  readonly expectedVersion?: number;
  readonly attachedTo?: {
    readonly doctype?: string;
    readonly name?: string;
  };
}

interface FileSnapshotResponse {
  readonly name: string;
  readonly version?: number;
  readonly docstatus?: string;
  readonly data?: {
    readonly filename?: string;
    readonly size?: number;
    readonly content_type?: string;
    readonly storage_state?: string;
    readonly is_private?: boolean;
    readonly uploaded_by?: string;
  };
}

interface BulkFileCommandResponse {
  readonly deleted?: readonly BulkFileSuccessResponse[];
  readonly updated?: readonly BulkFileSuccessResponse[];
  readonly failed: readonly BulkFileFailureResponse[];
}

interface BulkFileSuccessResponse {
  readonly name: string;
  readonly snapshot: FileSnapshotResponse;
}

interface BulkFileFailureResponse {
  readonly name: string;
  readonly code?: string;
  readonly message?: string;
  readonly status?: number;
}

interface FileRenditionCommandResponse {
  readonly data: FileSnapshotResponse;
  readonly rendition?: FileRenditionResponse;
  readonly created?: boolean;
}

interface FileRenditionResponse {
  readonly id?: string;
  readonly status?: string;
  readonly contentType?: string;
  readonly size?: number;
}

export async function runRemoteFileCommand(command: FileRemoteCommand, io: FileRemoteIo = {}): Promise<string> {
  if (command.action === "upload") {
    const contentType = command.contentType ?? "application/octet-stream";
    const file = await uploadFileBody(command, io.cwd);
    const query = queryParams({
      filename: command.filename ?? basename(file.path),
      ...(command.isPrivate === undefined ? {} : { is_private: String(command.isPrivate) }),
      ...(command.attachedToDoctype === undefined ? {} : { attached_to_doctype: command.attachedToDoctype }),
      ...(command.attachedToName === undefined ? {} : { attached_to_name: command.attachedToName })
    });
    const data = await requestRemoteFile<FileSnapshotResponse>(command, io, {
      contentType,
      method: "POST",
      path: "/api/files",
      rawBody: file.body,
      ...(query === undefined ? {} : { query })
    });
    return formatUpload(command.url, data);
  }
  if (command.action === "list") {
    const query = queryParams({
      ...(command.attachedToDoctype === undefined ? {} : { attached_to_doctype: command.attachedToDoctype }),
      ...(command.attachedToName === undefined ? {} : { attached_to_name: command.attachedToName }),
      ...(command.contentType === undefined ? {} : { content_type: command.contentType }),
      ...(command.filename === undefined ? {} : { filename: command.filename }),
      ...(command.isPrivate === undefined ? {} : { is_private: String(command.isPrivate) }),
      ...(command.limit === undefined ? {} : { limit: String(command.limit) }),
      ...(command.scanStatus === undefined ? {} : { scan_status: command.scanStatus }),
      ...(command.storageState === undefined ? {} : { storage_state: command.storageState }),
      ...(command.uploadedBy === undefined ? {} : { uploaded_by: command.uploadedBy })
    });
    const data = await requestRemoteFile<FileDashboardResponse>(command, io, {
      method: "GET",
      path: "/api/files",
      ...(query === undefined ? {} : { query })
    });
    return formatDashboard(command.url, data);
  }
  if (command.action === "update") {
    const data = await requestRemoteFile<FileSnapshotResponse>(command, io, {
      body: updateBody(command),
      method: "PATCH",
      path: `/api/files/${encodeURIComponent(requiredFileName(command, "update"))}`
    });
    return formatUpdate(command.url, data);
  }
  if (command.action === "bulk-update") {
    const data = await requestRemoteFile<BulkFileCommandResponse>(command, io, {
      body: bulkMetadataBody(command),
      method: "POST",
      path: "/api/files/bulk-metadata"
    });
    return formatBulkUpdate(command.url, data);
  }
  if (command.action === "bulk-delete") {
    const data = await requestRemoteFile<BulkFileCommandResponse>(command, io, {
      body: bulkFilesBody(command),
      method: "POST",
      path: "/api/files/delete"
    });
    return formatBulkDelete(command.url, data);
  }
  if (command.action === "rendition") {
    const payload = await requestRemoteFilePayload<FileRenditionCommandResponse>(command, io, {
      body: renditionBody(command),
      method: "POST",
      path: `/api/files/${encodeURIComponent(requiredFileName(command, "rendition"))}/renditions`
    });
    return formatRendition(command.url, payload);
  }
  const query = queryParams({
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: String(command.expectedVersion) })
  });
  const data = await requestRemoteFile<FileSnapshotResponse>(command, io, {
    method: "DELETE",
    path: `/api/files/${encodeURIComponent(requiredFileName(command, "delete"))}`,
    ...(query === undefined ? {} : { query })
  });
  return formatDelete(command.url, data);
}

function requestRemoteFile<TData>(
  command: FileRemoteCommand,
  io: FileRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly rawBody?: BodyInit;
    readonly contentType?: string;
    readonly method: "DELETE" | "GET" | "PATCH" | "POST";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<TData> {
  return requestRemoteAdmin<TData, FileRemoteError>(command, io, request, {
    error: FileRemoteError,
    fetchLabel: "remote file commands",
    resourceLabel: "Remote file",
    urlLabel: "Remote file"
  });
}

function requestRemoteFilePayload<TPayload>(
  command: FileRemoteCommand,
  io: FileRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly rawBody?: BodyInit;
    readonly contentType?: string;
    readonly method: "DELETE" | "GET" | "PATCH" | "POST";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<TPayload> {
  return requestRemoteAdminPayload<TPayload, FileRemoteError>(command, io, request, {
    error: FileRemoteError,
    fetchLabel: "remote file commands",
    resourceLabel: "Remote file",
    urlLabel: "Remote file"
  });
}

function queryParams(values: Record<string, string>): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  return params.toString().length === 0 ? undefined : params;
}

function renditionBody(command: FileRemoteCommand): Record<string, unknown> {
  return {
    ...(command.width === undefined ? {} : { width: command.width }),
    ...(command.height === undefined ? {} : { height: command.height }),
    ...(command.fit === undefined ? {} : { fit: command.fit }),
    ...(command.format === undefined ? {} : { format: command.format }),
    ...(command.quality === undefined ? {} : { quality: command.quality }),
    ...watermarkBody(command),
    ...overlayBody(command)
  };
}

function watermarkBody(command: FileRemoteCommand): Record<string, unknown> {
  if (command.watermark === undefined) {
    return {};
  }
  return {
    watermark: {
      text: command.watermark,
      ...(command.watermarkPlacement === undefined ? {} : { placement: command.watermarkPlacement }),
      ...(command.watermarkOpacity === undefined ? {} : { opacity: command.watermarkOpacity }),
      ...(command.watermarkColor === undefined ? {} : { color: command.watermarkColor }),
      ...(command.watermarkFontSize === undefined ? {} : { fontSize: command.watermarkFontSize })
    }
  };
}

function overlayBody(command: FileRemoteCommand): Record<string, unknown> {
  if (command.overlay === undefined) {
    return {};
  }
  return {
    overlay: {
      file: command.overlay,
      ...(command.overlayPlacement === undefined ? {} : { placement: command.overlayPlacement }),
      ...(command.overlayOpacity === undefined ? {} : { opacity: command.overlayOpacity }),
      ...(command.overlayWidth === undefined ? {} : { width: command.overlayWidth }),
      ...(command.overlayHeight === undefined ? {} : { height: command.overlayHeight })
    }
  };
}

function bulkFilesBody(command: FileRemoteCommand): Record<string, unknown> {
  return { files: command.files ?? [] };
}

function bulkMetadataBody(command: FileRemoteCommand): Record<string, unknown> {
  const body = bulkFilesBody(command);
  if (command.isPrivate !== undefined) {
    body.isPrivate = command.isPrivate;
  }
  if (command.clearAttachment) {
    body.attachedTo = null;
  } else if (command.attachedToDoctype !== undefined || command.attachedToName !== undefined) {
    body.attachedTo = {
      doctype: command.attachedToDoctype,
      name: command.attachedToName
    };
  }
  return body;
}

function updateBody(command: FileRemoteCommand): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (command.filename !== undefined) {
    body.filename = command.filename;
  }
  if (command.isPrivate !== undefined) {
    body.isPrivate = command.isPrivate;
  }
  if (command.clearAttachment) {
    body.attachedTo = null;
  } else if (command.attachedToDoctype !== undefined || command.attachedToName !== undefined) {
    body.attachedTo = {
      doctype: command.attachedToDoctype,
      name: command.attachedToName
    };
  }
  if (command.expectedVersion !== undefined) {
    body.expectedVersion = command.expectedVersion;
  }
  return body;
}

function requiredFileName(command: FileRemoteCommand, action: string): string {
  if (command.name === undefined) {
    throw new FileRemoteError(`File ${action} requires --name`);
  }
  return command.name;
}

async function uploadFileBody(command: FileRemoteCommand, cwd = process.cwd()): Promise<{ readonly body: Blob; readonly path: string }> {
  if (command.path === undefined) {
    throw new FileRemoteError("File upload requires --path");
  }
  const path = resolve(cwd, command.path);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new FileRemoteError(`Could not read upload file '${command.path}': ${errorMessage(error)}`);
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return {
    path,
    body: new Blob([buffer], { type: command.contentType ?? "application/octet-stream" })
  };
}

function formatDashboard(baseUrl: string, dashboard: FileDashboardResponse): string {
  return [
    `Files at ${baseUrl}`,
    dashboard.limit === undefined ? undefined : `Limit: ${String(dashboard.limit)}`,
    dashboard.maxUploadBytes === undefined ? undefined : `Max upload bytes: ${String(dashboard.maxUploadBytes)}`,
    ...fileLines(dashboard.files),
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatUpdate(baseUrl: string, snapshot: FileSnapshotResponse): string {
  return [
    `Updated file at ${baseUrl}`,
    snapshotLine(snapshot),
    ""
  ].join("\n");
}

function formatUpload(baseUrl: string, snapshot: FileSnapshotResponse): string {
  return [
    `Uploaded file at ${baseUrl}`,
    snapshotLine(snapshot),
    ""
  ].join("\n");
}

function formatBulkUpdate(baseUrl: string, result: BulkFileCommandResponse): string {
  return formatBulkCommand(baseUrl, "Updated files", result.updated ?? [], result.failed);
}

function formatBulkDelete(baseUrl: string, result: BulkFileCommandResponse): string {
  return formatBulkCommand(baseUrl, "Deleted files", result.deleted ?? [], result.failed);
}

function formatRendition(baseUrl: string, payload: FileRenditionCommandResponse): string {
  const rendition = payload.rendition ?? {};
  const contentUrl = rendition.id === undefined
    ? undefined
    : `${baseUrl.replace(/\/+$/, "")}/api/files/${encodeURIComponent(payload.data.name)}/renditions/${encodeURIComponent(rendition.id)}/content`;
  return [
    `Generated file rendition at ${baseUrl}`,
    `Created: ${String(payload.created ?? false)}`,
    renditionLine(rendition),
    snapshotLine(payload.data),
    contentUrl === undefined ? undefined : `Content: ${contentUrl}`,
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatBulkCommand(
  baseUrl: string,
  title: string,
  succeeded: readonly BulkFileSuccessResponse[],
  failed: readonly BulkFileFailureResponse[]
): string {
  return [
    `${title} at ${baseUrl}`,
    `Succeeded: ${String(succeeded.length)}`,
    ...succeeded.map((item) => snapshotLine(item.snapshot)),
    `Failed: ${String(failed.length)}`,
    ...failed.map(failureLine),
    ""
  ].join("\n");
}

function renditionLine(rendition: FileRenditionResponse): string {
  const id = rendition.id ?? "(unknown)";
  const status = rendition.status === undefined ? "" : ` status ${rendition.status}`;
  const contentType = rendition.contentType === undefined ? "" : ` type ${rendition.contentType}`;
  const size = rendition.size === undefined ? "" : ` size ${String(rendition.size)}`;
  return `- rendition ${id}${status}${contentType}${size}`;
}

function formatDelete(baseUrl: string, snapshot: FileSnapshotResponse): string {
  return [
    `Deleted file at ${baseUrl}`,
    snapshotLine(snapshot),
    ""
  ].join("\n");
}

function fileLines(files: readonly FileDashboardEntryResponse[]): readonly string[] {
  return files.length === 0 ? ["- (none)"] : files.map(fileLine);
}

function fileLine(file: FileDashboardEntryResponse): string {
  const filename = file.filename === undefined ? file.name : file.filename;
  const size = file.size === undefined ? "" : ` size ${String(file.size)}`;
  const contentType = file.contentType === undefined ? "" : ` type ${file.contentType}`;
  const state = file.storageState === undefined ? "" : ` state ${file.storageState}`;
  const scan = file.scanStatus === undefined ? "" : ` scan ${file.scanStatus}`;
  const privacy = file.isPrivate === undefined ? "" : ` private ${String(file.isPrivate)}`;
  const attached = attachmentLabel(file.attachedTo);
  const uploadedBy = file.uploadedBy === undefined ? "" : ` uploaded by ${file.uploadedBy}`;
  const version = file.expectedVersion === undefined ? "" : ` version ${String(file.expectedVersion)}`;
  return `- ${filename} (${file.name})${size}${contentType}${state}${scan}${privacy}${attached}${uploadedBy}${version}`;
}

function snapshotLine(snapshot: FileSnapshotResponse): string {
  const filename = snapshot.data?.filename === undefined ? snapshot.name : snapshot.data.filename;
  const version = snapshot.version === undefined ? "" : ` version ${String(snapshot.version)}`;
  const status = snapshot.docstatus === undefined ? "" : ` status ${snapshot.docstatus}`;
  const state = snapshot.data?.storage_state === undefined ? "" : ` state ${snapshot.data.storage_state}`;
  return `- ${filename} (${snapshot.name})${version}${status}${state}`;
}

function failureLine(failure: BulkFileFailureResponse): string {
  const status = failure.status === undefined ? "" : ` status ${String(failure.status)}`;
  const code = failure.code === undefined ? "UNKNOWN" : failure.code;
  const message = failure.message === undefined ? "File operation failed" : failure.message;
  return `- ${failure.name} failed ${code}${status}: ${message}`;
}

function attachmentLabel(attachedTo: FileDashboardEntryResponse["attachedTo"]): string {
  if (!attachedTo || !attachedTo.doctype || !attachedTo.name) {
    return "";
  }
  return ` attached to ${attachedTo.doctype}/${attachedTo.name}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
