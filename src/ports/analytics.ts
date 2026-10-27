import type {
  DocStatus,
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  TenantId
} from "../core/types.js";

/**
 * The analytics side of issue #16: a copy of the document projection, exported
 * out of D1 so that reports and dashboards which aggregate over a whole DocType
 * stop scanning the single-writer database that serves the Desk.
 *
 * The copy is **append-only and versioned**. Every export of a document appends
 * one row keyed `(tenantId, doctype, name, version)`, and a reader takes the
 * highest version per name. Two properties follow, and both are load-bearing:
 *
 * - **Exports are idempotent.** Appending a row that is already there changes
 *   nothing a reader can see, so the exporter is at-least-once without a
 *   deduplication step: a run that crashes between appending a batch and saving
 *   its cursor simply appends the batch again. Cloudflare Pipelines does not
 *   document exactly-once delivery, so nothing here may assume it.
 * - **Deletion is a row, not an absence.** A deleted document is exported with
 *   `docstatus: "deleted"` and the reader hides it *after* choosing the newest
 *   version. Filtering before that choice would resurrect the version before the
 *   delete.
 *
 * Events stay in D1 and are never touched: this exports the projection — the
 * cache — not the stream, which is the asset.
 */
export interface AnalyticsDocumentRow {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  /** The projection's `data`, serialised. Kept as one JSON column on purpose: see `docs/analytics.md`. */
  readonly dataJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When the exporter wrote this row. Diagnostic only; readers never order by it. */
  readonly exportedAt: string;
}

/** Where exported rows go: Cloudflare Pipelines into an R2 Iceberg table, a second D1, or memory. */
export interface AnalyticsSink {
  /**
   * Appends rows. Must be safe to call twice with the same rows, and must either
   * accept the whole batch or throw — the exporter only advances its cursor once
   * this resolves.
   */
  append(rows: readonly AnalyticsDocumentRow[]): Promise<void>;
}

/**
 * A narrowing condition the reader may push into its query.
 *
 * It is a **pre-filter, not the filter**: the caller re-applies its own exact
 * filter to every row that comes back. So an adapter may ignore any pre-filter
 * it cannot express, and the only rule it must keep is that it never drops a
 * row the exact filter would have kept. String equality on a top-level data
 * field is the one shape that is a guaranteed superset in every dialect here,
 * which is why it is the only shape there is.
 */
export interface AnalyticsStringEqualsPrefilter {
  readonly field: string;
  readonly value: string;
}

export interface AnalyticsDocumentScanQuery {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly prefilters?: readonly AnalyticsStringEqualsPrefilter[];
  /** Rows per page. Adapters may clamp it to what their engine allows. */
  readonly limit: number;
  /** Opaque token from the previous page's `nextCursor`. */
  readonly cursor?: string;
}

export interface AnalyticsDocumentScanPage {
  /** The newest exported version of each live document, ordered by name. */
  readonly documents: readonly DocumentSnapshot[];
  /** Present when there may be more rows. */
  readonly nextCursor?: string;
}

/**
 * Reads the analytics copy: per document, the highest exported version, with
 * deleted documents left out *after* that choice. See {@link AnalyticsDocumentRow}.
 */
export interface AnalyticsDocumentReader {
  scan(query: AnalyticsDocumentScanQuery): Promise<AnalyticsDocumentScanPage>;
}

/** A position in the projection's change order: `(updatedAt, name)` within one tenant and DocType. */
export interface ProjectionChangePosition {
  readonly updatedAt: string;
  readonly name: DocumentName;
}

export interface ProjectionChangeQuery {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  /** Exclusive lower bound. Omitted means from the beginning. */
  readonly after?: ProjectionChangePosition;
  /** Inclusive upper bound on `updatedAt`: rows newer than this are not returned yet. */
  readonly through: string;
  readonly limit: number;
}

/**
 * The projection rows of one tenant and DocType in `(updatedAt, name)` order —
 * the exporter's read of the operational projection.
 *
 * A separate port rather than a `ProjectionStore.list` call because the list
 * ordering has no tie-breaker on `updatedAt` (D1 returns ties in whatever order
 * it likes), and a resumable cursor needs a total order.
 */
export interface ProjectionChangeFeed {
  listChangedSince(query: ProjectionChangeQuery): Promise<readonly DocumentSnapshot[]>;
}

/**
 * How far one tenant's DocType has been exported.
 *
 * `position` is where the next run resumes. `completeThrough` is the claim a
 * reader can rely on: every projection row with `updatedAt` at or before it has
 * been appended to the sink. It only moves when a run drains everything up to
 * its horizon, which is what makes it the honest freshness figure — `position`
 * alone can sit just behind a backlog the run ran out of budget for.
 */
export interface AnalyticsExportCursor {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly position: ProjectionChangePosition | null;
  readonly completeThrough: string | null;
  readonly exportedRows: number;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

export interface AnalyticsExportCursorStore {
  get(tenantId: TenantId, doctype: DocTypeName): Promise<AnalyticsExportCursor | null>;
  list(tenantId: TenantId): Promise<readonly AnalyticsExportCursor[]>;
  save(cursor: AnalyticsExportCursor): Promise<void>;
  /** Forgets the cursor so the next run exports the DocType from the start. */
  reset(tenantId: TenantId, doctype: DocTypeName): Promise<void>;
}
