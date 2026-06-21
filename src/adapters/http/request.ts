import { badRequest } from "../../core/errors";
import type { DocumentData } from "../../core/types";

export function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest("Expected integer query parameter");
  }
  return parsed;
}

export function requestMetadata(request: Request): DocumentData {
  return {
    method: request.method,
    url: request.url
  };
}

export async function readBoundedText(request: Request, maxBytes: number, errorMessage: string): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBytes, errorMessage);
  return new TextDecoder().decode(bytes);
}

export async function readBoundedBytes(
  request: Request,
  maxBytes: number,
  errorMessage: string
): Promise<ArrayBuffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw badRequest(errorMessage);
  }
  if (!request.body) {
    return new ArrayBuffer(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw badRequest(errorMessage);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
