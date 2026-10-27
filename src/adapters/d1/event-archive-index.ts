import type { ArchivedEventSegment } from "../../ports/event-archive.js";
import { D1_EVENT_ARCHIVE_DOCUMENTS_TABLE, D1_EVENT_ARCHIVE_SEGMENTS_TABLE } from "./tables.js";

/** One row of `cf_frappe_event_archive_segments`. */
export interface EventArchiveSegmentRow {
  readonly stream: string;
  readonly seq_start: number;
  readonly seq_end: number;
  readonly tenant_id: string;
  readonly doctype: string;
  readonly first_occurred_at: string;
  readonly last_occurred_at: string;
  readonly event_count: number;
  readonly object_key: string;
  readonly sha256: string;
  readonly byte_length: number;
  readonly archived_at: string;
}

export const SEGMENT_COLUMNS =
  "stream, seq_start, seq_end, tenant_id, doctype, first_occurred_at, last_occurred_at, " +
  "event_count, object_key, sha256, byte_length, archived_at";

/** The same columns qualified by `s.`, for queries that join. */
export const QUALIFIED_SEGMENT_COLUMNS = SEGMENT_COLUMNS.split(", ")
  .map((column) => `s.${column}`)
  .join(", ");

export function segmentFromRow(row: EventArchiveSegmentRow): ArchivedEventSegment {
  return {
    stream: row.stream,
    seqStart: Number(row.seq_start),
    seqEnd: Number(row.seq_end),
    tenantId: row.tenant_id,
    doctype: row.doctype,
    eventCount: Number(row.event_count),
    objectKey: row.object_key,
    sha256: row.sha256,
    archivedAt: row.archived_at
  };
}

/**
 * Segments of `stream` overlapping `[lowest, highest]`, oldest first. Either
 * bound may be absent.
 */
export function overlappingSegmentsStatement(
  db: D1Database,
  stream: string,
  bounds: { readonly lowest?: number; readonly highest?: number }
): D1PreparedStatement {
  const clauses = ["stream = ?"];
  const params: (number | string)[] = [stream];
  if (bounds.lowest !== undefined) {
    clauses.push("seq_end >= ?");
    params.push(bounds.lowest);
  }
  if (bounds.highest !== undefined) {
    clauses.push("seq_start <= ?");
    params.push(bounds.highest);
  }
  return db
    .prepare(
      `SELECT ${SEGMENT_COLUMNS} FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} ` +
        `WHERE ${clauses.join(" AND ")} ORDER BY seq_start ASC`
    )
    .bind(...params);
}

/**
 * Segments of `stream` that hold at least one event of `documentName`, oldest
 * first — a point lookup on `cf_frappe_event_archive_documents`, so a record
 * that was never archived costs one empty index range rather than a read of
 * every segment.
 */
export function documentSegmentsStatement(db: D1Database, stream: string, documentName: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${QUALIFIED_SEGMENT_COLUMNS} FROM ${D1_EVENT_ARCHIVE_DOCUMENTS_TABLE} d ` +
        `JOIN ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} s ON s.stream = d.stream AND s.seq_start = d.seq_start ` +
        "WHERE d.stream = ? AND d.document_name = ? ORDER BY s.seq_start ASC"
    )
    .bind(stream, documentName);
}
