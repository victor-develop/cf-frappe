import { badRequest, permissionDenied } from "../core/errors.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { ModelRegistry } from "../core/registry.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type DocTypeName, type DocumentData, type TenantId } from "../core/types.js";
import type {
  AnalyticsExportCursor,
  AnalyticsExportCursorStore,
  AnalyticsSink,
  ProjectionChangeFeed
} from "../ports/analytics.js";
import { systemClock, type Clock } from "../ports/clock.js";
import {
  advanceAnalyticsCompleteThrough,
  analyticalDocTypeNames,
  analyticsChangePosition,
  analyticsErrorMessage,
  analyticsExportHorizon,
  analyticsExportSettleSeconds,
  analyticsLagSeconds,
  analyticsPositiveInteger,
  analyticsRowFromSnapshot,
  analyticsSinkVisibleAfterSeconds,
  analyticsVisibleCompleteThrough,
  DEFAULT_ANALYTICS_EXPORT_BATCH_SIZE,
  DEFAULT_ANALYTICS_EXPORT_MAX_ROWS_PER_RUN,
  emptyAnalyticsExportCursor,
  planAnalyticsAdminAccess
} from "./analytics-policy.js";
import { permanentJobError, retryableJobError } from "./job-errors.js";

export const ANALYTICS_EXPORT_JOB_NAME = "cf-frappe.analytics.export";

export interface AnalyticsExportServiceOptions {
  readonly registry: ModelRegistry;
  /** The operational projection, read in change order. */
  readonly feed: ProjectionChangeFeed;
  readonly sink: AnalyticsSink;
  readonly cursors: AnalyticsExportCursorStore;
  readonly clock?: Clock;
  /** See `analyticsExportHorizon`. Defaults to 60. */
  readonly settleSeconds?: number;
  /** Rows per projection read and per sink append. Defaults to 500. */
  readonly batchSize?: number;
  /**
   * Most rows one run exports per DocType. A run that reaches it stops, saves
   * its position, and leaves `completeThrough` where it was, so a backlog shows
   * up as lag rather than as a run that never ends. Defaults to 10,000.
   */
  readonly maxRowsPerRun?: number;
  /**
   * DocTypes to export. Defaults to every DocType an analytical report or
   * dashboard reads, which is the only set anything will ask the copy for.
   */
  readonly doctypes?: readonly DocTypeName[];
  readonly adminRoles?: readonly string[];
}

export interface AnalyticsExportCommand {
  readonly tenantId: TenantId;
  /** Narrows the run to these DocTypes; must be a subset of the exported set. */
  readonly doctypes?: readonly DocTypeName[];
}

export interface AnalyticsDocTypeExportResult {
  readonly doctype: DocTypeName;
  /**
   * `superseded` means a reset landed while this run was exporting: the run
   * stopped without saving, and the next run starts the new generation.
   */
  readonly status: "exported" | "failed" | "superseded";
  readonly exported: number;
  /** Whether the run reached its horizon; `false` means it stopped at `maxRowsPerRun`. */
  readonly drained: boolean;
  readonly completeThrough: string | null;
  readonly lagSeconds: number | null;
  readonly error?: string;
}

export interface AnalyticsExportRunResult {
  readonly tenantId: TenantId;
  readonly horizon: string;
  readonly doctypes: readonly AnalyticsDocTypeExportResult[];
  readonly exported: number;
  readonly failed: number;
}

export interface AnalyticsExportStatus {
  readonly doctype: DocTypeName;
  readonly completeThrough: string | null;
  readonly lagSeconds: number | null;
  /** A reset's re-export has not drained yet; the copy can still show rows from before it. */
  readonly reexporting: boolean;
  readonly exportedRows: number;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

/**
 * Copies the operational projection into the analytics store (issue #16).
 *
 * It reads `cf_frappe_documents` — the projection the write path already
 * maintains — and adds nothing to the write path: no hook, no outbox target, no
 * extra statement per command. That is the property T4 is allowed to be built
 * on, and an outbox target would have broken it at four events per write.
 *
 * Per tenant and DocType, a cursor walks the projection in `(updatedAt, name)`
 * order up to a horizon (`now` minus the settle window), appending each batch
 * to the sink and then saving the position. A crash between those two steps
 * re-appends the batch next run, which the sink absorbs (rows are keyed by
 * version and export generation). `completeThrough` advances to the horizon
 * only when a run drains everything below it, and — for a sink that shows rows
 * some time after accepting them — only once that time has passed.
 *
 * One DocType failing does not stop the others, and is recorded on its cursor
 * as `lastError` — that, and the lag, are what `status` reports.
 */
export class AnalyticsExportService {
  private readonly registry: ModelRegistry;
  private readonly feed: ProjectionChangeFeed;
  private readonly sink: AnalyticsSink;
  private readonly cursors: AnalyticsExportCursorStore;
  private readonly clock: Clock;
  private readonly settleSeconds: number;
  private readonly visibleAfterSeconds: number;
  private readonly batchSize: number;
  private readonly maxRowsPerRun: number;
  private readonly configuredDoctypes: readonly DocTypeName[] | undefined;
  private readonly adminRoles: readonly string[];

  constructor(options: AnalyticsExportServiceOptions) {
    this.registry = options.registry;
    this.feed = options.feed;
    this.sink = options.sink;
    this.cursors = options.cursors;
    this.clock = options.clock ?? systemClock;
    this.settleSeconds = analyticsExportSettleSeconds(options.settleSeconds);
    this.visibleAfterSeconds = analyticsSinkVisibleAfterSeconds(options.sink.visibleAfterSeconds);
    this.batchSize = analyticsPositiveInteger(options.batchSize, DEFAULT_ANALYTICS_EXPORT_BATCH_SIZE, "Analytics export batchSize");
    this.maxRowsPerRun = analyticsPositiveInteger(
      options.maxRowsPerRun,
      DEFAULT_ANALYTICS_EXPORT_MAX_ROWS_PER_RUN,
      "Analytics export maxRowsPerRun"
    );
    this.configuredDoctypes = options.doctypes === undefined ? undefined : [...options.doctypes];
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    for (const doctype of this.configuredDoctypes ?? []) {
      // Fails at construction, not on the first scheduled run hours later.
      this.registry.get(doctype);
    }
  }

  /** The DocTypes this service exports. */
  exportedDoctypes(): readonly DocTypeName[] {
    return this.configuredDoctypes ?? analyticalDocTypeNames(this.registry);
  }

  async exportTenant(command: AnalyticsExportCommand): Promise<AnalyticsExportRunResult> {
    const now = this.clock.now();
    const horizon = analyticsExportHorizon(now, this.settleSeconds);
    const doctypes = this.selectDoctypes(command.doctypes);
    const results: AnalyticsDocTypeExportResult[] = [];
    for (const doctype of doctypes) {
      results.push(await this.exportDocType(command.tenantId, doctype, now, horizon));
    }
    return {
      tenantId: command.tenantId,
      horizon,
      doctypes: results,
      exported: results.reduce((total, result) => total + result.exported, 0),
      failed: results.filter((result) => result.status === "failed").length
    };
  }

  /** Per DocType: how far the copy is complete and how long ago that was. */
  async status(actor: Actor): Promise<readonly AnalyticsExportStatus[]> {
    const tenantId = this.requireAdmin(actor);
    const now = this.clock.now();
    const stored = new Map((await this.cursors.list(tenantId)).map((cursor) => [cursor.doctype, cursor]));
    return this.exportedDoctypes().map((doctype) => {
      const cursor = stored.get(doctype) ?? emptyAnalyticsExportCursor(tenantId, doctype);
      const completeThrough = analyticsVisibleCompleteThrough(cursor, now);
      return {
        doctype,
        completeThrough,
        lagSeconds: analyticsLagSeconds(completeThrough, now),
        reexporting: cursor.reexporting,
        exportedRows: cursor.exportedRows,
        lastRunAt: cursor.lastRunAt,
        lastError: cursor.lastError
      };
    });
  }

  /**
   * Starts a re-export of one DocType: the next run exports it from the start,
   * in a new export generation.
   *
   * Needed after anything that rewrites projection rows without moving their
   * `updatedAt` or `version` — a full rebuild (#11) or a repair after a
   * rebuild-diff (#12). Because the rewritten rows keep their version, the
   * re-export cannot rely on version to win; its rows carry the new
   * generation, which every reader ranks above the old one. `completeThrough`
   * is kept, so analytical reads stay up while the re-export runs, and status
   * reports `reexporting` until it drains.
   */
  async reset(actor: Actor, doctype: DocTypeName): Promise<void> {
    const tenantId = this.requireAdmin(actor);
    this.selectDoctypes([doctype]);
    await this.cursors.reset(tenantId, doctype);
  }

  private async exportDocType(
    tenantId: TenantId,
    doctype: DocTypeName,
    now: string,
    horizon: string
  ): Promise<AnalyticsDocTypeExportResult> {
    let cursor: AnalyticsExportCursor = emptyAnalyticsExportCursor(tenantId, doctype);
    let exported = 0;
    try {
      cursor = (await this.cursors.get(tenantId, doctype)) ?? cursor;
      let drained = false;
      while (exported < this.maxRowsPerRun) {
        const limit = Math.min(this.batchSize, this.maxRowsPerRun - exported);
        const changes = await this.feed.listChangedSince({
          tenantId,
          doctype,
          ...(cursor.position === null ? {} : { after: cursor.position }),
          through: horizon,
          limit
        });
        const last = changes.at(-1);
        if (last === undefined) {
          drained = true;
          break;
        }
        await this.sink.append(
          changes.map((snapshot) => analyticsRowFromSnapshot(snapshot, now, cursor.generation))
        );
        exported += changes.length;
        // Saved after every batch, not once at the end: a run that dies later
        // resumes here instead of re-appending everything it already shipped.
        cursor = {
          ...cursor,
          position: analyticsChangePosition(last),
          exportedRows: cursor.exportedRows + changes.length
        };
        if (!(await this.cursors.save(cursor))) {
          return await this.superseded(tenantId, doctype, exported, now);
        }
        if (changes.length < limit) {
          drained = true;
          break;
        }
      }
      cursor = {
        ...advanceAnalyticsCompleteThrough(cursor, {
          now,
          drainedHorizon: drained ? horizon : null,
          visibleAfterSeconds: this.visibleAfterSeconds
        }),
        reexporting: drained ? false : cursor.reexporting,
        lastRunAt: now,
        lastError: null
      };
      if (!(await this.cursors.save(cursor))) {
        return await this.superseded(tenantId, doctype, exported, now);
      }
      const completeThrough = analyticsVisibleCompleteThrough(cursor, now);
      return {
        doctype,
        status: "exported",
        exported,
        drained,
        completeThrough,
        lagSeconds: analyticsLagSeconds(completeThrough, now)
      };
    } catch (error) {
      const message = analyticsErrorMessage(error);
      await this.recordFailure({ ...cursor, lastRunAt: now, lastError: message });
      const completeThrough = analyticsVisibleCompleteThrough(cursor, now);
      return {
        doctype,
        status: "failed",
        exported,
        drained: false,
        completeThrough,
        lagSeconds: analyticsLagSeconds(completeThrough, now),
        error: message
      };
    }
  }

  /**
   * A reset moved the generation under this run. Its rows already sent carry
   * the old generation, so the re-export outranks them; what is left is to stop
   * and report the cursor the reset left.
   */
  private async superseded(
    tenantId: TenantId,
    doctype: DocTypeName,
    exported: number,
    now: string
  ): Promise<AnalyticsDocTypeExportResult> {
    const tenantCursor = await this.cursors.get(tenantId, doctype);
    const completeThrough = tenantCursor === null ? null : analyticsVisibleCompleteThrough(tenantCursor, now);
    return {
      doctype,
      status: "superseded",
      exported,
      drained: false,
      completeThrough,
      lagSeconds: analyticsLagSeconds(completeThrough, now)
    };
  }

  private async recordFailure(cursor: AnalyticsExportCursor): Promise<void> {
    try {
      await this.cursors.save(cursor);
    } catch {
      // The cursor store is the thing that failed, or it failed too. The run
      // result still carries the error; there is nowhere else to record it.
    }
  }

  private selectDoctypes(requested: readonly DocTypeName[] | undefined): readonly DocTypeName[] {
    const exported = this.exportedDoctypes();
    if (requested === undefined) {
      return exported;
    }
    for (const doctype of requested) {
      if (!exported.includes(doctype)) {
        throw badRequest(`DocType '${doctype}' is not exported to analytics`);
      }
    }
    return requested;
  }

  private requireAdmin(actor: Actor): TenantId {
    const access = planAnalyticsAdminAccess({ actor, adminRoles: this.adminRoles });
    if (access.status === "deny") {
      throw permissionDenied(access.message);
    }
    return access.tenantId;
  }
}

export interface AnalyticsExportJobResources {
  readonly analyticsExports?: AnalyticsExportService;
}

export interface AnalyticsExportJobOptions {
  readonly name?: string;
}

/**
 * The job that runs one tenant's export. Schedule it per tenant, as the
 * delivery outbox drain is: `{ cron: "* * * * *", jobName: ANALYTICS_EXPORT_JOB_NAME, tenantId }`.
 *
 * A run with a failed DocType throws a retryable error after the others have
 * been exported, so the failure lands in job history and the queue retries it;
 * the DocTypes that succeeded keep their progress either way. A deployment that
 * schedules the job without configuring analytics gets a permanent failure —
 * retrying cannot fix configuration.
 */
export function createAnalyticsExportJob<
  TResources extends AnalyticsExportJobResources = AnalyticsExportJobResources
>(options: AnalyticsExportJobOptions = {}): JobDefinition<JobPayload, TResources> {
  return {
    name: options.name ?? ANALYTICS_EXPORT_JOB_NAME,
    description: "Export changed cf-frappe projection rows to the analytics store",
    retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
    async handler({ tenantId, resources }) {
      const exports = resources.analyticsExports;
      if (exports === undefined) {
        throw permanentJobError("Analytics export is not configured");
      }
      const result = await exports.exportTenant({ tenantId: tenantId ?? "default" });
      if (result.failed > 0) {
        const failures = result.doctypes
          .filter((item) => item.status === "failed")
          .map((item) => `${item.doctype}: ${item.error ?? "unknown error"}`);
        throw retryableJobError(`Analytics export failed for ${failures.join("; ")}`);
      }
      return analyticsExportRunResultJson(result);
    }
  };
}

export function analyticsExportRunResultJson(result: AnalyticsExportRunResult): DocumentData {
  return {
    tenantId: result.tenantId,
    horizon: result.horizon,
    exported: result.exported,
    failed: result.failed,
    doctypes: result.doctypes.map((item) => ({
      doctype: item.doctype,
      status: item.status,
      exported: item.exported,
      drained: item.drained,
      completeThrough: item.completeThrough,
      lagSeconds: item.lagSeconds,
      ...(item.error === undefined ? {} : { error: item.error })
    }))
  };
}
