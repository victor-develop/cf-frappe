import type { PrintDocumentView } from "../../application/print-service.js";
import type { ReportRunResult } from "../../application/report-service.js";
import type { PrintLayoutDefinition } from "../../core/print-format.js";
import type { Actor } from "../../core/types.js";
import type { PrintPdfRenderer, RenderedPrintPdf, RenderedPrintPdfBody } from "../../ports/print-pdf-renderer.js";
import { printDocumentTitle, renderPrintDocument, renderPrintReport } from "./render.js";

export interface RenderPrintPdfDocumentOptions {
  readonly actor: Actor;
  readonly renderer: PrintPdfRenderer;
  readonly view: PrintDocumentView;
}

export interface RenderPrintPdfReportOptions {
  readonly actor: Actor;
  readonly renderer: PrintPdfRenderer;
  readonly result: ReportRunResult;
  readonly title?: string;
  readonly layout?: PrintLayoutDefinition;
}

export interface PrintPdfDocumentResult {
  readonly body: RenderedPrintPdfBody;
  readonly contentType: string;
  readonly contentLength?: number;
  readonly filename: string;
}

export async function renderPrintPdfDocument(options: RenderPrintPdfDocumentOptions): Promise<PrintPdfDocumentResult> {
  const title = printDocumentTitle(options.view);
  const rendered = await options.renderer.render({
    actorId: options.actor.id,
    ...(options.actor.tenantId === undefined ? {} : { tenantId: options.actor.tenantId }),
    formatName: options.view.format.name,
    documentName: options.view.document.name,
    documentDoctype: options.view.document.doctype,
    title,
    ...(options.view.format.layout === undefined ? {} : { layout: options.view.format.layout }),
    html: renderPrintDocument(options.view)
  });
  return printPdfResult(rendered, defaultPrintPdfFilename(options.view));
}

export async function renderPrintPdfReport(options: RenderPrintPdfReportOptions): Promise<PrintPdfDocumentResult> {
  const title = reportPrintTitle(options.result, options.title);
  const rendered = await options.renderer.render({
    actorId: options.actor.id,
    ...(options.actor.tenantId === undefined ? {} : { tenantId: options.actor.tenantId }),
    formatName: "Report",
    documentName: options.result.report.name,
    documentDoctype: options.result.report.doctype,
    title: `${title} - Report`,
    ...(options.layout === undefined ? {} : { layout: options.layout }),
    html: renderPrintReport(options.result, {
      title,
      ...(options.layout === undefined ? {} : { layout: options.layout })
    })
  });
  return printPdfResult(rendered, defaultReportPdfFilename(options.result));
}

export function printPdfResponseHeaders(result: PrintPdfDocumentResult): HeadersInit {
  const headers: Record<string, string> = {
    "content-disposition": `inline; filename="${result.filename}"`,
    "content-type": result.contentType
  };
  if (result.contentLength !== undefined) {
    headers["content-length"] = String(result.contentLength);
  }
  return headers;
}

export function printPdfResponseBody(body: RenderedPrintPdfBody): BodyInit {
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  return body;
}

function printPdfResult(rendered: RenderedPrintPdf, defaultFilename: string): PrintPdfDocumentResult {
  const contentLength = rendered.contentLength ?? bodyContentLength(rendered.body);
  return {
    body: rendered.body,
    contentType: rendered.contentType ?? "application/pdf",
    ...(contentLength === undefined ? {} : { contentLength }),
    filename: rendered.filename ? sanitizePdfFilename(rendered.filename) : defaultFilename
  };
}

function defaultPrintPdfFilename(view: PrintDocumentView): string {
  return `${filenamePart(view.document.name, "document")}.${filenamePart(view.format.name, "format")}.pdf`;
}

function defaultReportPdfFilename(result: ReportRunResult): string {
  return `${filenamePart(result.report.name, "report")}.report.pdf`;
}

function reportPrintTitle(result: ReportRunResult, title?: string): string {
  return title ?? result.report.label ?? result.report.name;
}

function sanitizePdfFilename(value: string): string {
  const sanitized = value
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/[-.]+$/, "");
  const filename = sanitized || "print";
  return filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
}

function filenamePart(value: string, fallback: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

function bodyContentLength(body: RenderedPrintPdfBody): number | undefined {
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  return undefined;
}
