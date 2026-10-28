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
 * one row keyed `(tenantId, doctype, name, version, exportGeneration)`, and a
 * reader takes, per name, the row with the highest version, then the highest
 * export generation, then the latest `exportedAt`. Three properties follow, and
 * all are load-bearing:
 *
 * - **Exports are idempotent.** Appending a row that is already there changes
 *   nothing a reader can see, so the exporter is at-least-once without a
 *   deduplication step: a run that crashes between appending a batch and saving
 *   its cursor simply appends the batch again. Cloudflare Pipelines does not
 *   document exactly-once delivery, so nothing here may assume it.
 * - **A re-export wins over the export it replaces.** A rebuild (#11) or repair
 *   (#12) rewrites a projection row's `data` without moving its `version`,
 *   because it folds the same events. Version alone cannot tell the corrected
 *   row from the stale one, so a reset bumps the DocType's export generation
 *   and every row the re-export appends outranks the rows before it — in every
 *   adapter, whatever order the engine happens to hold duplicates in.
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
  /**
   * The DocType's export generation when this row was exported. Starts at 0 and
   * goes up by one on every reset; see {@link AnalyticsExportCursor.generation}.
   */
  readonly exportGeneration: number;
  /**
   * When the exporter wrote this row. The last tie-breaker only: two rows of the
   * same version and generation carry the same data unless the projection was
   * rewritten in place without a reset, and then the later export wins.
   */
  readonly exportedAt: string;
}

/** Where exported rows go: Cloudflare Pipelines into an R2 Iceberg table, a second D1, or memory. */
export interface AnalyticsSink {
  /**
   * Seconds between `append` resolving and the rows being visible to a reader.
   * Omitted means 0: the D1 and in-memory stores show a row as soon as the
   * append commits. Pipelines buffers records and writes them into the Iceberg
   * table only when its sink rolls a file, so its sink sets this to the roll
   * interval plus a margin. The exporter only vouches for rows once this much
   * time has passed since they were sent.
   */
  readonly visibleAfterSeconds?: number;
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
 * reader can rely on: every projection row with `updatedAt` at or before it is
 * visible in the copy. It only moves when a run drains everything up to its
 * horizon, which is what makes it the honest freshness figure — `position`
 * alone can sit just behind a backlog the run ran out of budget for.
 *
 * For a sink whose rows become visible some time after `append` resolves
 * (`visibleAfterSeconds`), a drained horizon is first held as `pendingThrough`
 * with the time it becomes visible, `pendingVisibleAt`, and only counts once
 * that time has passed — see `analyticsVisibleCompleteThrough`, which is what
 * every reader of the claim goes through.
 */
export interface AnalyticsExportCursor {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly position: ProjectionChangePosition | null;
  readonly completeThrough: string | null;
  /** A drained horizon sent to the sink but not visible in the copy yet. */
  readonly pendingThrough: string | null;
  /** When `pendingThrough` becomes visible, and so becomes part of the claim. */
  readonly pendingVisibleAt: string | null;
  /**
   * Starts at 0; a reset adds one. Rows are stamped with it, so a re-export
   * outranks what it replaces, and a save carrying an older generation is
   * refused, so a run still in flight when the reset landed cannot undo it.
   */
  readonly generation: number;
  /** Set by a reset, cleared by the first run of the new generation that drains. */
  readonly reexporting: boolean;
  readonly exportedRows: number;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

export interface AnalyticsExportCursorStore {
  get(tenantId: TenantId, doctype: DocTypeName): Promise<AnalyticsExportCursor | null>;
  list(tenantId: TenantId): Promise<readonly AnalyticsExportCursor[]>;
  /**
   * Upserts the cursor, unless the stored one has a different `generation` —
   * then nothing is written and this resolves `false`. That is how a reset
   * survives a run that read the cursor before it: the run's later saves are
   * refused instead of putting its old position back.
   *
   * `completeThrough` never moves backwards, whichever of two overlapping runs
   * saves last.
   */
  save(cursor: AnalyticsExportCursor): Promise<boolean>;
  /**
   * Starts a re-export: adds one to `generation`, clears `position` so the next
   * run starts from the beginning, and sets `reexporting`. `completeThrough` is
   * kept, so analytical reads keep being served while the re-export runs.
   */
  reset(tenantId: TenantId, doctype: DocTypeName): Promise<void>;
}
