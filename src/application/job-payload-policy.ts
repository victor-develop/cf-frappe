import { badRequest } from "../core/errors.js";
import type { JobHandlerResult } from "../core/jobs.js";
import { cloneJsonValue, isJsonValue } from "../core/json.js";
import type { DocumentData, JsonValue } from "../core/types.js";

export function normalizeJobDocumentData(value: DocumentData, label: string): DocumentData {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw badRequest(`${label} must be a JSON object`);
  }
  return cloneJsonValue(value) as DocumentData;
}

export function normalizeJobHandlerResult(value: JobHandlerResult): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonValue(value)) {
    throw badRequest("Job result must be JSON-serializable");
  }
  return value;
}
