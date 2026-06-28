import { badRequest } from "../core/errors.js";
import { isJsonValue } from "../core/json.js";
import type { DocumentData } from "../core/types.js";

export function normalizeJobDocumentData(value: DocumentData, label: string): DocumentData {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw badRequest(`${label} must be a JSON object`);
  }
  return value;
}
