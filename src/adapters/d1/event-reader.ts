import { FrameworkError } from "../../core/errors.js";
import type { DomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery } from "../../ports/audit-event-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import { auditDocumentEventQuery, auditEventQuery } from "./audit-event-query.js";
import { eventStreamQuery } from "./read-stream-query.js";
import { eventFromRow, type EventRow } from "./serde.js";
import { D1_EVENT_ARCHIVE_SEGMENTS_TABLE, D1_EVENTS_TABLE } from "./tables.js";

/**
 * A stream read from the hot table alone, for a store with no archive behind it.
 *
 * The read itself is unchanged by issue #18; what is added is a check that costs
 * nothing. Sequences are contiguous from 1 and the hot table only ever loses a
 * prefix of a stream, to the archive. So when a read whose lower bound is known
 * comes back starting *above* that bound, the missing events can only be in cold
 * storage, and folding what is here would be folding half a history. That is the
 * state a deployment reaches if the archive is switched off — or left off in one
 * of the two places it has to be configured — after streams were archived, and
 * failing loudly there is the difference between an error and a document whose
 * next write is computed from the wrong state.
 *
 * It cannot see everything. A read filtered by `payloadKinds` may legitimately
 * start late, and an empty result proves nothing, so those pass unchecked; the
 * version check in {@link readD1StreamVersion} is what keeps such a deployment
 * from corrupting the stream itself.
 */
export async function readD1EventStream(
  db: D1Database,
  stream: StreamName,
  options: ReadStreamOptions = {}
): Promise<readonly DomainEvent[]> {
  const events = await readD1HotEventStream(db, stream, options);
  assertNoArchivedGap(stream, options, events);
  return events;
}

/** The hot rows of a stream, without the archived-gap check. */
export async function readD1HotEventStream(
  db: D1Database,
  stream: StreamName,
  options: ReadStreamOptions = {}
): Promise<readonly DomainEvent[]> {
  const query = eventStreamQuery(options);
  const result = await db
    .prepare(query.sql)
    .bind(stream, ...query.params)
    .all<EventRow>();
  const events = (result.results ?? []).map(eventFromRow);
  return query.reverseResults ? [...events].reverse() : events;
}

/**
 * The stream's current version: its highest sequence, hot or archived.
 *
 * The archived half is read even where no archive is configured. It is one
 * primary-key seek into a table that is empty unless the archive has run, and it
 * is the guard on the one failure that cannot be undone: a stream whose hot tail
 * has been archived reports `MAX(sequence)` of nothing, and an append against
 * that version would write sequence 1 again. Optimistic concurrency is only as
 * correct as this number.
 *
 * Both bindings are the stream. The archived subquery comes first in the text,
 * so it takes the first one.
 */
export async function readD1StreamVersion(db: D1Database, stream: StreamName): Promise<number> {
  const row = await db
    .prepare(
      "SELECT MAX(" +
        `(SELECT COALESCE(MAX(seq_end), 0) FROM ${D1_EVENT_ARCHIVE_SEGMENTS_TABLE} WHERE stream = ?), ` +
        "COALESCE(MAX(sequence), 0)" +
        `) AS version FROM ${D1_EVENTS_TABLE} WHERE stream = ?`
    )
    .bind(stream, stream)
    .first<{ version: number }>();
  // An aggregate over no rows still returns exactly one row, so the version is
  // always present.
  return Number(row!.version);
}

function assertNoArchivedGap(
  stream: StreamName,
  options: ReadStreamOptions,
  events: readonly DomainEvent[]
): void {
  const first = events[0];
  if (first === undefined || options.payloadKinds !== undefined) {
    return;
  }
  const recentPage = options.limit !== undefined && options.minSequence === undefined;
  if (recentPage && events.length >= options.limit!) {
    // The newest `limit` events, all present: whatever is older was not asked for.
    return;
  }
  const lowest = Math.max(1, options.minSequence ?? 1);
  if (first.sequence > lowest) {
    throw new FrameworkError(
      "EVENT_ARCHIVE_REQUIRED",
      `Stream '${stream}' has no hot events below sequence ${first.sequence}; they are archived, ` +
        "and this store has no event archive configured to read them",
      { status: 500 }
    );
  }
}

export async function searchD1AuditEvents(
  db: D1Database,
  query: AuditEventQuery
): Promise<readonly DomainEvent[]> {
  const prepared = auditEventQuery(query);
  const result = await db
    .prepare(prepared.sql)
    .bind(...prepared.params)
    .all<EventRow>();
  return (result.results ?? []).map(eventFromRow);
}

export async function readD1AuditDocumentEvents(
  db: D1Database,
  query: AuditDocumentEventQuery
): Promise<readonly DomainEvent[]> {
  const prepared = auditDocumentEventQuery(query);
  const result = await db
    .prepare(prepared.sql)
    .bind(...prepared.params)
    .all<EventRow>();
  return (result.results ?? []).map(eventFromRow);
}
