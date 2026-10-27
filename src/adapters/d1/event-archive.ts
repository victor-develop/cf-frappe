import { FrameworkError } from "../../core/errors.js";
import { isArchivableStream } from "../../core/streams.js";
import type { StreamName } from "../../core/types.js";
import type { Clock } from "../../ports/clock.js";
import { systemClock } from "../../ports/clock.js";
import type { ColdEventStorage } from "../../ports/cold-event-storage.js";
import type {
  ArchivedEventSegment,
  EventArchive,
  EventArchiveCandidate,
  EventArchiveMoveOptions,
  EventArchiveMoveResult,
  EventArchiveRestoreResult
} from "../../ports/event-archive.js";
import { isD1ConstraintError } from "./constraint-error.js";
import {
  EVENT_ARCHIVE_FORMAT,
  byteLength,
  decodeEventSegment,
  encodeEventSegment,
  eventSegmentObjectKey,
  sha256Hex
} from "./event-archive-format.js";
import { SEGMENT_COLUMNS, segmentFromRow, type EventArchiveSegmentRow } from "./event-archive-index.js";
import { readD1StreamVersion } from "./event-reader.js";
import type { EventRow } from "./serde.js";
import {
  D1_EVENT_ARCHIVE_DOCUMENTS_TABLE,
  D1_EVENT_ARCHIVE_SEGMENTS_TABLE,
  D1_EVENTS_TABLE
} from "./tables.js";

export interface D1EventArchiveOptions {
  readonly storage: ColdEventStorage;
  readonly clock?: Clock;
}

/**
 * Events per cold object unless the caller says otherwise. Large enough that a
 * busy stream is a handful of objects rather than thousands, small enough that
 * restoring one is a single D1 batch well inside its 30-second limit.
 */
export const DEFAULT_EVENT_ARCHIVE_SEGMENT_EVENTS = 500;
/**
 * Ceiling on `maxSegmentEvents`. A restore inserts one segment in one batch,
 * and a batch is one transaction holding D1's single writer.
 */
export const MAX_EVENT_ARCHIVE_SEGMENT_EVENTS = 5_000;

const EVENT_COLUMNS =
  "id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json";

/**
 * The write side of the event archive on D1 (issue #18): moves a prefix of a
 * stream to cold storage and back.
 *
 * The protocol for one segment, in order, and why each step is where it is:
 *
 * 1. **Read the hot rows** `[start, end]` and require all of them, contiguous.
 *    A gap means something else is moving this stream, and moving a partial
 *    range would archive a hole.
 * 2. **Write the object, then read it back** and check its digest. Only a copy
 *    that has been seen to exist is allowed to stand in for the hot rows.
 * 3. **One D1 batch** inserts the index rows and deletes the hot rows. Both are
 *    guarded in SQL, not in this code: the index insert lands only if every hot
 *    row is still there and the stream's archived prefix still ends at
 *    `start - 1`, and the delete runs only if that exact index row — same range,
 *    same digest — exists. A concurrent archive, a concurrent restore, or a
 *    failure at any statement leaves the hot rows untouched.
 *
 * A crash between 2 and 3 leaves an object with no index row and every event
 * still hot. The next run writes the same bytes to the same key and carries on.
 * There is no ordering in which an event is in neither place.
 *
 * Nothing here deletes from cold storage, and the port does not allow it.
 */
export class D1EventArchive implements EventArchive {
  private readonly storage: ColdEventStorage;
  private readonly clock: Clock;

  constructor(
    private readonly db: D1Database,
    options: D1EventArchiveOptions
  ) {
    this.storage = options.storage;
    this.clock = options.clock ?? systemClock;
  }

  async archive(stream: StreamName, options: EventArchiveMoveOptions): Promise<EventArchiveMoveResult> {
    assertArchivable(stream);
    const through = assertSequence(options.through, "through");
    const maxSegmentEvents = assertSegmentSize(options.maxSegmentEvents ?? DEFAULT_EVENT_ARCHIVE_SEGMENT_EVENTS);
    const minEvents = Math.max(1, Math.floor(options.minEvents ?? 1));

    let archivedThrough = await this.archivedThrough(stream);
    // Never past the stream's head, whatever the caller asked for: there is
    // nothing above it to move, and a `through` from a stale read must not turn
    // into a range that does not exist yet.
    const target = Math.min(through, await readD1StreamVersion(this.db, stream));
    if (target - archivedThrough < minEvents) {
      return { stream, segments: [], archivedThrough };
    }

    const written: ArchivedEventSegment[] = [];
    while (archivedThrough < target) {
      const seqStart = archivedThrough + 1;
      const seqEnd = Math.min(target, archivedThrough + maxSegmentEvents);
      written.push(await this.archiveSegment(stream, seqStart, seqEnd));
      archivedThrough = seqEnd;
    }
    return { stream, segments: written, archivedThrough };
  }

  /**
   * Moves every archived event of `stream` back into `cf_frappe_events`, newest
   * segment first.
   *
   * Newest first keeps the archived part of the stream a prefix at every step,
   * which is the shape the read path and the next archive both assume. Each
   * segment is one batch: the events go back and the index rows go away
   * together, and the inserts are guarded on that index row still being the
   * stream's newest — so two restores racing on one stream cannot insert the
   * same segment twice, and a failure leaves the segment archived and intact.
   *
   * The objects stay in cold storage. Re-archiving the same range later writes
   * the same bytes to the same key.
   */
  async restore(stream: StreamName): Promise<EventArchiveRestoreResult> {
    let segments = 0;
    let events = 0;
    for (;;) {
      const top = await this.db
        .prepare(
          `SELECT ${SEGMENT_COLUMNS} FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} ` +
            "WHERE stream = ? ORDER BY seq_start DESC LIMIT 1"
        )
        .bind(stream)
        .first<EventArchiveSegmentRow>();
      if (top === null) {
        return { stream, segments, events };
      }
      const body = await this.storage.get(top.object_key);
      if (body === null) {
        throw new FrameworkError(
          "EVENT_ARCHIVE_INTEGRITY",
          `Archived segment ${stream}#${top.seq_start}-${top.seq_end} is missing from cold storage ` +
            `at '${top.object_key}'; it stays archived`,
          { status: 500 }
        );
      }
      const rows = await decodeEventSegment(body, {
        stream,
        seqStart: Number(top.seq_start),
        seqEnd: Number(top.seq_end),
        sha256: top.sha256
      });
      const isNewest =
        `EXISTS (SELECT 1 FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} ` +
        "WHERE stream = ? AND seq_start = ? AND seq_end = ? AND sha256 = ? " +
        `AND seq_end = (SELECT MAX(seq_end) FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE stream = ?))`;
      const guard = [stream, Number(top.seq_start), Number(top.seq_end), top.sha256, stream];
      try {
        await this.db.batch([
          ...rows.map((row) =>
            this.db
              .prepare(
                `INSERT INTO ${D1_EVENTS_TABLE} (${EVENT_COLUMNS}) ` +
                  `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${isNewest}`
              )
              .bind(
                row.id,
                row.tenant_id,
                row.stream,
                row.sequence,
                row.type,
                row.doctype,
                row.document_name,
                row.actor_id,
                row.occurred_at,
                row.payload_json,
                row.metadata_json,
                ...guard
              )
          ),
          this.db
            .prepare(`DELETE FROM ${D1_EVENT_ARCHIVE_DOCUMENTS_TABLE} WHERE stream = ? AND seq_start = ? AND ${isNewest}`)
            .bind(stream, Number(top.seq_start), ...guard),
          // Last, so the guard above still sees the row while the inserts run.
          this.db
            .prepare(
              `DELETE FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} ` +
                "WHERE stream = ? AND seq_start = ? AND seq_end = ? AND sha256 = ?"
            )
            .bind(stream, Number(top.seq_start), Number(top.seq_end), top.sha256)
        ]);
      } catch (error) {
        if (isD1ConstraintError(error)) {
          throw new FrameworkError(
            "EVENT_ARCHIVE_CONFLICT",
            `Stream '${stream}' already has hot events in ${top.seq_start}-${top.seq_end}; the segment stays archived`,
            { status: 409 }
          );
        }
        throw error;
      }
      segments += 1;
      events += rows.length;
    }
  }

  async segments(stream: StreamName): Promise<readonly ArchivedEventSegment[]> {
    const result = await this.db
      .prepare(
        `SELECT ${SEGMENT_COLUMNS} FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE stream = ? ORDER BY seq_start ASC`
      )
      .bind(stream)
      .all<EventArchiveSegmentRow>();
    return (result.results ?? []).map(segmentFromRow);
  }

  async candidates(query: {
    readonly after?: StreamName;
    readonly limit: number;
    readonly minHotEvents: number;
  }): Promise<readonly EventArchiveCandidate[]> {
    const result = await this.db
      .prepare(
        `SELECT stream, COUNT(*) AS hot_events FROM ${D1_EVENTS_TABLE} WHERE stream > ? ` +
          "GROUP BY stream HAVING COUNT(*) >= ? ORDER BY stream ASC LIMIT ?"
      )
      .bind(query.after ?? "", Math.max(1, Math.floor(query.minHotEvents)), Math.max(1, Math.floor(query.limit)))
      .all<{ stream: string; hot_events: number }>();
    // Protected streams are returned, not filtered: the caller pages with the
    // last stream it was handed, and dropping rows here would end a scan early.
    // `archive` refuses them either way.
    return (result.results ?? []).map((row) => ({ stream: row.stream, hotEvents: Number(row.hot_events) }));
  }

  async archivedStreams(query: { readonly after?: StreamName; readonly limit: number }): Promise<readonly StreamName[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT stream FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE stream > ? ORDER BY stream ASC LIMIT ?`
      )
      .bind(query.after ?? "", Math.max(1, Math.floor(query.limit)))
      .all<{ stream: string }>();
    return (result.results ?? []).map((row) => row.stream);
  }

  private async archivedThrough(stream: StreamName): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COALESCE(MAX(seq_end), 0) AS archived FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE stream = ?`)
      .bind(stream)
      .first<{ archived: number }>();
    return Number(row!.archived);
  }

  private async archiveSegment(stream: StreamName, seqStart: number, seqEnd: number): Promise<ArchivedEventSegment> {
    const rows = (
      await this.db
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM ${D1_EVENTS_TABLE} ` +
            "WHERE stream = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence ASC"
        )
        .bind(stream, seqStart, seqEnd)
        .all<EventRow>()
    ).results ?? [];
    const expected = seqEnd - seqStart + 1;
    if (rows.length !== expected || rows.some((row, index) => Number(row.sequence) !== seqStart + index)) {
      throw new FrameworkError(
        "EVENT_ARCHIVE_CONFLICT",
        `Stream '${stream}' does not hold every event in ${seqStart}-${seqEnd} hot; nothing was archived`,
        { status: 409 }
      );
    }
    const first = rows[0]!;
    if (rows.some((row) => row.tenant_id !== first.tenant_id || row.doctype !== first.doctype)) {
      // The index files a segment under one tenant and one doctype, which is
      // what lets the audit search and `listStreams` find it. A stream that
      // mixes them is not one the framework writes, and is left hot rather than
      // indexed wrongly.
      throw new FrameworkError(
        "EVENT_ARCHIVE_INVALID",
        `Stream '${stream}' mixes tenants or doctypes in ${seqStart}-${seqEnd}; it cannot be archived`,
        { status: 409 }
      );
    }
    const normalized = rows.map((row) => ({ ...row, sequence: Number(row.sequence) }));
    const body = encodeEventSegment(normalized);
    const sha256 = await sha256Hex(body);
    const objectKey = await eventSegmentObjectKey(stream, seqStart, seqEnd);
    await this.storage.put(objectKey, body, {
      sha256,
      metadata: {
        format: EVENT_ARCHIVE_FORMAT,
        stream,
        seqStart: String(seqStart),
        seqEnd: String(seqEnd),
        sha256
      }
    });
    // Read back before anything hot is touched. `decodeEventSegment` checks the
    // digest, the stream and every sequence, so this is the cold copy proven
    // equal to the rows about to be deleted, not merely proven present.
    const stored = await this.storage.get(objectKey);
    if (stored === null) {
      throw new FrameworkError(
        "EVENT_ARCHIVE_INTEGRITY",
        `Cold storage did not return '${objectKey}' after writing it; nothing was archived`,
        { status: 500 }
      );
    }
    await decodeEventSegment(stored, { stream, seqStart, seqEnd, sha256 });

    const occurredAt = normalized.map((row) => row.occurred_at).sort();
    const archivedAt = this.clock.now();
    const segmentExists =
      `EXISTS (SELECT 1 FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} ` +
      "WHERE stream = ? AND seq_start = ? AND seq_end = ? AND sha256 = ?)";
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} (${SEGMENT_COLUMNS}) ` +
            "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? " +
            `WHERE (SELECT COUNT(*) FROM ${D1_EVENTS_TABLE} WHERE stream = ? AND sequence >= ? AND sequence <= ?) = ? ` +
            `AND (SELECT COALESCE(MAX(seq_end), 0) FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE stream = ?) = ?`
        )
        .bind(
          stream,
          seqStart,
          seqEnd,
          first.tenant_id,
          first.doctype,
          occurredAt[0]!,
          occurredAt[occurredAt.length - 1]!,
          expected,
          objectKey,
          sha256,
          byteLength(body),
          archivedAt,
          stream,
          seqStart,
          seqEnd,
          expected,
          stream,
          seqStart - 1
        ),
      this.db
        .prepare(
          `INSERT INTO ${D1_EVENT_ARCHIVE_DOCUMENTS_TABLE} (stream, document_name, seq_start) ` +
            `SELECT DISTINCT stream, document_name, ? FROM ${D1_EVENTS_TABLE} ` +
            `WHERE stream = ? AND sequence >= ? AND sequence <= ? AND ${segmentExists}`
        )
        .bind(seqStart, stream, seqStart, seqEnd, stream, seqStart, seqEnd, sha256),
      this.db
        .prepare(
          `DELETE FROM ${D1_EVENTS_TABLE} WHERE stream = ? AND sequence >= ? AND sequence <= ? AND ${segmentExists}`
        )
        .bind(stream, seqStart, seqEnd, stream, seqStart, seqEnd, sha256)
    ]);

    // The guards decide inside the batch, so whether this segment landed is read
    // back rather than inferred. D1 reports per-statement changes, but the
    // answer that matters is the state, and reading it is unambiguous.
    const landed = await this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} ` +
          "WHERE stream = ? AND seq_start = ? AND seq_end = ? AND sha256 = ?) AS indexed, " +
          `(SELECT COUNT(*) FROM ${D1_EVENTS_TABLE} WHERE stream = ? AND sequence >= ? AND sequence <= ?) AS hot`
      )
      .bind(stream, seqStart, seqEnd, sha256, stream, seqStart, seqEnd)
      .first<{ indexed: number; hot: number }>();
    if (Number(landed!.indexed) !== 1 || Number(landed!.hot) !== 0) {
      throw new FrameworkError(
        "EVENT_ARCHIVE_CONFLICT",
        `Stream '${stream}' changed while archiving ${seqStart}-${seqEnd}; its hot events were left in place`,
        { status: 409 }
      );
    }
    return {
      stream,
      seqStart,
      seqEnd,
      tenantId: first.tenant_id,
      doctype: first.doctype,
      eventCount: expected,
      objectKey,
      sha256,
      archivedAt
    };
  }
}

function assertArchivable(stream: StreamName): void {
  if (!isArchivableStream(stream)) {
    throw new FrameworkError(
      "EVENT_ARCHIVE_STREAM_PROTECTED",
      `Stream '${stream}' must stay in the hot database: naming-series and unique-value streams are read ` +
        "to decide writes, and names this archive cannot parse are never moved",
      { status: 409 }
    );
  }
}

function assertSequence(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FrameworkError("EVENT_ARCHIVE_INVALID", `'${name}' must be a non-negative integer`, { status: 400 });
  }
  return value;
}

function assertSegmentSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVENT_ARCHIVE_SEGMENT_EVENTS) {
    throw new FrameworkError(
      "EVENT_ARCHIVE_INVALID",
      `'maxSegmentEvents' must be an integer from 1 to ${MAX_EVENT_ARCHIVE_SEGMENT_EVENTS}`,
      { status: 400 }
    );
  }
  return value;
}
