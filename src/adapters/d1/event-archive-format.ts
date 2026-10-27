import { FrameworkError } from "../../core/errors.js";
import type { StreamName } from "../../core/types.js";
import type { EventRow } from "./serde.js";

/**
 * The on-disk shape of an archived segment, and the checks that make reading
 * one back trustworthy.
 *
 * A segment is NDJSON, one `cf_frappe_events` row per line with the columns
 * exactly as D1 stored them — `payload_json` and `metadata_json` stay strings.
 * Storing the row rather than the parsed `DomainEvent` is what makes `restore`
 * byte-identical: it re-inserts the same column values instead of re-serialising
 * whatever the parser of the day produces. Each row names its own stream and
 * sequence, so an object is self-describing even without the index.
 */
export const EVENT_ARCHIVE_FORMAT = "cf-frappe-events/1";

const EVENT_ROW_COLUMNS = [
  "id",
  "tenant_id",
  "stream",
  "sequence",
  "type",
  "doctype",
  "document_name",
  "actor_id",
  "occurred_at",
  "payload_json",
  "metadata_json"
] as const;

/** What the index says a segment contains, which the object must agree with. */
export interface ExpectedSegment {
  readonly stream: StreamName;
  readonly seqStart: number;
  readonly seqEnd: number;
  readonly sha256: string;
}

export function encodeEventSegment(rows: readonly EventRow[]): string {
  // Columns written in a fixed order rather than spread, so two archives of the
  // same events produce the same bytes and therefore the same digest.
  return rows
    .map((row) => JSON.stringify(Object.fromEntries(EVENT_ROW_COLUMNS.map((column) => [column, row[column]]))))
    .join("\n") + "\n";
}

/**
 * Parses a segment body and refuses anything that is not exactly what the index
 * promised: the digest, the stream, and every sequence from `seqStart` to
 * `seqEnd` once and in order.
 *
 * A short or altered segment is an error, never a partial answer. A fold that
 * silently received half a history would produce a plausible, wrong document,
 * which is worse than a read that fails.
 */
export async function decodeEventSegment(body: string, expected: ExpectedSegment): Promise<readonly EventRow[]> {
  const digest = await sha256Hex(body);
  if (digest !== expected.sha256) {
    throw integrityError(expected, `digest ${digest} does not match the indexed ${expected.sha256}`);
  }
  const lines = body.split("\n").filter((line) => line.length > 0);
  const rows = lines.map((line) => parseEventRow(line, expected));
  if (rows.length !== expected.seqEnd - expected.seqStart + 1) {
    throw integrityError(expected, `holds ${rows.length} events, expected ${expected.seqEnd - expected.seqStart + 1}`);
  }
  rows.forEach((row, index) => {
    if (row.stream !== expected.stream || row.sequence !== expected.seqStart + index) {
      throw integrityError(expected, `row ${index} is ${row.stream}#${row.sequence}`);
    }
  });
  return rows;
}

/**
 * Where a segment lives: `events/<tenant>/<doctype>/<streamHash>/<seqStart>-<seqEnd>.ndjson`.
 *
 * Laid out by stream, not by time, because the unit of re-reading is a stream —
 * folding a document needs its whole history, and a time-bucketed layout would
 * turn that into a scan across buckets. The tenant and doctype parts are taken
 * from the stream name as `documentStream` already escaped them, so they contain
 * no `/`. The stream itself is hashed: names can be long, and the hash keeps
 * every key the same shape. Sequences are zero-padded so a listing sorts them
 * numerically.
 */
export async function eventSegmentObjectKey(stream: StreamName, seqStart: number, seqEnd: number): Promise<string> {
  const parts = stream.split(":");
  // Only what `encodeURIComponent` can emit, minus the `.` that `escapePart`
  // also encodes: no `/`, no `..`, nothing a key could be steered with.
  if (parts.length !== 3 || parts.some((part) => !OBJECT_KEY_PART.test(part))) {
    throw new FrameworkError("EVENT_ARCHIVE_INVALID", `Stream '${stream}' is not a framework stream name`, {
      status: 400
    });
  }
  return `events/${parts[0]}/${parts[1]}/${await sha256Hex(stream)}/${padSequence(seqStart)}-${padSequence(seqEnd)}.ndjson`;
}

const OBJECT_KEY_PART = /^[A-Za-z0-9%_\-~*'()!]+$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function padSequence(sequence: number): string {
  return String(sequence).padStart(12, "0");
}

function parseEventRow(line: string, expected: ExpectedSegment): EventRow {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw integrityError(expected, "contains a line that is not JSON");
  }
  if (typeof value !== "object" || value === null) {
    throw integrityError(expected, "contains a line that is not an event row");
  }
  const row = value as Record<string, unknown>;
  for (const column of EVENT_ROW_COLUMNS) {
    const valid = column === "sequence"
      ? Number.isSafeInteger(row[column])
      : typeof row[column] === "string";
    if (!valid) {
      throw integrityError(expected, `has an invalid '${column}'`);
    }
  }
  return row as unknown as EventRow;
}

function integrityError(expected: ExpectedSegment, detail: string): FrameworkError {
  return new FrameworkError(
    "EVENT_ARCHIVE_INTEGRITY",
    `Archived segment ${expected.stream}#${expected.seqStart}-${expected.seqEnd} ${detail}`,
    { status: 500 }
  );
}
