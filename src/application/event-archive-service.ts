import { FrameworkError } from "../core/errors.js";
import { foldDocumentFrom } from "../core/events.js";
import { documentDeliveryOutboxStream, isArchivableStream, parseStreamName, type ParsedStreamName } from "../core/streams.js";
import type { DocumentSnapshot, StreamName } from "../core/types.js";
import type { AuditEventStore } from "../ports/audit-event-store.js";
import type { EventArchive, EventArchiveRestoreResult } from "../ports/event-archive.js";
import type { EventStore } from "../ports/event-store.js";
import type { SnapshotStore } from "../ports/snapshot-store.js";
import { DOCUMENT_FOLD_NAME, DOCUMENT_FOLD_VERSION } from "./document-fold-snapshots.js";
import {
  DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
  documentDeliveryOutboxCheckpoint
} from "./document-delivery-outbox-events.js";
import type { StreamFold } from "./stream-fold-snapshots.js";
import { USER_NOTIFICATIONS_FOLD } from "./user-notification-service.js";

/**
 * Everything a cut policy may consult to decide how much of a stream is cold.
 */
export interface EventArchiveCutContext {
  readonly stream: StreamName;
  readonly parsed: ParsedStreamName;
  /**
   * The stream's version when the decision started. A policy never returns more
   * than this, and folds up to exactly this, so an append landing mid-decision
   * cannot make a snapshot claim an event it did not fold.
   */
  readonly head: number;
  readonly events: EventStore & AuditEventStore;
  /** The durable store the hot read paths resume from. */
  readonly snapshots: SnapshotStore;
}

/**
 * Decides where a kind of stream may be cut: the highest sequence whose events
 * no hot read path needs any more.
 *
 * This is issue #18's safety argument in code form. The archive's read path
 * would return cold events to anyone who asked, so archiving past this point is
 * never *incorrect* — but it would put R2 on the path of every write, which is
 * the cost archiving exists to avoid. A stream kind with no policy has no safe
 * cut point and is never archived: without a snapshot there is nowhere to
 * resume from but sequence 1.
 */
export interface EventArchiveCutPolicy {
  readonly name: string;
  appliesTo(stream: ParsedStreamName): boolean;
  /** 0 means nothing may be cut yet. Values above `context.head` are capped. */
  cutoff(context: EventArchiveCutContext): Promise<number>;
}

/**
 * A cut point backed by a fold snapshot: before cutting, record the fold's
 * snapshot at the stream's head in the durable store, read it back, and cut at
 * what the store confirms.
 *
 * Recording it here rather than waiting for one to exist is what makes this
 * self-sufficient. The document fold's hot-path snapshots live in the aggregate
 * Durable Object's memory and are gone on eviction; the one written here is in
 * D1, and the Durable Object reads it on a miss (`InMemorySnapshotStore`'s
 * `fallback`). The fold runs over events `≤ head` exactly — a read bounded
 * above, not "everything so far" — because a snapshot that includes an event it
 * claims not to would have that event folded twice on resume.
 */
export function snapshotCutPolicy<State>(options: {
  readonly name: string;
  readonly appliesTo: (stream: ParsedStreamName) => boolean;
  readonly fold: (stream: ParsedStreamName) => StreamFold<State>;
}): EventArchiveCutPolicy {
  return {
    name: options.name,
    appliesTo: options.appliesTo,
    cutoff: (context) => ensureFoldSnapshot(context, options.fold(context.parsed))
  };
}

/**
 * The document fold as a `StreamFold`, keyed exactly as `DocumentFoldSnapshots`
 * keys it, so the snapshot the archive records is the one a write resumes from.
 *
 * `decode` treats a stored `null` — a deleted document — as no snapshot. That
 * only costs the archive a full fold when it resumes from one; the hot path
 * reads the store directly and does use it.
 */
export const DOCUMENT_STREAM_FOLD: StreamFold<DocumentSnapshot | null> = {
  name: DOCUMENT_FOLD_NAME,
  version: DOCUMENT_FOLD_VERSION,
  foldFrom: (prior, events) => foldDocumentFrom(prior === null ? null : structuredClone(prior), events),
  codec: {
    encode: (state) => structuredClone(state),
    decode: (stored) => (typeof stored === "object" && stored !== null ? (stored as DocumentSnapshot) : null)
  }
};

/**
 * Documents of application doctypes. Framework streams all use a `__` doctype,
 * and an application doctype cannot start with one.
 */
export const documentFoldCutPolicy: EventArchiveCutPolicy = snapshotCutPolicy({
  name: "document",
  appliesTo: (stream) => !stream.doctype.startsWith("__"),
  fold: () => DOCUMENT_STREAM_FOLD
});

/** A user's notification inbox: unbounded, and already resumed from a D1 snapshot. */
export const userNotificationsCutPolicy: EventArchiveCutPolicy = snapshotCutPolicy({
  name: "userNotifications",
  appliesTo: (stream) => stream.doctype === "__UserNotifications",
  fold: (stream) => USER_NOTIFICATIONS_FOLD(stream.tenantId, stream.name)
});

/**
 * The tenant's delivery outbox, cut at its newest compaction checkpoint (#28).
 *
 * Every outbox read starts from that checkpoint, with one exception: records
 * the checkpoint carried over as still in flight are rehydrated from their own
 * full history. So the cut is the checkpoint's `upToSequence`, lowered to just
 * below the first event of any carried record — a poison record that stays in
 * flight for a week keeps its history hot, rather than turning every outbox
 * operation into a cold read. With no checkpoint the outbox folds the whole
 * stream, and nothing is cut.
 *
 * The checkpoint event itself sits at `upToSequence + 1`, above the cut. The
 * newest-first, limit-1 lookup that finds it — run inside every enqueue, claim
 * and delivery — is answered from the hot rows whenever a checkpoint is there,
 * and otherwise reads archived segments newest-first only until it finds one,
 * because archived events are always a prefix of the stream.
 */
export const deliveryOutboxCutPolicy: EventArchiveCutPolicy = {
  name: "documentDeliveryOutbox",
  // Compared with the builder's own output, so renaming the outbox stream
  // cannot leave this policy matching nothing.
  appliesTo: (stream) => {
    const outbox = parseStreamName(documentDeliveryOutboxStream(stream.tenantId))!;
    return stream.doctype === outbox.doctype && stream.name === outbox.name;
  },
  cutoff: async (context) => {
    const lookup = {
      tenantId: context.parsed.tenantId,
      doctype: context.parsed.doctype,
      stream: context.stream
    };
    const [newest] = await context.events.readDocumentEvents({
      ...lookup,
      documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
      order: "desc",
      limit: 1
    });
    const checkpoint = newest === undefined ? null : documentDeliveryOutboxCheckpoint(newest);
    if (checkpoint === null) {
      return 0;
    }
    let cutoff = Math.min(checkpoint.upToSequence, context.head);
    for (const outboxId of checkpoint.carryOver) {
      const [first] = await context.events.readDocumentEvents({ ...lookup, documentName: outboxId, limit: 1 });
      if (first !== undefined) {
        cutoff = Math.min(cutoff, first.sequence - 1);
      }
    }
    return Math.max(0, cutoff);
  }
};

export const DEFAULT_EVENT_ARCHIVE_CUT_POLICIES: readonly EventArchiveCutPolicy[] = [
  documentFoldCutPolicy,
  userNotificationsCutPolicy,
  deliveryOutboxCutPolicy
];

/**
 * Events left hot at the end of a stream after archiving, by default. A
 * document's timeline opens on its newest events; keeping a page of them hot
 * means opening an archived document does not touch R2 until someone scrolls.
 */
export const DEFAULT_EVENT_ARCHIVE_KEEP_HOT_EVENTS = 50;
/**
 * Smallest run worth a cold object. Below this the R2 operation and the index
 * row cost more than the D1 bytes they free.
 */
export const DEFAULT_EVENT_ARCHIVE_MIN_SEGMENT_EVENTS = 100;
export const DEFAULT_EVENT_ARCHIVE_PASS_LIMIT = 50;

export interface EventArchiveServiceOptions {
  /** An archive-aware store: policies read through it, cold events included. */
  readonly events: EventStore & AuditEventStore;
  readonly archive: EventArchive;
  /** The durable snapshot store the hot read paths resume from (D1 in production). */
  readonly snapshots: SnapshotStore;
  readonly policies?: readonly EventArchiveCutPolicy[];
  readonly keepHotEvents?: number;
  readonly minSegmentEvents?: number;
  readonly maxSegmentEvents?: number;
}

export type EventArchiveSkipReason =
  /** A naming-series or unique-value stream, or a name that is not a framework stream. */
  | "protected"
  /** No cut policy applies to this kind of stream. */
  | "no-policy"
  /** A policy applies but has nothing it can cut yet. */
  | "not-covered"
  /** Fewer than `minSegmentEvents` events between the archived prefix and the cut. */
  | "below-minimum";

export type EventArchiveStreamResult =
  | {
      readonly stream: StreamName;
      readonly status: "archived";
      readonly archivedThrough: number;
      readonly segments: number;
      readonly events: number;
    }
  | {
      readonly stream: StreamName;
      readonly status: "skipped";
      readonly reason: EventArchiveSkipReason;
      readonly archivedThrough: number;
    }
  | {
      readonly stream: StreamName;
      readonly status: "failed";
      readonly error: string;
    };

/** A stream restored in full, or the reason it was not; see `restorePass`. */
export type EventArchiveRestoreStreamResult =
  | (EventArchiveRestoreResult & { readonly status: "restored" })
  | {
      readonly stream: StreamName;
      readonly status: "failed";
      readonly error: string;
    };

export interface EventArchivePassResult<Result> {
  readonly results: readonly Result[];
  /** Pass as `after` to continue; absent once the scan has reached the end. */
  readonly next?: StreamName;
}

/**
 * Moves cold events to the archive and back (issue #18).
 *
 * This decides *what* to move — which streams, up to which sequence — and leaves
 * *how* to `EventArchive`, which holds the guarantees that no event is lost on
 * the way and that protected streams never move. Like a projection rebuild it is
 * externally paced: `archivePass` does one bounded batch of streams and returns
 * a cursor, and a Cron Trigger or a queue consumer decides when the next runs.
 *
 * Off unless constructed. Nothing in the framework archives on its own.
 */
export class EventArchiveService {
  private readonly policies: readonly EventArchiveCutPolicy[];
  private readonly keepHotEvents: number;
  private readonly minSegmentEvents: number;
  private readonly maxSegmentEvents: number | undefined;

  constructor(private readonly options: EventArchiveServiceOptions) {
    this.policies = options.policies ?? DEFAULT_EVENT_ARCHIVE_CUT_POLICIES;
    this.keepHotEvents = nonNegativeInteger(options.keepHotEvents ?? DEFAULT_EVENT_ARCHIVE_KEEP_HOT_EVENTS, "keepHotEvents");
    this.minSegmentEvents = Math.max(
      1,
      nonNegativeInteger(options.minSegmentEvents ?? DEFAULT_EVENT_ARCHIVE_MIN_SEGMENT_EVENTS, "minSegmentEvents")
    );
    this.maxSegmentEvents = options.maxSegmentEvents;
  }

  /**
   * Archives one stream as far as its policies allow, minus the hot tail.
   *
   * Every policy that applies must agree: the cut is the lowest of their
   * answers, so a stream folded two ways is only cut where both folds are
   * covered.
   */
  async archiveStream(stream: StreamName): Promise<EventArchiveStreamResult> {
    const parsed = parseStreamName(stream);
    if (parsed === null || !isArchivableStream(stream)) {
      return { stream, status: "skipped", reason: "protected", archivedThrough: 0 };
    }
    const policies = this.policies.filter((policy) => policy.appliesTo(parsed));
    if (policies.length === 0) {
      return { stream, status: "skipped", reason: "no-policy", archivedThrough: 0 };
    }
    try {
      const head = await this.options.events.currentVersion(stream);
      const context: EventArchiveCutContext = {
        stream,
        parsed,
        head,
        events: this.options.events,
        snapshots: this.options.snapshots
      };
      let covered = head;
      for (const policy of policies) {
        covered = Math.min(covered, Math.max(0, Math.floor(await policy.cutoff(context))));
      }
      const through = covered - this.keepHotEvents;
      const archivedBefore = await this.archivedThrough(stream);
      if (covered <= 0 || through <= archivedBefore) {
        return { stream, status: "skipped", reason: covered <= 0 ? "not-covered" : "below-minimum", archivedThrough: archivedBefore };
      }
      const moved = await this.options.archive.archive(stream, {
        through,
        minEvents: this.minSegmentEvents,
        ...(this.maxSegmentEvents === undefined ? {} : { maxSegmentEvents: this.maxSegmentEvents })
      });
      if (moved.segments.length === 0) {
        return { stream, status: "skipped", reason: "below-minimum", archivedThrough: moved.archivedThrough };
      }
      return {
        stream,
        status: "archived",
        archivedThrough: moved.archivedThrough,
        segments: moved.segments.length,
        events: moved.segments.reduce((total, segment) => total + segment.eventCount, 0)
      };
    } catch (error) {
      return { stream, status: "failed", error: errorMessage(error) };
    }
  }

  /**
   * One bounded batch: scans up to `limit` streams with enough hot events to be
   * worth a segment, in stream-name order after `after`, and archives each.
   *
   * A failure on one stream is recorded and the pass moves on. Every failure
   * mode of the archive leaves that stream's hot events in place, so the worst
   * a failed stream costs is staying hot until the next pass.
   */
  async archivePass(input: { readonly after?: StreamName; readonly limit?: number } = {}): Promise<
    EventArchivePassResult<EventArchiveStreamResult>
  > {
    const limit = passLimit(input.limit);
    const candidates = await this.options.archive.candidates({
      ...(input.after === undefined ? {} : { after: input.after }),
      limit,
      minHotEvents: this.minSegmentEvents + this.keepHotEvents
    });
    const results: EventArchiveStreamResult[] = [];
    for (const candidate of candidates) {
      results.push(await this.archiveStream(candidate.stream));
    }
    const last = candidates.at(-1);
    return { results, ...(candidates.length === limit && last !== undefined ? { next: last.stream } : {}) };
  }

  /** Moves a stream's archived events back to the hot database. */
  async restoreStream(stream: StreamName) {
    return this.options.archive.restore(stream);
  }

  /**
   * Restores up to `limit` archived streams. Run it to completion before
   * switching the archive off: a store without an archive refuses a stream
   * whose oldest events are missing, rather than reading half of it.
   *
   * Like `archivePass`, a failure on one stream is recorded and the pass moves
   * on, so one bad segment cannot stop the cursor short of the streams after
   * it. A failed restore leaves its segment archived and intact; the stream is
   * still listed by the next pass from the start, which is how an operator
   * knows the restore is not finished.
   */
  async restorePass(input: { readonly after?: StreamName; readonly limit?: number } = {}): Promise<
    EventArchivePassResult<EventArchiveRestoreStreamResult>
  > {
    const limit = passLimit(input.limit);
    const streams = await this.options.archive.archivedStreams({
      ...(input.after === undefined ? {} : { after: input.after }),
      limit
    });
    const results: EventArchiveRestoreStreamResult[] = [];
    for (const stream of streams) {
      try {
        results.push({ ...(await this.options.archive.restore(stream)), status: "restored" });
      } catch (error) {
        results.push({ stream, status: "failed", error: errorMessage(error) });
      }
    }
    const last = streams.at(-1);
    return { results, ...(streams.length === limit && last !== undefined ? { next: last } : {}) };
  }

  private async archivedThrough(stream: StreamName): Promise<number> {
    const segments = await this.options.archive.segments(stream);
    return segments.at(-1)?.seqEnd ?? 0;
  }
}

/**
 * Records `fold`'s snapshot of the stream at `context.head` and returns the
 * sequence the durable store confirms covering, capped at the head.
 *
 * Resumes from an existing snapshot when it decodes, so a stream archived
 * before folds only what arrived since. A snapshot the fold cannot consume is
 * treated as absent, the same rule the hot path follows.
 */
async function ensureFoldSnapshot<State>(context: EventArchiveCutContext, fold: StreamFold<State>): Promise<number> {
  if (context.head <= 0) {
    return 0;
  }
  const key = { stream: context.stream, foldName: fold.name, foldVersion: fold.version };
  const existing = await context.snapshots.read<unknown>(key);
  if (existing !== null && existing.uptoSequence >= context.head) {
    return context.head;
  }
  const kinds = fold.payloadKinds === undefined ? {} : { payloadKinds: fold.payloadKinds };
  let state: State | undefined;
  const prior = existing === null ? null : safeDecode(fold, existing.state);
  if (existing !== null && prior !== null) {
    try {
      state = fold.foldFrom(
        prior,
        await context.events.readStream(context.stream, {
          ...kinds,
          minSequence: existing.uptoSequence + 1,
          maxSequence: context.head
        })
      );
    } catch {
      state = undefined;
    }
  }
  if (state === undefined) {
    state = fold.foldFrom(null, await context.events.readStream(context.stream, { ...kinds, maxSequence: context.head }));
  }
  await context.snapshots.write<unknown>({ ...key, uptoSequence: context.head, state: fold.codec.encode(state) });
  // Read back rather than trusting the write: the store may have kept a newer
  // snapshot instead (newest wins), or dropped this one. Either way the cut is
  // what is actually there to resume from.
  const confirmed = await context.snapshots.read<unknown>(key);
  return confirmed === null ? 0 : Math.min(confirmed.uptoSequence, context.head);
}

function safeDecode<State>(fold: StreamFold<State>, stored: unknown): State | null {
  try {
    return fold.codec.decode(stored);
  } catch {
    return null;
  }
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FrameworkError("EVENT_ARCHIVE_INVALID", `'${name}' must be a non-negative integer`, { status: 400 });
  }
  return value;
}

function passLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_EVENT_ARCHIVE_PASS_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new FrameworkError("EVENT_ARCHIVE_INVALID", "'limit' must be an integer from 1 to 1000", { status: 400 });
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
