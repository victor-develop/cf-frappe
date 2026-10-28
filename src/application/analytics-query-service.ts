import { matchesPredicateExpression } from "../core/list-view.js";
import type { Actor, DocTypeName, DocumentSnapshot, PredicateExpression } from "../core/types.js";
import type {
  AnalyticsDocumentReader,
  AnalyticsExportCursorStore,
  AnalyticsStringEqualsPrefilter
} from "../ports/analytics.js";
import { systemClock, type Clock } from "../ports/clock.js";
import {
  analyticsActorTenant,
  analyticsErrorMessage,
  analyticsPositiveInteger,
  analyticsUnavailable,
  analyticsVisibleCompleteThrough,
  DEFAULT_ANALYTICS_SCAN_PAGE_SIZE,
  DEFAULT_ANALYTICS_UNAVAILABLE_POLICY,
  isAnalyticsUnavailableError,
  type AnalyticsUnavailablePolicy
} from "./analytics-policy.js";
import type { QueryService } from "./query-service.js";

export interface AnalyticsQueryServiceOptions {
  readonly reader: AnalyticsDocumentReader;
  readonly queries: QueryService;
  /**
   * The export cursors. When present, a DocType whose first export has not
   * finished is refused instead of being answered from an empty copy — an empty
   * report is indistinguishable from a real zero, which is the wrong failure.
   */
  readonly cursors?: AnalyticsExportCursorStore;
  /** Decides whether a pending export has become visible; see `analyticsVisibleCompleteThrough`. */
  readonly clock?: Clock;
  readonly pageSize?: number;
  /** See {@link AnalyticsUnavailablePolicy}. Defaults to `"fail"`. */
  readonly onUnavailable?: AnalyticsUnavailablePolicy;
}

export interface AnalyticsReadOptions {
  readonly prefilters?: readonly AnalyticsStringEqualsPrefilter[];
  /**
   * Applied to the stored document before access is checked — the same point
   * the operational list applies it, since there it is SQL on the projection
   * row. Used by dashboard document cards.
   */
  readonly predicate?: PredicateExpression;
}

/** Where a result came from and how fresh it is. Present only on analytical results. */
export interface AnalyticsResultMetadata {
  readonly path: "analytical";
  /**
   * Every projection change at or before this time is visible in the copy that
   * answered. `null` when no cursor store is wired, so nothing vouches for it.
   */
  readonly completeThrough: string | null;
}

export interface AnalyticsReadResult {
  /** Readable, redacted documents, newest `updatedAt` first — the operational list's default order. */
  readonly documents: readonly DocumentSnapshot[];
  readonly analytics: AnalyticsResultMetadata;
}

/**
 * Reads documents from the analytics copy for one actor (issue #16).
 *
 * The analytics store only replaces *where rows come from*. Everything that
 * decides what the actor may see — row-level permissions, shares, user
 * permissions, field redaction — runs through {@link QueryService} exactly as
 * it does for a list, and everything that turns rows into a report runs through
 * the same report code. That is why an analytical report agrees with its
 * operational run on the same data by construction, rather than by a second
 * implementation of the semantics in SQL.
 *
 * The price is that aggregation happens in the Worker, not in R2 SQL: the
 * report code compares with `localeCompare`, which no SQL engine reproduces,
 * and pushing `GROUP BY` down would make the two paths disagree on ordering and
 * mixed-type keys. What moves off D1 is the scan, which is the load that drags
 * the Desk down. See `docs/analytics.md`.
 */
export class AnalyticsQueryService {
  private readonly reader: AnalyticsDocumentReader;
  private readonly queries: QueryService;
  private readonly cursors: AnalyticsExportCursorStore | undefined;
  private readonly clock: Clock;
  private readonly pageSize: number;
  readonly onUnavailable: AnalyticsUnavailablePolicy;

  constructor(options: AnalyticsQueryServiceOptions) {
    this.reader = options.reader;
    this.queries = options.queries;
    this.cursors = options.cursors;
    this.clock = options.clock ?? systemClock;
    this.pageSize = analyticsPositiveInteger(options.pageSize, DEFAULT_ANALYTICS_SCAN_PAGE_SIZE, "Analytics scan pageSize");
    this.onUnavailable = options.onUnavailable ?? DEFAULT_ANALYTICS_UNAVAILABLE_POLICY;
  }

  /**
   * Readable documents of one DocType from the analytics copy.
   *
   * Any failure of the analytics store — the reader, the freshness lookup, a
   * malformed row — surfaces as `ANALYTICS_UNAVAILABLE` (503), and nothing on
   * this path touches the operational projection. Access errors from the actor's
   * own permissions are not wrapped: those are the caller's answer, not an
   * outage.
   */
  async readableDocuments(
    actor: Actor,
    doctype: DocTypeName,
    options: AnalyticsReadOptions = {}
  ): Promise<AnalyticsReadResult> {
    const tenantId = analyticsActorTenant(actor);
    // Access to the DocType is checked before the analytics store is touched,
    // so an actor who cannot read it gets the same denial on either path.
    await this.queries.queryDocTypeFor(actor, doctype, tenantId);
    const completeThrough = await this.completeThrough(tenantId, doctype);
    const stored = await this.scanAll(tenantId, doctype, options.prefilters ?? []);
    const matching = options.predicate === undefined
      ? stored
      : stored.filter((document) => matchesPredicateExpression(document, options.predicate));
    const documents = await this.queries.readableDocumentsFrom(actor, doctype, matching, { tenantId });
    return {
      documents,
      analytics: { path: "analytical", completeThrough }
    };
  }

  private async completeThrough(tenantId: string, doctype: DocTypeName): Promise<string | null> {
    if (this.cursors === undefined) {
      // Without the cursor store there is nothing to vouch for the copy; the
      // deployment chose to trust the reader alone. Say so rather than guess.
      return null;
    }
    let cursor;
    try {
      cursor = await this.cursors.get(tenantId, doctype);
    } catch (error) {
      throw analyticsUnavailable(
        `Analytics freshness for ${doctype} could not be read: ${analyticsErrorMessage(error)}`
      );
    }
    // Visible, not merely sent: a sink that buffers (Pipelines) has accepted
    // rows a reader cannot see yet, and a first export in that state must read
    // as unfinished, not as an empty copy.
    const completeThrough = cursor === null ? null : analyticsVisibleCompleteThrough(cursor, this.clock.now());
    if (completeThrough === null) {
      throw analyticsUnavailable(`Analytics copy of ${doctype} has not finished its first export`);
    }
    return completeThrough;
  }

  private async scanAll(
    tenantId: string,
    doctype: DocTypeName,
    prefilters: readonly AnalyticsStringEqualsPrefilter[]
  ): Promise<readonly DocumentSnapshot[]> {
    // Keyed by name: a reader that pages by offset can hand back the same
    // document twice if a new one is exported between two pages, and a report
    // must not count it twice.
    const byName = new Map<string, DocumentSnapshot>();
    let cursor: string | undefined;
    for (;;) {
      let page;
      try {
        page = await this.reader.scan({
          tenantId,
          doctype,
          ...(prefilters.length === 0 ? {} : { prefilters }),
          limit: this.pageSize,
          ...(cursor === undefined ? {} : { cursor })
        });
      } catch (error) {
        if (isAnalyticsUnavailableError(error)) {
          throw error;
        }
        throw analyticsUnavailable(`Analytics query for ${doctype} failed: ${analyticsErrorMessage(error)}`);
      }
      for (const document of page.documents) {
        // A reader hides deleted documents itself; checking again here is what
        // keeps a reader that got that wrong from putting them in a report.
        if (document.docstatus !== "deleted") {
          byName.set(document.name, document);
        }
      }
      if (page.nextCursor === undefined || page.documents.length === 0) {
        break;
      }
      if (page.nextCursor === cursor) {
        // A reader that hands back the cursor it was given would loop forever.
        throw analyticsUnavailable(`Analytics query for ${doctype} did not advance past cursor '${cursor}'`);
      }
      cursor = page.nextCursor;
    }
    return [...byName.values()].sort(compareAnalyticsDocuments);
  }
}

/**
 * Newest `updatedAt` first, then name — the operational list's default order
 * (`updatedAt desc`) with a tie-breaker it does not have. D1 returns `updatedAt`
 * ties in an unspecified order, so on ties the two paths may list rows
 * differently; everything order-independent (totals, summaries, groups, charts)
 * and every explicitly ordered report is unaffected.
 */
function compareAnalyticsDocuments(left: DocumentSnapshot, right: DocumentSnapshot): number {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt < right.updatedAt ? 1 : -1;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
