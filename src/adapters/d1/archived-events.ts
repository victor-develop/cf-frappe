import { FrameworkError } from "../../core/errors.js";
import { documentStream } from "../../core/streams.js";
import type { DomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery } from "../../ports/audit-event-store.js";
import type { ColdEventReadMetrics, ColdEventReadObserver, ColdEventStorage } from "../../ports/cold-event-storage.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
// The in-memory adapter's audit filter is the reference semantics the D1 audit
// SQL is held to, so archived events — which never pass through SQL — are
// filtered and ordered by it rather than by a third copy of the same rules.
import { compareAuditEvents, searchInMemoryAuditEvents } from "../in-memory/audit-events.js";
import { auditDocumentEventQuery, auditEventQuery } from "./audit-event-query.js";
import { decodeEventSegment } from "./event-archive-format.js";
import {
  QUALIFIED_SEGMENT_COLUMNS,
  documentSegmentsStatement,
  overlappingSegmentsStatement,
  type EventArchiveSegmentRow
} from "./event-archive-index.js";
import { eventStreamQuery } from "./read-stream-query.js";
import { eventFromRow, type EventRow } from "./serde.js";
import {
  D1_EVENT_ARCHIVE_DOCUMENTS_TABLE,
  D1_EVENT_ARCHIVE_SEGMENTS_TABLE,
  D1_EVENTS_TABLE
} from "./tables.js";

export interface D1ArchivedEventsOptions {
  readonly storage: ColdEventStorage;
  /**
   * Archived events kept parsed in this isolate, across all segments. Segments
   * are immutable, so a cached one never goes stale. Defaults to 10,000; 0
   * disables the cache.
   *
   * This is what keeps repeated work on one archived document cheap. The
   * aggregate Durable Object is addressed per document, and the commands that
   * still fold the whole stream — assign, tag, follow, cancel, merge — would
   * otherwise fetch the same cold objects on every call.
   */
  readonly cacheEvents?: number;
  /** Called once per read that needed archived segments. See {@link ColdEventReadMetrics}. */
  readonly observer?: ColdEventReadObserver;
  /** Milliseconds, for the observer's `durationMs`. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export const DEFAULT_ARCHIVED_EVENT_CACHE_EVENTS = 10_000;

/**
 * The read side of the event archive (issue #18): hot events from D1, archived
 * ones from cold storage, merged so a caller cannot tell where any came from.
 *
 * `D1EventStore` and `D1DocumentStore` take one of these to become
 * archive-aware, which is why `EventStore`, `DocumentStore` and
 * `AuditEventStore` did not change. Share one instance between the stores of an
 * isolate so they share its cache.
 *
 * Every stream read is a single D1 batch of two statements — the hot rows and
 * the overlapping index rows — rather than two round trips. One round trip is
 * the smaller benefit. The larger is that a batch reads one consistent state:
 * with two separate reads an archive committing between them could move events
 * out of the hot result and into an index the read had already taken, and they
 * would be in neither answer. Merges also deduplicate by sequence, so even a
 * read that does overlap a move returns each event once.
 */
export class D1ArchivedEvents {
  private readonly storage: ColdEventStorage;
  private readonly cache: SegmentCache;
  private readonly observer: ColdEventReadObserver | undefined;
  private readonly now: () => number;

  constructor(
    private readonly db: D1Database,
    options: D1ArchivedEventsOptions
  ) {
    this.storage = options.storage;
    this.cache = new SegmentCache(options.cacheEvents ?? DEFAULT_ARCHIVED_EVENT_CACHE_EVENTS);
    this.observer = options.observer;
    this.now = options.now ?? Date.now;
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const started = this.now();
    const query = eventStreamQuery(options);
    const [hotResult, segmentResult] = await this.db.batch<EventRow | EventArchiveSegmentRow>([
      this.db.prepare(query.sql).bind(stream, ...query.params),
      overlappingSegmentsStatement(this.db, stream, {
        ...(options.minSequence === undefined ? {} : { lowest: options.minSequence }),
        ...(options.maxSequence === undefined ? {} : { highest: options.maxSequence })
      })
    ]);
    const hotRows = (hotResult?.results ?? []) as EventRow[];
    const hot = (query.reverseResults ? [...hotRows].reverse() : hotRows).map(eventFromRow);
    const segments = (segmentResult?.results ?? []) as EventArchiveSegmentRow[];
    if (segments.length === 0) {
      return hot;
    }

    const kinds = options.payloadKinds === undefined ? undefined : new Set<string>(options.payloadKinds);
    const wanted = (event: DomainEvent) =>
      (options.minSequence === undefined || event.sequence >= options.minSequence) &&
      (options.maxSequence === undefined || event.sequence <= options.maxSequence) &&
      (kinds === undefined || kinds.has(event.payload.kind));
    const recentPage = options.limit !== undefined && options.minSequence === undefined;
    const limit = options.limit;
    const stats = { segments: 0, cachedSegments: 0 };

    let result: readonly DomainEvent[];
    if (limit !== undefined && hot.length >= limit && recentPage) {
      // The newest `limit` events are all hot; nothing archived is newer.
      result = hot;
    } else if (limit !== undefined) {
      // Walk segments only as far as the page needs: newest-first for the
      // recent page, oldest-first for a forward page from `minSequence`.
      const ordered = recentPage ? [...segments].reverse() : segments;
      const needed = recentPage ? limit - hot.length : limit;
      const cold: DomainEvent[] = [];
      for (const segment of ordered) {
        if (cold.length >= needed) {
          break;
        }
        const events = (await this.segmentEvents(segment, stats)).filter(wanted);
        if (recentPage) {
          cold.unshift(...events);
        } else {
          cold.push(...events);
        }
      }
      const merged = mergeBySequence(cold, hot);
      result = recentPage ? merged.slice(Math.max(0, merged.length - limit)) : merged.slice(0, limit);
    } else {
      const cold: DomainEvent[] = [];
      for (const segment of segments) {
        cold.push(...(await this.segmentEvents(segment, stats)).filter(wanted));
      }
      result = mergeBySequence(cold, hot);
    }
    this.report("readStream", stream, stats, result.length - countShared(result, hot), started);
    return result;
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    if (query.stream === undefined) {
      // The document's own stream and nothing else, which is exactly a stream
      // read — so it takes the stream path and its index lookup.
      const stream = documentStream(query.tenantId, query.doctype, query.documentName);
      if (query.order === "desc") {
        const events = await this.readStream(stream, query.limit === undefined ? {} : { limit: query.limit });
        return [...events].reverse();
      }
      return this.readStream(stream, query.limit === undefined ? {} : { minSequence: 1, limit: query.limit });
    }

    const started = this.now();
    const prepared = auditDocumentEventQuery(query);
    const [hotResult, segmentResult] = await this.db.batch<EventRow | EventArchiveSegmentRow>([
      this.db.prepare(prepared.sql).bind(...prepared.params),
      documentSegmentsStatement(this.db, query.stream, query.documentName)
    ]);
    const hot = ((hotResult?.results ?? []) as EventRow[]).map(eventFromRow);
    const segments = (segmentResult?.results ?? []) as EventArchiveSegmentRow[];
    if (segments.length === 0) {
      return hot;
    }
    const stats = { segments: 0, cachedSegments: 0 };
    const cold: DomainEvent[] = [];
    for (const segment of segments) {
      cold.push(
        ...(await this.segmentEvents(segment, stats)).filter(
          (event) =>
            event.tenantId === query.tenantId &&
            event.doctype === query.doctype &&
            event.documentName === query.documentName
        )
      );
    }
    const merged = mergeBySequence(cold, hot);
    const ordered = query.order === "desc" ? [...merged].reverse() : merged;
    const result = query.limit === undefined ? ordered : ordered.slice(0, query.limit);
    this.report("readDocumentEvents", query.stream, stats, result.length - countShared(result, hot), started);
    return result;
  }

  /**
   * The tenant-wide audit search, over hot and archived events.
   *
   * Two sequential reads rather than a batch, because the second is narrowed by
   * the first: when the hot result already fills `limit`, only segments that
   * reach back to its oldest timestamp can contribute. The order — hot first,
   * index second — is the safe one. An archive committing in between makes an
   * event appear in both reads, which the merge deduplicates by id; the reverse
   * order could make it appear in neither.
   */
  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    const started = this.now();
    const prepared = auditEventQuery(query);
    const hot = ((await this.db.prepare(prepared.sql).bind(...prepared.params).all<EventRow>()).results ?? []).map(
      eventFromRow
    );
    const clauses = ["s.tenant_id = ?"];
    const params: (number | string)[] = [query.tenantId];
    if (query.doctype !== undefined) {
      clauses.push("s.doctype = ?");
      params.push(query.doctype);
    }
    if (query.since !== undefined) {
      clauses.push("s.last_occurred_at >= ?");
      params.push(query.since);
    }
    if (query.until !== undefined) {
      clauses.push("s.first_occurred_at <= ?");
      params.push(query.until);
    }
    if (query.limit !== undefined && hot.length >= query.limit && hot.length > 0) {
      clauses.push("s.last_occurred_at >= ?");
      params.push(hot[hot.length - 1]!.occurredAt);
    }
    if (query.documentName !== undefined) {
      clauses.push(
        `EXISTS (SELECT 1 FROM ${D1_EVENT_ARCHIVE_DOCUMENTS_TABLE} d ` +
          "WHERE d.stream = s.stream AND d.seq_start = s.seq_start AND d.document_name = ?)"
      );
      params.push(query.documentName);
    }
    const segments = (
      await this.db
        .prepare(
          `SELECT ${QUALIFIED_SEGMENT_COLUMNS} ` +
            `FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} s WHERE ${clauses.join(" AND ")} ` +
            "ORDER BY s.last_occurred_at DESC, s.stream ASC, s.seq_start DESC"
        )
        .bind(...params)
        .all<EventArchiveSegmentRow>()
    ).results ?? [];
    if (segments.length === 0) {
      return hot;
    }
    const stats = { segments: 0, cachedSegments: 0 };
    const cold: DomainEvent[][] = [];
    for (const segment of segments) {
      cold.push([...(await this.segmentEvents(segment, stats))]);
    }
    const matched = searchInMemoryAuditEvents(cold, query);
    const byId = new Map<string, DomainEvent>();
    for (const event of [...matched, ...hot]) {
      byId.set(event.id, event);
    }
    const merged = [...byId.values()].sort(compareAuditEvents);
    const result = query.limit === undefined ? merged : merged.slice(0, query.limit);
    const hotIds = new Set(hot.map((event) => event.id));
    this.report(
      "searchEvents",
      undefined,
      stats,
      result.filter((event) => !hotIds.has(event.id)).length,
      started
    );
    return result;
  }

  /**
   * Streams with any event of `(tenantId, doctype)`, hot or archived. A stream
   * whose every event is archived has no hot row at all, and a rebuild that
   * enumerated only hot rows would skip its document entirely.
   */
  async listStreams(query: { readonly tenantId: string; readonly doctype: string }): Promise<readonly StreamName[]> {
    const result = await this.db
      .prepare(
        `SELECT stream FROM ${D1_EVENTS_TABLE} WHERE tenant_id = ? AND doctype = ? ` +
          `UNION SELECT stream FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE tenant_id = ? AND doctype = ? ` +
          "ORDER BY stream ASC"
      )
      .bind(query.tenantId, query.doctype, query.tenantId, query.doctype)
      .all<{ stream: string }>();
    return (result.results ?? []).map((row) => row.stream);
  }

  /**
   * One segment's events, from the cache or from cold storage.
   *
   * A segment the index lists but storage does not have is an error, not an
   * empty segment: the index row exists only because the object was written and
   * read back before the hot rows were deleted, so a missing object means the
   * bucket lost data, and returning the rest of the stream would be returning a
   * wrong history.
   */
  private async segmentEvents(
    segment: EventArchiveSegmentRow,
    stats: { segments: number; cachedSegments: number }
  ): Promise<readonly DomainEvent[]> {
    stats.segments += 1;
    const cacheKey = `${segment.object_key}#${segment.sha256}`;
    let rows = this.cache.get(cacheKey);
    if (rows === undefined) {
      const body = await this.storage.get(segment.object_key);
      if (body === null) {
        throw new FrameworkError(
          "EVENT_ARCHIVE_INTEGRITY",
          `Archived segment ${segment.stream}#${segment.seq_start}-${segment.seq_end} is indexed but missing ` +
            `from cold storage at '${segment.object_key}'`,
          { status: 500 }
        );
      }
      rows = await decodeEventSegment(body, {
        stream: segment.stream,
        seqStart: Number(segment.seq_start),
        seqEnd: Number(segment.seq_end),
        sha256: segment.sha256
      });
      this.cache.set(cacheKey, rows);
    } else {
      stats.cachedSegments += 1;
    }
    // Parsed per read rather than cached parsed: callers own what they are
    // handed, and a cached object one of them mutated would leak into the next.
    return rows.map(eventFromRow);
  }

  private report(
    operation: ColdEventReadMetrics["operation"],
    stream: string | undefined,
    stats: { readonly segments: number; readonly cachedSegments: number },
    archivedEvents: number,
    started: number
  ): void {
    if (this.observer === undefined || stats.segments === 0) {
      return;
    }
    try {
      this.observer({
        operation,
        ...(stream === undefined ? {} : { stream }),
        segments: stats.segments,
        cachedSegments: stats.cachedSegments,
        archivedEvents,
        durationMs: this.now() - started
      });
    } catch {
      // Metrics must not be able to fail a read.
    }
  }
}

/** Ascending by sequence; on a duplicate sequence the hot copy wins. */
function mergeBySequence(cold: readonly DomainEvent[], hot: readonly DomainEvent[]): readonly DomainEvent[] {
  const bySequence = new Map<number, DomainEvent>();
  for (const event of cold) {
    bySequence.set(event.sequence, event);
  }
  for (const event of hot) {
    bySequence.set(event.sequence, event);
  }
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

function countShared(result: readonly DomainEvent[], hot: readonly DomainEvent[]): number {
  const hotIds = new Set(hot.map((event) => event.id));
  return result.filter((event) => hotIds.has(event.id)).length;
}

/**
 * Least-recently-used, bounded by events rather than segments, because segment
 * sizes vary and what costs memory is the rows.
 */
class SegmentCache {
  private readonly entries = new Map<string, readonly EventRow[]>();
  private size = 0;

  constructor(private readonly limit: number) {}

  get(key: string): readonly EventRow[] | undefined {
    const found = this.entries.get(key);
    if (found !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, found);
    }
    return found;
  }

  set(key: string, rows: readonly EventRow[]): void {
    if (rows.length > this.limit) {
      return;
    }
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.entries.delete(key);
      this.size -= existing.length;
    }
    this.entries.set(key, rows);
    this.size += rows.length;
    while (this.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.size -= this.entries.get(oldest.value)!.length;
      this.entries.delete(oldest.value);
    }
  }
}
