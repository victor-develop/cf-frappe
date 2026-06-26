import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  requestRemoteAdminPayload,
  requestRemoteAdminResponse,
  type RemoteAdminIo,
  type RemoteHeaderOption
} from "./remote-admin.js";

export type PrintFormatRemoteAction = "get" | "html" | "letterhead" | "letterheads" | "list" | "pdf";

export type PrintFormatHeaderOption = RemoteHeaderOption;

export interface PrintFormatRemoteCommand {
  readonly kind: "print-formats";
  readonly action: PrintFormatRemoteAction;
  readonly url: string;
  readonly headers: readonly PrintFormatHeaderOption[];
  readonly doctype?: string;
  readonly format?: string;
  readonly name?: string;
  readonly outputPath?: string;
  readonly letterhead?: string;
}

export interface PrintFormatRemoteIo extends RemoteAdminIo {
  readonly cwd?: string;
}

export class PrintFormatRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintFormatRemoteError";
  }
}

interface PrintFormatResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype?: string;
  readonly letterhead?: string;
  readonly roles?: readonly string[];
  readonly permissionAction?: string;
  readonly sections?: readonly unknown[];
  readonly template?: string;
  readonly layout?: Record<string, unknown>;
}

interface PrintLetterheadResponse {
  readonly name?: string;
  readonly label?: string;
  readonly roles?: readonly string[];
  readonly headerHtml?: string;
  readonly footerHtml?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemotePrintFormatCommand(
  command: PrintFormatRemoteCommand,
  io: PrintFormatRemoteIo = {}
): Promise<string> {
  if (command.action === "html" || command.action === "pdf") {
    const downloaded = await downloadRemotePrintDocument(command, io);
    return formatPrintDocumentDownload(command.url, command, downloaded.output, downloaded.bytes, downloaded.response);
  }
  if (command.action === "list") {
    const query = formatQuery(command);
    const data = await requestRemotePrintMetadata(command, io, {
      method: "GET",
      path: "/api/meta/print-formats",
      ...(query === undefined ? {} : { query })
    });
    return formatPrintFormatList(command.url, arrayData<PrintFormatResponse>(data.data, "print formats"));
  }
  if (command.action === "get") {
    const data = await requestRemotePrintMetadata(command, io, {
      method: "GET",
      path: `/api/meta/print-formats/${encodeURIComponent(requiredFormat(command))}`
    });
    return formatPrintFormat(command.url, objectData<PrintFormatResponse>(data.data, "print format"));
  }
  if (command.action === "letterheads") {
    const data = await requestRemotePrintMetadata(command, io, {
      method: "GET",
      path: "/api/meta/print-letterheads"
    });
    return formatPrintLetterheadList(command.url, arrayData<PrintLetterheadResponse>(data.data, "print letterheads"));
  }
  const data = await requestRemotePrintMetadata(command, io, {
    method: "GET",
    path: `/api/meta/print-letterheads/${encodeURIComponent(requiredLetterhead(command))}`
  });
  return formatPrintLetterhead(command.url, objectData<PrintLetterheadResponse>(data.data, "print letterhead"));
}

function requestRemotePrintDocumentResponse(
  command: PrintFormatRemoteCommand,
  io: PrintFormatRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
  }
): Promise<Response> {
  return requestRemoteAdminResponse<PrintFormatRemoteError>(command, io, request, {
    accept: command.action === "pdf" ? "application/pdf" : "text/html",
    error: PrintFormatRemoteError,
    fetchLabel: "remote print document commands",
    resourceLabel: "Remote print document",
    urlLabel: "Remote print document"
  });
}

async function downloadRemotePrintDocument(
  command: PrintFormatRemoteCommand,
  io: PrintFormatRemoteIo
): Promise<{ readonly output: string; readonly bytes: number; readonly response: Response }> {
  const format = requiredFormat(command);
  const name = requiredName(command);
  const output = outputPath(command, io.cwd);
  const response = await requestRemotePrintDocumentResponse(command, io, {
    method: "GET",
    path: `/api/print/${encodeURIComponent(format)}/${encodeURIComponent(name)}${command.action === "pdf" ? "/pdf" : ""}`
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    await writeFile(output, bytes);
  } catch (error) {
    throw new PrintFormatRemoteError(`Could not write print ${command.action} file '${command.outputPath}': ${errorMessage(error)}`);
  }
  return { output, bytes: bytes.byteLength, response };
}

function requestRemotePrintMetadata(
  command: PrintFormatRemoteCommand,
  io: PrintFormatRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, PrintFormatRemoteError>(command, io, request, {
    error: PrintFormatRemoteError,
    fetchLabel: "remote print format commands",
    resourceLabel: "Remote print metadata",
    urlLabel: "Remote print metadata"
  });
}

function formatQuery(command: PrintFormatRemoteCommand): URLSearchParams | undefined {
  if (command.doctype === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("doctype", command.doctype);
  return params;
}

function formatPrintFormatList(baseUrl: string, formats: readonly PrintFormatResponse[]): string {
  return [
    `Print formats at ${baseUrl}`,
    `Total: ${String(formats.length)}`,
    ...printFormatLines(formats),
    ""
  ].join("\n");
}

function formatPrintFormat(baseUrl: string, format: PrintFormatResponse): string {
  return [
    `Print format at ${baseUrl}`,
    printFormatLine(format),
    ...(format.label === undefined ? [] : [`Label: ${format.label}`]),
    ...(format.module === undefined ? [] : [`Module: ${format.module}`]),
    ...(format.description === undefined ? [] : [`Description: ${format.description}`]),
    ...(format.roles === undefined || format.roles.length === 0 ? [] : [`Roles: ${format.roles.join(", ")}`]),
    ...(format.permissionAction === undefined ? [] : [`Permission action: ${format.permissionAction}`]),
    `Sections: ${String(format.sections?.length ?? 0)}`,
    `Template: ${format.template === undefined ? "no" : "yes"}`,
    ...(format.layout === undefined ? [] : [`Layout: ${JSON.stringify(format.layout)}`]),
    ""
  ].join("\n");
}

function printFormatLines(formats: readonly PrintFormatResponse[]): readonly string[] {
  if (formats.length === 0) {
    return ["- (none)"];
  }
  return formats.map(printFormatLine);
}

function printFormatLine(format: PrintFormatResponse): string {
  const doctype = format.doctype === undefined ? "(unknown doctype)" : format.doctype;
  const label = format.label === undefined ? "" : ` - ${format.label}`;
  const letterhead = format.letterhead === undefined ? "" : ` letterhead=${format.letterhead}`;
  return `- ${format.name ?? "(unknown)"} [${doctype}]${letterhead}${label}`;
}

function formatPrintLetterheadList(baseUrl: string, letterheads: readonly PrintLetterheadResponse[]): string {
  return [
    `Print letterheads at ${baseUrl}`,
    `Total: ${String(letterheads.length)}`,
    ...printLetterheadLines(letterheads),
    ""
  ].join("\n");
}

function formatPrintLetterhead(baseUrl: string, letterhead: PrintLetterheadResponse): string {
  return [
    `Print letterhead at ${baseUrl}`,
    printLetterheadLine(letterhead),
    ...(letterhead.label === undefined ? [] : [`Label: ${letterhead.label}`]),
    ...(letterhead.roles === undefined || letterhead.roles.length === 0 ? [] : [`Roles: ${letterhead.roles.join(", ")}`]),
    `Header HTML: ${letterhead.headerHtml === undefined ? "no" : "yes"}`,
    `Footer HTML: ${letterhead.footerHtml === undefined ? "no" : "yes"}`,
    ""
  ].join("\n");
}

function formatPrintDocumentDownload(
  baseUrl: string,
  command: PrintFormatRemoteCommand,
  outputPath: string,
  bytes: number,
  response: Response
): string {
  const contentType = response.headers.get("content-type");
  return [
    `Downloaded print ${command.action.toUpperCase()} from ${baseUrl}`,
    `- ${requiredFormat(command)}/${requiredName(command)} -> ${outputPath} bytes ${String(bytes)}${contentType === null ? "" : ` type ${contentType}`}`,
    ""
  ].join("\n");
}

function printLetterheadLines(letterheads: readonly PrintLetterheadResponse[]): readonly string[] {
  if (letterheads.length === 0) {
    return ["- (none)"];
  }
  return letterheads.map(printLetterheadLine);
}

function printLetterheadLine(letterhead: PrintLetterheadResponse): string {
  const label = letterhead.label === undefined ? "" : ` - ${letterhead.label}`;
  return `- ${letterhead.name ?? "(unknown)"}${label}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new PrintFormatRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new PrintFormatRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredFormat(command: PrintFormatRemoteCommand): string {
  if (command.format === undefined) {
    throw new PrintFormatRemoteError(`Print format ${command.action} requires --format`);
  }
  return command.format;
}

function requiredName(command: PrintFormatRemoteCommand): string {
  if (command.name === undefined) {
    throw new PrintFormatRemoteError(`Print format ${command.action} requires --name`);
  }
  return command.name;
}

function outputPath(command: PrintFormatRemoteCommand, cwd = process.cwd()): string {
  if (command.outputPath === undefined) {
    throw new PrintFormatRemoteError(`Print format ${command.action} requires --output`);
  }
  return resolve(cwd, command.outputPath);
}

function requiredLetterhead(command: PrintFormatRemoteCommand): string {
  if (command.letterhead === undefined) {
    throw new PrintFormatRemoteError("Print format letterhead requires --letterhead");
  }
  return command.letterhead;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
