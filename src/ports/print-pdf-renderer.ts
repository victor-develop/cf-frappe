import type { PrintLayoutDefinition } from "../core/print-format.js";

export type RenderedPrintPdfBody = ArrayBuffer | ReadableStream<Uint8Array> | Uint8Array;

export interface RenderPrintPdfCommand {
  readonly actorId: string;
  readonly tenantId?: string;
  readonly formatName: string;
  readonly documentName: string;
  readonly documentDoctype: string;
  readonly title: string;
  readonly layout?: PrintLayoutDefinition;
  readonly html: string;
}

export interface RenderedPrintPdf {
  readonly body: RenderedPrintPdfBody;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly filename?: string;
}

export interface PrintPdfRenderer {
  render(command: RenderPrintPdfCommand): Promise<RenderedPrintPdf>;
}
