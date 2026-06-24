import type { PrintLayoutDefinition, PrintPageSizeName } from "../core/print-format.js";
import { FrameworkError } from "../core/errors.js";
import type { PrintPdfRenderer, RenderPrintPdfCommand, RenderedPrintPdf } from "../ports/print-pdf-renderer.js";

type BrowserRunPdfOptions = NonNullable<BrowserRunPDFOptions["pdfOptions"]>;
type BrowserRunPdfFormat = Exclude<BrowserRunPdfOptions["format"], undefined>;

export interface CloudflareBrowserRenderingBinding {
  quickAction(action: "pdf", options: BrowserRunPDFOptions): Promise<Response>;
}

export interface CloudflareBrowserRenderingPdfRendererOptions {
  readonly browser: CloudflareBrowserRenderingBinding;
  readonly pdfOptions?: BrowserRunPDFOptions["pdfOptions"];
}

export class CloudflareBrowserRenderingPdfRenderer implements PrintPdfRenderer {
  constructor(private readonly options: CloudflareBrowserRenderingPdfRendererOptions) {}

  async render(command: RenderPrintPdfCommand): Promise<RenderedPrintPdf> {
    let response: Response;
    try {
      response = await this.options.browser.quickAction("pdf", {
        html: command.html,
        pdfOptions: {
          printBackground: true,
          preferCSSPageSize: true,
          ...pdfOptionsForLayout(command.layout),
          ...(this.options.pdfOptions ?? {})
        }
      });
    } catch (error) {
      throw new FrameworkError(
        "PRINT_PDF_RENDER_FAILED",
        `Cloudflare Browser Rendering PDF failed for '${command.title}': ${browserRenderingThrownErrorMessage(error)}`,
        { status: 502 }
      );
    }
    if (!response.ok) {
      throw new FrameworkError(
        "PRINT_PDF_RENDER_FAILED",
        `Cloudflare Browser Rendering PDF failed for '${command.title}': ${await browserRenderingErrorMessage(response)}`,
        { status: 502 }
      );
    }
    const contentLength = numberHeader(response.headers.get("content-length"));
    return {
      body: response.body ?? new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/pdf",
      ...(contentLength === undefined ? {} : { contentLength })
    };
  }
}

function pdfOptionsForLayout(
  layout: PrintLayoutDefinition | undefined
): BrowserRunPdfOptions {
  if (layout === undefined) {
    return {};
  }
  return {
    ...pdfPageSizeOptions(layout.pageSize),
    ...(layout.orientation === "landscape" ? { landscape: true } : {}),
    ...(layout.margins === undefined ? {} : { margin: pdfMarginOptions(layout.margins) })
  };
}

function pdfPageSizeOptions(
  pageSize: PrintLayoutDefinition["pageSize"] | undefined
): BrowserRunPdfOptions {
  if (pageSize === undefined) {
    return {};
  }
  if (typeof pageSize === "string") {
    return { format: pdfPageSizeName(pageSize) };
  }
  return {
    width: `${formatMillimeters(pageSize.widthMm)}mm`,
    height: `${formatMillimeters(pageSize.heightMm)}mm`
  };
}

function pdfPageSizeName(pageSize: PrintPageSizeName): BrowserRunPdfFormat {
  return pageSize.toLowerCase() as BrowserRunPdfFormat;
}

function pdfMarginOptions(
  margins: NonNullable<PrintLayoutDefinition["margins"]>
): NonNullable<BrowserRunPdfOptions["margin"]> {
  return {
    ...(margins.topMm === undefined ? {} : { top: `${formatMillimeters(margins.topMm)}mm` }),
    ...(margins.rightMm === undefined ? {} : { right: `${formatMillimeters(margins.rightMm)}mm` }),
    ...(margins.bottomMm === undefined ? {} : { bottom: `${formatMillimeters(margins.bottomMm)}mm` }),
    ...(margins.leftMm === undefined ? {} : { left: `${formatMillimeters(margins.leftMm)}mm` })
  };
}

function formatMillimeters(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function numberHeader(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function browserRenderingErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || `${response.status} ${response.statusText || "Browser Rendering request failed"}`;
  } catch (_error) {
    return `${response.status} ${response.statusText || "Browser Rendering request failed"}`;
  }
}

function browserRenderingThrownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "Browser Rendering request failed";
}
