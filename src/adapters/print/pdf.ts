import type { PrintDocumentView } from "../../application/print-service.js";
import type { Actor } from "../../core/types.js";
import type { PrintPdfRenderer, RenderedPrintPdf, RenderedPrintPdfBody } from "../../ports/print-pdf-renderer.js";
import { printDocumentTitle, renderPrintDocument } from "./render.js";

export interface RenderPrintPdfDocumentOptions {
  readonly actor: Actor;
  readonly renderer: PrintPdfRenderer;
  readonly view: PrintDocumentView;
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
  return printPdfDocumentResult(options.view, rendered);
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

function printPdfDocumentResult(view: PrintDocumentView, rendered: RenderedPrintPdf): PrintPdfDocumentResult {
  const contentLength = rendered.contentLength ?? bodyContentLength(rendered.body);
  return {
    body: rendered.body,
    contentType: rendered.contentType ?? "application/pdf",
    ...(contentLength === undefined ? {} : { contentLength }),
    filename: rendered.filename ? sanitizePdfFilename(rendered.filename) : defaultPrintPdfFilename(view)
  };
}

function defaultPrintPdfFilename(view: PrintDocumentView): string {
  return `${filenamePart(view.document.name, "document")}.${filenamePart(view.format.name, "format")}.pdf`;
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
