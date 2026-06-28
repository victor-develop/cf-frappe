import { FrameworkError } from "./errors.js";
import { cloneJsonValue, isJsonValue } from "./json.js";
import type { DocumentData, DocumentSnapshot } from "./types.js";

export function cloneDocumentData(data: DocumentData): DocumentData {
  if (typeof data !== "object" || data === null || Array.isArray(data) || !isJsonValue(data)) {
    throw new FrameworkError("DOCUMENT_INVALID", "Document data must be a JSON object", { status: 409 });
  }
  return cloneJsonValue(data) as DocumentData;
}

export function cloneDocumentSnapshot<TSnapshot extends DocumentSnapshot>(snapshot: TSnapshot): TSnapshot {
  return {
    ...snapshot,
    data: cloneDocumentData(snapshot.data)
  };
}
