import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../core/types.js";

export interface ProjectionStore {
  get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null>;
  save(snapshot: DocumentSnapshot): Promise<void>;
  /** Removes one derived row. Implementations must scope the delete by key. */
  remove?(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<void>;
  list(query: ListDocumentsQuery): Promise<ListDocumentsResult>;
}

/**
 * Writes projection rows that may arrive late, twice, or out of order.
 *
 * `ProjectionStore.save` overwrites, which is right when the writer is the
 * commit itself: commits on a stream are serialized by its version, so the
 * last write is the newest. A projection fed from a delivery outbox has no such
 * ordering — a retried delivery can land after a newer one, and a backfill can
 * fold a stream just before a delivery moves it on. This keeps whichever row
 * has the higher version, so every one of those writers can run concurrently
 * and the result is still the newest state.
 *
 * An equal version overwrites rather than being skipped: the same version folds
 * to the same row, so that is a no-op for deliveries, and it lets a rebuild with
 * corrected fold logic repair a row without bumping anything.
 */
export interface MonotonicProjectionWriter {
  saveNewest(snapshots: readonly DocumentSnapshot[]): Promise<void>;
}

export function isMonotonicProjectionWriter(value: unknown): value is MonotonicProjectionWriter {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly saveNewest?: unknown }).saveNewest === "function";
}

/** A document a {@link ProjectionVersionReader} is asked about. */
export interface ProjectionDocumentRef {
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
}

/**
 * Reads the stored version of many projection rows at once.
 *
 * For a reader that polls — read-your-writes waiting for a projection to catch
 * up — where one point read per document per poll would spend a Worker's whole
 * D1 query budget on the wait. One call is one query however many documents it
 * names.
 */
export interface ProjectionVersionReader {
  /** The version of each row, in the order asked, or null for a row that does not exist. */
  versions(tenantId: TenantId, refs: readonly ProjectionDocumentRef[]): Promise<readonly (number | null)[]>;
}
