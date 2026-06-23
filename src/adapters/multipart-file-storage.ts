import { badRequest } from "../core/errors.js";
import {
  isValidMultipartFilePartNumber,
  MIN_MULTIPART_FILE_PART_BYTES,
  type UploadedMultipartFilePart
} from "../ports/file-storage.js";

export function ensureMultipartPartNumber(partNumber: number): void {
  if (!isValidMultipartFilePartNumber(partNumber)) {
    throw badRequest("Multipart upload partNumber must be an integer from 1 to 10000");
  }
}

export function sortedUploadedMultipartParts(
  parts: readonly UploadedMultipartFilePart[]
): readonly UploadedMultipartFilePart[] {
  if (parts.length === 0) {
    throw badRequest("At least one multipart upload part is required");
  }
  const completedParts = new Set<number>();
  for (const part of parts) {
    ensureMultipartPartNumber(part.partNumber);
    if (completedParts.has(part.partNumber)) {
      throw badRequest(`Multipart upload part ${String(part.partNumber)} was provided more than once`);
    }
    completedParts.add(part.partNumber);
  }
  return [...parts].sort((left, right) => left.partNumber - right.partNumber);
}

export function ensureR2CompatibleMultipartPartSizes(partSizes: readonly number[]): void {
  if (partSizes.length <= 1) {
    return;
  }
  const nonFinalPartSizes = partSizes.slice(0, -1);
  const expectedPartSize = nonFinalPartSizes[0] ?? 0;
  for (const size of nonFinalPartSizes) {
    if (size < MIN_MULTIPART_FILE_PART_BYTES) {
      throw badRequest(
        `Multipart upload parts before the final part must be at least ${String(MIN_MULTIPART_FILE_PART_BYTES)} bytes`
      );
    }
    if (size !== expectedPartSize) {
      throw badRequest("Multipart upload parts before the final part must be the same size");
    }
  }
}
