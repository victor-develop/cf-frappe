import { FrameworkError, type RenderedPrintPdfBody, type RenderPrintPdfCommand } from "../../src";
import {
  CloudflareBrowserRenderingPdfRenderer,
  type CloudflareBrowserRenderingBinding
} from "../../src/cloudflare";

describe("CloudflareBrowserRenderingPdfRenderer", () => {
  it("renders print HTML through Browser Run PDF quick actions", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const browser = new RecordingBrowserRun(new Response(pdf, {
      headers: {
        "content-length": String(pdf.byteLength),
        "content-type": "application/pdf"
      }
    }));
    const renderer = new CloudflareBrowserRenderingPdfRenderer({ browser });

    const rendered = await renderer.render({
      ...baseCommand(),
      layout: {
        pageSize: "A4",
        orientation: "landscape",
        margins: { topMm: 12, rightMm: 10.5, bottomMm: 14, leftMm: 10 }
      }
    });

    expect(browser.calls).toEqual([
      {
        action: "pdf",
        options: {
          html: "<main>Printable</main>",
          pdfOptions: {
            printBackground: true,
            preferCSSPageSize: true,
            format: "a4",
            landscape: true,
            margin: {
              top: "12mm",
              right: "10.5mm",
              bottom: "14mm",
              left: "10mm"
            }
          }
        }
      }
    ]);
    expect(rendered.contentType).toBe("application/pdf");
    expect(rendered.contentLength).toBe(4);
    await expect(renderedBodyBytes(rendered.body)).resolves.toEqual(pdf);
  });

  it("maps custom page sizes and caller PDF option overrides", async () => {
    const browser = new RecordingBrowserRun(new Response(new Uint8Array([1, 2, 3])));
    const renderer = new CloudflareBrowserRenderingPdfRenderer({
      browser,
      pdfOptions: { preferCSSPageSize: false, timeout: 10_000 }
    });

    await renderer.render({
      ...baseCommand(),
      layout: {
        pageSize: { widthMm: 210, heightMm: 297 },
        margins: { topMm: 8 }
      }
    });

    expect(browser.calls[0]?.options.pdfOptions).toEqual({
      printBackground: true,
      preferCSSPageSize: false,
      width: "210mm",
      height: "297mm",
      margin: { top: "8mm" },
      timeout: 10_000
    });
  });

  it("wraps Browser Run failures as framework render failures", async () => {
    const browser = new RecordingBrowserRun(new Response(JSON.stringify({ error: "quota exceeded" }), {
      status: 429,
      statusText: "Too Many Requests"
    }));
    const renderer = new CloudflareBrowserRenderingPdfRenderer({ browser });

    await expect(renderer.render(baseCommand())).rejects.toMatchObject({
      code: "PRINT_PDF_RENDER_FAILED",
      status: 502,
      message: expect.stringContaining("quota exceeded")
    } satisfies Partial<FrameworkError>);
  });

  it("wraps Browser Run rejections as framework render failures", async () => {
    const renderer = new CloudflareBrowserRenderingPdfRenderer({
      browser: new RejectingBrowserRun(new Error("quick actions require remote mode"))
    });

    await expect(renderer.render(baseCommand())).rejects.toMatchObject({
      code: "PRINT_PDF_RENDER_FAILED",
      status: 502,
      message: expect.stringContaining("quick actions require remote mode")
    } satisfies Partial<FrameworkError>);
  });
});

class RecordingBrowserRun implements CloudflareBrowserRenderingBinding {
  readonly calls: Array<{ readonly action: "pdf"; readonly options: BrowserRunPDFOptions }> = [];

  constructor(private readonly response: Response) {}

  async quickAction(action: "pdf", options: BrowserRunPDFOptions): Promise<Response> {
    this.calls.push({ action, options });
    return this.response.clone();
  }
}

class RejectingBrowserRun implements CloudflareBrowserRenderingBinding {
  constructor(private readonly error: unknown) {}

  async quickAction(_action: "pdf", _options: BrowserRunPDFOptions): Promise<Response> {
    throw this.error;
  }
}

function baseCommand(): RenderPrintPdfCommand {
  return {
    actorId: "owner@example.com",
    tenantId: "acme",
    formatName: "Standard",
    documentName: "NOTE-1",
    documentDoctype: "Note",
    title: "Note Standard",
    html: "<main>Printable</main>"
  };
}

async function renderedBodyBytes(body: RenderedPrintPdfBody): Promise<Uint8Array> {
  if (body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  return new Uint8Array(body);
}
