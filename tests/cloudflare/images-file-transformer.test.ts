import { CloudflareImagesFileTransformer } from "../../src/cloudflare";
import type { TransformFileObjectCommand } from "../../src";

describe("CloudflareImagesFileTransformer", () => {
  it("streams source bytes through the Images binding with normalized options", async () => {
    const calls: unknown[] = [];
    const transformer = new CloudflareImagesFileTransformer(fakeImages(calls));

    const transformed = await transformer.transform(command({
      width: 320,
      height: 240,
      fit: "cover",
      format: "webp",
      quality: 82
    }));

    expect(calls).toEqual([
      { input: expect.any(ReadableStream) },
      { transform: { width: 320, height: 240, fit: "cover" } },
      { output: { format: "image/webp", anim: false, quality: 82 } }
    ]);
    expect(transformed.contentType).toBe("image/webp");
    expect(transformed.contentLength).toBe(15);
    expect(transformed.etag).toBe('"image-transform"');
    await expect(new Response(transformed.body).text()).resolves.toBe("image-rendition");
  });

  it("uses the source image format when no output format is requested", async () => {
    const calls: unknown[] = [];
    const transformer = new CloudflareImagesFileTransformer(fakeImages(calls));

    await transformer.transform(command({ width: 120 }));

    expect(calls.at(-1)).toEqual({ output: { format: "image/png", anim: false } });
  });

  it("rejects text watermarks instead of silently dropping unsupported options", async () => {
    const calls: unknown[] = [];
    const transformer = new CloudflareImagesFileTransformer(fakeImages(calls));

    await expect(transformer.transform(command({ width: 120, watermark: { text: "Draft Copy" } }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      message: "Cloudflare Images binding does not support text watermarks"
    });
    expect(calls).toEqual([]);
  });

  it("rejects image overlays instead of silently dropping unsupported options", async () => {
    const calls: unknown[] = [];
    const transformer = new CloudflareImagesFileTransformer(fakeImages(calls));

    await expect(transformer.transform(command({ width: 120, overlay: { file: "file_badge" } }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      message: "Cloudflare Images binding does not support image overlays"
    });
    expect(calls).toEqual([]);
  });

  it("maps Images binding failures to framework storage errors", async () => {
    const transformer = new CloudflareImagesFileTransformer({
      input() {
        throw new Error("bad image bytes");
      }
    } as unknown as ImagesBinding);

    await expect(transformer.transform(command({ width: 120 }))).rejects.toMatchObject({
      code: "FILE_STORAGE_ERROR",
      status: 502,
      message: "Cloudflare image transform failed for 'acme/files/file_1-avatar.png': bad image bytes"
    });
  });
});

function command(options: TransformFileObjectCommand["options"]): TransformFileObjectCommand {
  return {
    actorId: "owner@example.com",
    tenantId: "acme",
    source: {
      key: "acme/files/file_1-avatar.png",
      filename: "avatar.png",
      contentType: "image/png",
      size: 12,
      body: new Response("source-bytes").body as ReadableStream<Uint8Array>,
      etag: "etag",
      httpEtag: '"etag"'
    },
    options
  };
}

function fakeImages(calls: unknown[]): ImagesBinding {
  return {
    input(stream: ReadableStream<Uint8Array>) {
      calls.push({ input: stream });
      return {
        transform(options: ImageTransform) {
          calls.push({ transform: options });
          return this;
        },
        async output(options: ImageOutputOptions) {
          calls.push({ output: options });
          return {
            response() {
              return new Response("image-rendition", {
                headers: {
                  "content-type": options.format,
                  "content-length": "15",
                  etag: '"image-transform"'
                }
              });
            },
            contentType() {
              return options.format;
            },
            image() {
              return new Response("image-rendition").body as ReadableStream<Uint8Array>;
            }
          };
        },
        draw() {
          return this;
        }
      } as unknown as ImageTransformer;
    }
  } as unknown as ImagesBinding;
}
