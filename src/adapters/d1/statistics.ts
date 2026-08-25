import { FrameworkError } from "../../core/errors.js";

/**
 * Tables whose indexes carry the framework's query load, and therefore the
 * default target set for the statistics helpers.
 */
export const D1_STATISTICS_TARGETS: readonly string[] = ["cf_frappe_documents", "cf_frappe_events"];

export interface D1StatisticsTargetOptions {
  /**
   * Tables or indexes to act on, defaulting to {@link D1_STATISTICS_TARGETS}.
   * Naming individual indexes keeps each statement small enough for D1's query
   * timeout on very large tables.
   */
  readonly targets?: readonly string[];
}

export interface D1AnalyzeResult {
  /** Targets whose `ANALYZE` completed. */
  readonly analyzed: readonly string[];
}

export interface D1TableStatistic {
  readonly table: string;
  readonly index: string | null;
  readonly stat: string;
}

export interface D1StatisticsReport {
  /**
   * Whether `sqlite_stat1` exists at all. `false` means nothing has ever been
   * analyzed; `true` with an empty {@link statistics} means statistics were
   * gathered but recorded no rows for the requested targets.
   */
  readonly analyzed: boolean;
  readonly statistics: readonly D1TableStatistic[];
}

interface D1TableStatisticRow {
  readonly tbl: string;
  readonly idx: string | null;
  readonly stat: string;
}

/**
 * Refreshes the query planner's statistics by running `ANALYZE` per target.
 *
 * Gathering statistics is a diagnostic action, not a performance measure. On the
 * query shapes this framework emits, statistics were measured to change no plan
 * for the better and to make one shape worse; see docs/projection-indexes.md for
 * the plan matrix. The reason to reach for this is that a database already
 * carries misleading statistics — most often from an `ANALYZE` run while the
 * table was empty, which records a zero-row estimate that then costs the plain
 * unfiltered list its index. {@link clearD1Statistics} is usually the better
 * remedy for that.
 *
 * Deliberately not part of any migration: at migrate time the tables are empty,
 * which is precisely when `ANALYZE` records the harmful estimate.
 *
 * Each target runs as its own statement. If one fails, the targets before it
 * keep their refreshed statistics and the targets after it are skipped; the
 * failure carries the completed list so the caller can resume.
 */
export async function analyzeD1Statistics(
  db: D1Database,
  options: D1StatisticsTargetOptions = {}
): Promise<D1AnalyzeResult> {
  const targets = assertD1StatisticsTargets(options.targets);
  const analyzed: string[] = [];
  for (const target of targets) {
    try {
      await db.prepare(`ANALYZE ${target};`).run();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new FrameworkError(
        "D1_ANALYZE_FAILED",
        `D1 analyze failed on target '${target}' after completing [${analyzed.join(", ")}]: ${reason}`,
        { status: 500 }
      );
    }
    analyzed.push(target);
  }
  return { analyzed };
}

/**
 * Drops recorded statistics so the planner falls back to its built-in estimates.
 * This is the remedy when a database carries statistics gathered against an
 * empty or wildly different data volume.
 */
export async function clearD1Statistics(db: D1Database): Promise<void> {
  const report = await readD1Statistics(db);
  if (!report.analyzed) {
    return;
  }
  await db.prepare("DELETE FROM sqlite_stat1").run();
}

/**
 * Reads the planner statistics currently recorded for the requested targets, and
 * reports separately whether any statistics exist at all — a database that was
 * never analyzed and one that was analyzed without producing rows for these
 * targets need different responses.
 */
export async function readD1Statistics(
  db: D1Database,
  options: D1StatisticsTargetOptions = {}
): Promise<D1StatisticsReport> {
  const targets = assertD1StatisticsTargets(options.targets);
  const present = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'")
    .all<{ readonly name: string }>();
  if ((present.results ?? []).length === 0) {
    return { analyzed: false, statistics: [] };
  }
  const placeholders = targets.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT tbl, idx, stat
       FROM sqlite_stat1
       WHERE tbl IN (${placeholders}) OR idx IN (${placeholders})
       ORDER BY tbl ASC, idx ASC`
    )
    .bind(...targets, ...targets)
    .all<D1TableStatisticRow>();
  return {
    analyzed: true,
    statistics: (result.results ?? []).map((row) => ({
      table: row.tbl,
      index: row.idx,
      stat: row.stat
    }))
  };
}

function assertD1StatisticsTargets(targets: readonly string[] | undefined): readonly string[] {
  const resolved = targets ?? D1_STATISTICS_TARGETS;
  if (resolved.length === 0) {
    throw new FrameworkError("D1_ANALYZE_TARGETS_EMPTY", "D1 statistics require at least one target", {
      status: 400
    });
  }
  for (const target of resolved) {
    // ANALYZE takes no bound parameters, so the target is interpolated and must
    // be a plain SQL identifier of a sane length.
    if (target.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
      throw new FrameworkError("D1_ANALYZE_TARGET_INVALID", `Invalid D1 statistics target: '${target}'`, {
        status: 400
      });
    }
  }
  return resolved;
}
