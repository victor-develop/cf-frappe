import { badRequest } from "../core/errors.js";

export const MAX_FILE_TRANSFORM_DIMENSION = 4096;
export const FILE_TRANSFORM_FITS = ["scale-down", "contain", "cover", "crop", "pad"] as const;
export const FILE_TRANSFORM_FORMATS = ["jpeg", "png", "webp", "avif"] as const;

export type FileTransformFit = typeof FILE_TRANSFORM_FITS[number];
export type FileTransformFormat = typeof FILE_TRANSFORM_FORMATS[number];

export interface FileTransformOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fit?: FileTransformFit;
  readonly format?: FileTransformFormat;
  readonly quality?: number;
}

export interface FileTransformSource {
  readonly key: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly body: ReadableStream<Uint8Array>;
  readonly etag?: string;
  readonly httpEtag?: string;
}

export interface TransformFileObjectCommand {
  readonly actorId: string;
  readonly tenantId: string;
  readonly source: FileTransformSource;
  readonly options: FileTransformOptions;
}

export interface TransformedFileObject {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly contentLength?: number;
  readonly etag?: string;
}

export interface FileTransformer {
  transform(command: TransformFileObjectCommand): Promise<TransformedFileObject>;
}

const TRANSFORMABLE_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export function isTransformableFileContentType(contentType: string): boolean {
  return TRANSFORMABLE_IMAGE_CONTENT_TYPES.has(normalizeContentType(contentType));
}

export function normalizeFileTransformOptions(options: FileTransformOptions): FileTransformOptions {
  const normalized: FileTransformOptions = {
    ...(options.width === undefined ? {} : { width: normalizeDimension(options.width, "width") }),
    ...(options.height === undefined ? {} : { height: normalizeDimension(options.height, "height") }),
    ...(options.fit === undefined ? {} : { fit: normalizeFit(options.fit) }),
    ...(options.format === undefined ? {} : { format: normalizeFormat(options.format) }),
    ...(options.quality === undefined ? {} : { quality: normalizeQuality(options.quality) })
  };
  if (Object.keys(normalized).length === 0) {
    throw badRequest("At least one file transform option must be provided");
  }
  if (
    (normalized.fit === "cover" || normalized.fit === "crop" || normalized.fit === "pad") &&
    (normalized.width === undefined || normalized.height === undefined)
  ) {
    throw badRequest(`File transform fit '${normalized.fit}' requires width and height`);
  }
  return normalized;
}

export function normalizeFileTransformContentType(contentType: string): string {
  return normalizeContentType(contentType);
}

function normalizeDimension(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILE_TRANSFORM_DIMENSION) {
    throw badRequest(`${label} must be an integer from 1 to ${String(MAX_FILE_TRANSFORM_DIMENSION)}`);
  }
  return value;
}

function normalizeQuality(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw badRequest("quality must be an integer from 1 to 100");
  }
  return value;
}

function normalizeFit(value: string): FileTransformFit {
  if (!FILE_TRANSFORM_FITS.includes(value as FileTransformFit)) {
    throw badRequest(`fit must be one of ${FILE_TRANSFORM_FITS.join(", ")}`);
  }
  return value as FileTransformFit;
}

function normalizeFormat(value: string): FileTransformFormat {
  if (!FILE_TRANSFORM_FORMATS.includes(value as FileTransformFormat)) {
    throw badRequest(`format must be one of ${FILE_TRANSFORM_FORMATS.join(", ")}`);
  }
  return value as FileTransformFormat;
}

function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}
