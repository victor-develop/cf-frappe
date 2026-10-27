import { isAnalyticalQueryPath, type QueryPath } from "../core/analytics.js";
import { FrameworkError, badRequest } from "../core/errors.js";
import { isCustomReport, type ReportDefinition } from "../core/reports.js";
import type { ModelRegistry } from "../core/registry.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeName,
  type DocumentData,
  type DocumentSnapshot,
  type TenantId
} from "../core/types.js";
import type {
  AnalyticsDocumentRow,
  AnalyticsExportCursor,
  AnalyticsStringEqualsPrefilter,
  ProjectionChangePosition
} from "../ports/analytics.js";
import type { ReportFilters } from "./report-policy.js";

/** What to do when an analytical read cannot be served. */
export type AnalyticsUnavailablePolicy = "fail" | "operational";

export const DEFAULT_ANALYTICS_UNAVAILABLE_POLICY: AnalyticsUnavailablePolicy = "fail";

/** Seconds a projection row must age before the exporter will take it. See {@link analyticsExportHorizon}. */
export const DEFAULT_ANALYTICS_EXPORT_SETTLE_SECONDS = 60;
export const DEFAULT_ANALYTICS_EXPORT_BATCH_SIZE = 500;
export const DEFAULT_ANALYTICS_EXPORT_MAX_ROWS_PER_RUN = 10_000;
export const DEFAULT_ANALYTICS_SCAN_PAGE_SIZE = 1_000;

export type AnalyticsQueryPathDecision =
  | { readonly status: "operational" }
  | { readonly status: "analytical" };

/**
 * Decides which store one read goes to. The analytical path needs both a
 * declaration and a configured store; either missing means the operational
 * projection, which is what keeps the whole mode off by default.
 */
export function planAnalyticsQueryPath(input: {
  readonly declared: QueryPath | undefined;
  readonly configured: boolean;
}): AnalyticsQueryPathDecision {
  return input.configured && isAnalyticalQueryPath(input.declared)
    ? { status: "analytical" }
    : { status: "operational" };
}

/**
 * Every DocType some analytical read will ask for, which is exactly the set
 * worth exporting. Report cards on a dashboard follow their report, so they are
 * already covered by the report scan.
 */
export function analyticalDocTypeNames(registry: ModelRegistry): readonly DocTypeName[] {
  const names = new Set<DocTypeName>();
  for (const report of registry.listReports()) {
    if (isAnalyticalQueryPath(report.queryPath) && !isCustomReport(report)) {
      names.add(report.doctype);
    }
  }
  for (const dashboard of registry.listDashboards()) {
    if (!isAnalyticalQueryPath(dashboard.queryPath)) {
      continue;
    }
    for (const card of dashboard.cards) {
      if (card.source.kind === "documentCount" || card.source.kind === "documentAggregate") {
        names.add(card.source.doctype);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/**
 * The report filters that can narrow an analytics scan.
 *
 * Only an `eq` filter whose materialised value is a non-empty string qualifies.
 * The report's own matcher is `actual === expected`, so the rows it keeps are
 * exactly those whose field is that JSON string — and string equality on a
 * JSON-extracted value is true for every one of them in SQLite, in R2 SQL and
 * in memory. The pushed condition can therefore only remove rows the matcher
 * would remove anyway, which is the whole contract of a pre-filter.
 *
 * It is evaluated on the stored data while the matcher sees the redacted copy.
 * That still holds the superset: redaction removes a field or rewrites a child
 * table, and never turns one scalar into another, so a row the matcher keeps
 * carried the same string before redaction.
 *
 * Numbers and booleans are left out on purpose. SQLite's `json_extract` returns
 * JSON `true` as the integer 1, so equality on either would need per-dialect
 * type checks to stay a superset, and the saving does not justify the risk.
 */
export function reportAnalyticsPrefilters(
  report: ReportDefinition,
  filters: ReportFilters
): readonly AnalyticsStringEqualsPrefilter[] {
  const prefilters: AnalyticsStringEqualsPrefilter[] = [];
  for (const filter of report.filters ?? []) {
    const value = filters[filter.name];
    if ((filter.operator ?? "eq") !== "eq" || typeof value !== "string" || value === "") {
      continue;
    }
    prefilters.push({ field: filter.field, value });
  }
  return prefilters;
}

export function analyticsRowFromSnapshot(
  snapshot: DocumentSnapshot,
  exportedAt: string,
  exportGeneration = 0
): AnalyticsDocumentRow {
  return {
    tenantId: snapshot.tenantId,
    doctype: snapshot.doctype,
    name: snapshot.name,
    version: snapshot.version,
    docstatus: snapshot.docstatus,
    dataJson: JSON.stringify(snapshot.data),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    exportGeneration,
    exportedAt
  };
}

/** Rebuilds the snapshot an exported row was taken from. */
export function snapshotFromAnalyticsRow(
  row: Omit<AnalyticsDocumentRow, "exportedAt" | "exportGeneration">
): DocumentSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(row.dataJson);
  } catch {
    throw analyticsUnavailable(`Analytics row ${row.doctype}/${row.name} v${row.version} has unreadable data`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw analyticsUnavailable(`Analytics row ${row.doctype}/${row.name} v${row.version} data is not an object`);
  }
  return {
    tenantId: row.tenantId,
    doctype: row.doctype,
    name: row.name,
    version: row.version,
    docstatus: row.docstatus,
    data: data as DocumentData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/**
 * The newest `updatedAt` a run may export: `now` minus the settle window.
 *
 * The exporter's cursor only moves forward through `(updatedAt, name)`, so a
 * projection row that lands *behind* the cursor is never seen. `updatedAt` is
 * stamped when a command is planned and the row becomes visible when its
 * commit lands, so a row can appear slightly in the past. Not exporting
 * anything younger than the window means the cursor is never ahead of a commit
 * that is still in flight, as long as commits take less than the window — and
 * a D1 commit takes milliseconds against a default of 60 seconds.
 *
 * What this does not cover, stated so nobody relies on it: a projection row
 * rewritten *without* a new `updatedAt` — a full rebuild (#11) or a repair after
 * a rebuild-diff (#12). Those need {@link AnalyticsExportCursorStore.reset} on
 * the affected DocType, which re-exports it; see `docs/analytics.md`.
 */
export function analyticsExportHorizon(now: string, settleSeconds: number): string {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw badRequest(`Analytics export clock returned an invalid time '${now}'`);
  }
  return new Date(nowMs - settleSeconds * 1000).toISOString();
}

export function analyticsExportSettleSeconds(value: number | undefined): number {
  const seconds = value ?? DEFAULT_ANALYTICS_EXPORT_SETTLE_SECONDS;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw badRequest("Analytics export settleSeconds must be a non-negative number");
  }
  return seconds;
}

export function analyticsPositiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return resolved;
}

export function emptyAnalyticsExportCursor(tenantId: TenantId, doctype: DocTypeName): AnalyticsExportCursor {
  return {
    tenantId,
    doctype,
    position: null,
    completeThrough: null,
    pendingThrough: null,
    pendingVisibleAt: null,
    generation: 0,
    reexporting: false,
    exportedRows: 0,
    lastRunAt: null,
    lastError: null
  };
}

export function analyticsChangePosition(snapshot: DocumentSnapshot): ProjectionChangePosition {
  return { updatedAt: snapshot.updatedAt, name: snapshot.name };
}

/**
 * The later of two `completeThrough` marks. A horizon computed from a clock
 * that stepped backwards must not make the freshness claim go backwards with it.
 */
export function laterCompleteThrough(current: string | null, next: string): string {
  return current === null || next > current ? next : current;
}

/**
 * Seconds a sink needs before appended rows can be read; see
 * `AnalyticsSink.visibleAfterSeconds`. Omitted means visible on append.
 */
export function analyticsSinkVisibleAfterSeconds(value: number | undefined): number {
  const seconds = value ?? 0;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw badRequest("Analytics sink visibleAfterSeconds must be a non-negative number");
  }
  return seconds;
}

/**
 * `now` plus a number of seconds, as an ISO timestamp. Used for
 * `pendingVisibleAt`, which is compared as a string like every other time here.
 */
export function analyticsSecondsAfter(now: string, seconds: number): string {
  return new Date(Date.parse(now) + seconds * 1000).toISOString();
}

/**
 * The freshness claim as of `now`: `completeThrough`, or the pending horizon if
 * its rows have become visible since. Every reader of the claim — the query
 * path's first-export guard, the analytics metadata on a result, the status
 * endpoint, the job result — goes through this, so none of them can vouch for
 * rows a sink has accepted but not yet made readable.
 */
export function analyticsVisibleCompleteThrough(cursor: AnalyticsExportCursor, now: string): string | null {
  if (cursor.pendingThrough !== null && cursor.pendingVisibleAt !== null && cursor.pendingVisibleAt <= now) {
    return laterCompleteThrough(cursor.completeThrough, cursor.pendingThrough);
  }
  return cursor.completeThrough;
}

/**
 * Folds a drained run's horizon into the cursor.
 *
 * With a sink that shows rows on append the horizon is the claim straight
 * away. Otherwise it is held as pending until `now + visibleAfterSeconds`. A
 * pending horizon that is still not visible is kept rather than replaced: the
 * one behind it would be pushed back by every run and, with runs more frequent
 * than the visibility delay, would never become visible at all. The newer
 * horizon is picked up by the first drained run after the pending one lands.
 */
export function advanceAnalyticsCompleteThrough(
  cursor: AnalyticsExportCursor,
  input: { readonly now: string; readonly drainedHorizon: string | null; readonly visibleAfterSeconds: number }
): AnalyticsExportCursor {
  const settled = settleAnalyticsPending(cursor, input.now);
  if (input.drainedHorizon === null) {
    return settled;
  }
  if (input.visibleAfterSeconds === 0) {
    return { ...settled, completeThrough: laterCompleteThrough(settled.completeThrough, input.drainedHorizon) };
  }
  if (settled.pendingThrough !== null) {
    return settled;
  }
  return {
    ...settled,
    pendingThrough: input.drainedHorizon,
    pendingVisibleAt: analyticsSecondsAfter(input.now, input.visibleAfterSeconds)
  };
}

function settleAnalyticsPending(cursor: AnalyticsExportCursor, now: string): AnalyticsExportCursor {
  if (cursor.pendingThrough === null || cursor.pendingVisibleAt === null || cursor.pendingVisibleAt > now) {
    return cursor;
  }
  return {
    ...cursor,
    completeThrough: laterCompleteThrough(cursor.completeThrough, cursor.pendingThrough),
    pendingThrough: null,
    pendingVisibleAt: null
  };
}

/** Seconds between `completeThrough` and `now`; `null` when nothing has been fully exported yet. */
export function analyticsLagSeconds(completeThrough: string | null, now: string): number | null {
  if (completeThrough === null) {
    return null;
  }
  const lag = (Date.parse(now) - Date.parse(completeThrough)) / 1000;
  return Number.isFinite(lag) ? Math.max(0, lag) : null;
}

export function analyticsActorTenant(actor: Actor): TenantId {
  return actor.tenantId ?? DEFAULT_TENANT_ID;
}

export function analyticsUnavailable(message: string): FrameworkError {
  return new FrameworkError("ANALYTICS_UNAVAILABLE", message, { status: 503 });
}

export function isAnalyticsUnavailableError(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "ANALYTICS_UNAVAILABLE";
}

export function analyticsErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type AnalyticsAdminAccessDecision =
  | { readonly status: "allow"; readonly tenantId: TenantId }
  | { readonly status: "deny"; readonly message: string };

export function planAnalyticsAdminAccess(input: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
}): AnalyticsAdminAccessDecision {
  if (input.adminRoles.some((role) => input.actor.roles.includes(role))) {
    return { status: "allow", tenantId: analyticsActorTenant(input.actor) };
  }
  return { status: "deny", message: `Actor '${input.actor.id}' cannot inspect analytics exports` };
}
