import { badRequest, FrameworkError } from "../core/errors.js";
import type {
  FileTransformer,
  FileTransformFormat,
  FileTransformOptions,
  TransformFileObjectCommand,
  TransformedFileObject
} from "../ports/file-transformer.js";
import { normalizeFileTransformContentType } from "../ports/file-transformer.js";

export class CloudflareImagesFileTransformer implements FileTransformer {
  constructor(private readonly images: ImagesBinding) {}

  validateOptions(options: FileTransformOptions): void {
    if (options.watermark !== undefined) {
      throw badRequest("Cloudflare Images binding does not support text watermarks");
    }
  }

  async transform(command: TransformFileObjectCommand): Promise<TransformedFileObject> {
    this.validateOptions(command.options);
    try {
      const result = await this.images
        .input(command.source.body)
        .transform(imageTransform(command.options))
        .output(imageOutput(command));
      const response = result.response();
      const contentLength = response.headers.get("content-length");
      const etag = response.headers.get("etag");
      return {
        body: response.body ?? emptyBody(),
        contentType: result.contentType() || response.headers.get("content-type") || imageOutput(command).format,
        ...(contentLength === null ? {} : { contentLength: Number(contentLength) }),
        ...(etag === null ? {} : { etag })
      };
    } catch (error) {
      throw new FrameworkError(
        "FILE_STORAGE_ERROR",
        `Cloudflare image transform failed for '${command.source.key}': ${errorMessage(error)}`,
        { status: 502 }
      );
    }
  }
}

function imageTransform(options: FileTransformOptions): ImageTransform {
  return {
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height }),
    ...(options.fit === undefined ? {} : { fit: options.fit })
  };
}

function imageOutput(command: TransformFileObjectCommand): ImageOutputOptions {
  return {
    format: outputFormat(command.options.format ?? sourceFormat(command.source.contentType)),
    anim: false,
    ...(command.options.quality === undefined ? {} : { quality: command.options.quality })
  };
}

function sourceFormat(contentType: string): FileTransformFormat {
  const normalized = normalizeFileTransformContentType(contentType);
  if (normalized === "image/jpeg") {
    return "jpeg";
  }
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  return "avif";
}

function outputFormat(format: FileTransformFormat): ImageOutputOptions["format"] {
  if (format === "jpeg") {
    return "image/jpeg";
  }
  return `image/${format}`;
}

function emptyBody(): ReadableStream<Uint8Array> {
  return new Response(new Uint8Array()).body as ReadableStream<Uint8Array>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
