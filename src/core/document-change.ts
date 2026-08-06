import type {
  DocumentChangeContext,
  DocumentFieldChange,
  DocumentSnapshot,
  JsonValue
} from "./types.js";
import { jsonValuesEqual } from "./predicates.js";

export function documentChangeContext(
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null,
  touchedFields?: readonly string[]
): DocumentChangeContext {
  const candidateFields = uniqueSorted([
    ...Object.keys(before?.data ?? {}),
    ...Object.keys(after?.data ?? {})
  ]);
  const normalizedTouched = touchedFields === undefined ? candidateFields : uniqueSorted(touchedFields);
  const changes: Record<string, DocumentFieldChange> = {};
  for (const field of candidateFields) {
    const previous = before?.data[field];
    const next = after?.data[field];
    if (!jsonValuesEqual(previous, next)) {
      changes[field] = Object.freeze({ before: previous, after: next });
    }
  }
  return Object.freeze({
    before,
    after,
    touchedFields: Object.freeze(normalizedTouched),
    changedFields: Object.freeze(Object.keys(changes).sort()),
    changes: Object.freeze(changes)
  });
}

export function changedDocumentValue(
  context: DocumentChangeContext,
  field: string
): { readonly before: JsonValue | undefined; readonly after: JsonValue | undefined } | undefined {
  return context.changes[field];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
