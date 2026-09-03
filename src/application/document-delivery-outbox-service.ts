import { notFound } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { documentDeliveryOutboxStream } from "../core/streams.js";
import {
  documentDeliveryOutboxCheckpoint,
  documentDeliveryOutboxEventType,
  documentDeliveryOutboxRecordId,
  DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  foldDocumentDeliveryOutbox,
  foldDocumentDeliveryOutboxFrom,
  foldDocumentDeliveryOutboxRecord,
  foldDocumentDeliveryOutboxRecordFrom,
  selectedDocumentDeliveryOutboxRecords,
  sortedDocumentDeliveryOutboxRecords,
  type DocumentDeliveryOutboxCheckpointPayload,
  type DocumentDeliveryOutboxEventPayload,
  type DocumentDeliveryOutboxRecord,
  type DocumentDeliveryOutboxState,
  type DocumentDeliveryOutboxTarget
} from "./document-delivery-outbox-events.js";
import type {
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../core/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { AuditEventStore } from "../ports/audit-event-store.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import {
  claimableDocumentDeliveryOutboxRecords,
  documentDeliveryOutboxClaimLimit,
  documentDeliveryOutboxFailureError,
  documentDeliveryOutboxPayload,
  documentDeliveryOutboxRecordLookup,
  ensureDocumentDeliveryOutboxClaimed
} from "./document-delivery-outbox-service-policy.js";
import { isDocumentConflictError } from "./concurrency-policy.js";

export type {
  DocumentDeliveryOutboxEventPayload,
  DocumentDeliveryOutboxRecord,
  DocumentDeliveryOutboxStatus,
  DocumentDeliveryOutboxTarget
} from "./document-delivery-outbox-events.js";

const MAX_OUTBOX_APPEND_ATTEMPTS = 5;

const OUTBOX_DOCTYPE = "__DocumentDeliveryOutbox";

/**
 * Most in-flight records a compaction checkpoint will carry.
 *
 * Above this, no checkpoint is written and the tenant's reads go back to
 * folding the whole stream — the pre-#28 cost. The alternative is a checkpoint
 * whose payload grows with the backlog and a `state()` that issues one indexed
 * read per carried id; at the default claim limit (25) a drain already holds
 * 25 in flight, so this is the point where "bounded" stops being true either
 * way and the honest answer is to stop compacting rather than to hide the cost
 * in a wide event.
 */
const DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_CARRY_OVER_LIMIT = 25;

export interface DocumentDeliveryOutboxServiceOptions {
  /**
   * Also an {@link AuditEventStore}: idempotency and terminal-state lookups read
   * one record's events out of the shared outbox stream rather than folding the
   * whole tenant history. Every concrete store already implements both.
   */
  readonly events: EventStore & AuditEventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
}

export interface EnqueueDocumentDeliveryOutboxCommand {
  readonly event: DomainEvent;
  readonly snapshot?: DocumentSnapshot | null;
  readonly targets: readonly DocumentDeliveryOutboxTarget[];
  readonly metadata?: DocumentData;
}

export interface ClaimDocumentDeliveryOutboxCommand {
  readonly tenantId: TenantId;
  readonly claimId?: string;
  readonly limit?: number;
  readonly now?: string;
}

export interface CompleteDocumentDeliveryOutboxCommand {
  readonly tenantId: TenantId;
  readonly outboxId: string;
  readonly claimId: string;
  readonly metadata?: DocumentData;
}

export interface FailDocumentDeliveryOutboxCommand extends CompleteDocumentDeliveryOutboxCommand {
  readonly error: string;
  readonly retryAt?: string;
}

export class DocumentDeliveryOutboxService {
  private readonly events: EventStore & AuditEventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;

  constructor(options: DocumentDeliveryOutboxServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
  }

  async enqueueFromDomainEvent(
    command: EnqueueDocumentDeliveryOutboxCommand
  ): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    if (command.targets.length === 0) {
      return [];
    }
    const uniqueTargets = [...new Set(command.targets)];
    return this.appendWithRetry(command.event.tenantId, async (state) => {
      const recordIds = uniqueTargets.map((target) => documentDeliveryOutboxRecordId(command.event.id, target));
      // Deduplicate against the events, not just the folded state: the
      // after-commit hook that calls this can run again with the same source
      // event id (an interrupted Worker, an at-least-once queue), and the record
      // leaves the working set once it is delivered — so the check has to
      // outlive it there.
      //
      // This has to be inside the plan callback, which runs once per append
      // attempt. Taken before the retry loop it would be stale in exactly the
      // case that matters: a competitor committing the same record is what
      // caused the conflict being retried.
      const enqueued = new Set(
        (
          await Promise.all(
            recordIds.map(async (outboxId) => {
              const existing = await this.events.readDocumentEvents({
                tenantId: command.event.tenantId,
                doctype: OUTBOX_DOCTYPE,
                documentName: outboxId,
                stream: documentDeliveryOutboxStream(command.event.tenantId),
                limit: 1
              });
              return existing.length > 0 ? outboxId : undefined;
            })
          )
        ).filter((outboxId): outboxId is string => outboxId !== undefined)
      );
      const events = uniqueTargets
        .map((target): NewDomainEvent | undefined => {
          const outboxId = documentDeliveryOutboxRecordId(command.event.id, target);
          if (enqueued.has(outboxId)) {
            return undefined;
          }
          const payload: DocumentDeliveryOutboxEventPayload = {
            kind: "DocumentDeliveryOutboxEnqueued",
            outboxId,
            target,
            sourceEventId: command.event.id,
            sourceEventType: command.event.type,
            payloadKind: domainEventPayloadKind(command.event),
            doctype: command.event.doctype,
            documentName: command.event.documentName,
            actorId: command.event.actorId,
            payload: documentDeliveryOutboxPayload(command.event, command.snapshot)
          };
          return {
            id: this.ids.next("evt_"),
            tenantId: command.event.tenantId,
            stream: documentDeliveryOutboxStream(command.event.tenantId),
            type: documentDeliveryOutboxEventType(payload),
            doctype: "__DocumentDeliveryOutbox",
            documentName: outboxId,
            actorId: command.event.actorId,
            occurredAt: command.event.occurredAt,
            payload,
            metadata: command.metadata ?? {}
          };
        })
        .filter((event): event is NewDomainEvent => event !== undefined);
      if (events.length === 0) {
        return { events, state, recordIds };
      }
      return { events, recordIds };
    });
  }

  async claimPending(command: ClaimDocumentDeliveryOutboxCommand): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    const now = command.now ?? this.clock.now();
    const claimId = command.claimId ?? this.ids.next("claim_");
    const limit = documentDeliveryOutboxClaimLimit(command.limit);
    return this.appendWithRetry(command.tenantId, async (state) => {
      const records = claimableDocumentDeliveryOutboxRecords(state, now, limit);
      const recordIds = records.map((record) => record.id);
      const events = records.map((record): NewDomainEvent => {
        const payload: DocumentDeliveryOutboxEventPayload = {
          kind: "DocumentDeliveryOutboxClaimed",
          outboxId: record.id,
          claimId
        };
        return {
          id: this.ids.next("evt_"),
          tenantId: command.tenantId,
          stream: documentDeliveryOutboxStream(command.tenantId),
          type: documentDeliveryOutboxEventType(payload),
          doctype: "__DocumentDeliveryOutbox",
          documentName: record.id,
          actorId: "system",
          occurredAt: now,
          payload,
          metadata: {}
        };
      });
      return { events, recordIds };
    });
  }

  async markDelivered(command: CompleteDocumentDeliveryOutboxCommand): Promise<DocumentDeliveryOutboxRecord> {
    const [record] = await this.appendTerminalEvent(command, "DocumentDeliveryOutboxDelivered");
    // The record leaves the working set in the same commit that delivers it, so
    // the post-append fold cannot return it — read it back from its own events.
    // This is also the path a redelivery takes: `appendTerminalEvent` appends
    // nothing when the record already finished.
    return (
      record ??
      (await this.deliveredRecord(command.tenantId, command.outboxId)) ??
      this.requireRecord(await this.state(command.tenantId), command.outboxId)
    );
  }

  /**
   * The record for `outboxId` once it has been delivered and left the working
   * set, or undefined while it is still in flight or was never enqueued. Reads
   * one record's events, so it stays bounded as outbox history grows.
   */
  private async deliveredRecord(
    tenantId: TenantId,
    outboxId: string
  ): Promise<DocumentDeliveryOutboxRecord | undefined> {
    const record = await this.record(tenantId, outboxId);
    return record !== null && record.status === "delivered" ? record : undefined;
  }

  async markFailed(command: FailDocumentDeliveryOutboxCommand): Promise<DocumentDeliveryOutboxRecord> {
    const normalizedError = documentDeliveryOutboxFailureError(command.error);
    const [record] = await this.appendWithRetry(command.tenantId, async (state) => {
      const existing = this.requireRecord(state, command.outboxId);
      ensureDocumentDeliveryOutboxClaimed(existing, command.claimId);
      const payload: DocumentDeliveryOutboxEventPayload = {
        kind: "DocumentDeliveryOutboxFailed",
        outboxId: command.outboxId,
        claimId: command.claimId,
        error: normalizedError,
        ...(command.retryAt === undefined ? {} : { retryAt: command.retryAt })
      };
      return {
        recordIds: [command.outboxId],
        events: [{
          id: this.ids.next("evt_"),
          tenantId: command.tenantId,
          stream: documentDeliveryOutboxStream(command.tenantId),
          type: documentDeliveryOutboxEventType(payload),
          doctype: "__DocumentDeliveryOutbox",
          documentName: command.outboxId,
          actorId: "system",
          occurredAt: this.clock.now(),
          payload,
          metadata: command.metadata ?? {}
        }]
      };
    });
    return record ?? this.requireRecord(await this.state(command.tenantId), command.outboxId);
  }

  /**
   * The tenant's in-flight records: pending, claimed and failed.
   *
   * Delivered records are deliberately absent — they leave the working set so
   * it stays bounded (#28). Read one of those back with {@link record}.
   */
  async list(tenantId: TenantId): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    return sortedDocumentDeliveryOutboxRecords(await this.state(tenantId));
  }

  /**
   * One record in whatever state its own events describe, delivered included.
   *
   * Reads that record's events rather than the tenant's, so cost does not grow
   * with delivery history.
   */
  async record(tenantId: TenantId, outboxId: string): Promise<DocumentDeliveryOutboxRecord | null> {
    return foldDocumentDeliveryOutboxRecord(
      tenantId,
      outboxId,
      await this.events.readDocumentEvents({
        tenantId,
        doctype: OUTBOX_DOCTYPE,
        documentName: outboxId,
        stream: documentDeliveryOutboxStream(tenantId)
      })
    );
  }

  private async appendTerminalEvent(
    command: CompleteDocumentDeliveryOutboxCommand,
    kind: "DocumentDeliveryOutboxDelivered"
  ): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    return this.appendWithRetry(command.tenantId, async (state, attempt) => {
      const lookup = documentDeliveryOutboxRecordLookup(state, command.outboxId);
      if (lookup.status === "missing") {
        // Absent from the working set means one of two things, and only the
        // record's own events can tell them apart: it already finished and left,
        // or it never existed. Delivering twice is success — an at-least-once
        // consumer handed a notFound here would retry forever — while a
        // genuinely unknown record still has to fail.
        //
        // This runs once per append attempt, on purpose. Decided before the
        // retry loop it would be stale in exactly the case that matters: the
        // competitor that delivered the record is what caused the conflict.
        if ((await this.record(command.tenantId, command.outboxId))?.status === "delivered") {
          return { events: [], state, recordIds: [] };
        }
        throw notFound(lookup.message);
      }
      const existing = lookup.record;
      ensureDocumentDeliveryOutboxClaimed(existing, command.claimId);
      const payload: DocumentDeliveryOutboxEventPayload = {
        kind,
        outboxId: command.outboxId,
        claimId: command.claimId
      };
      return {
        recordIds: [command.outboxId],
        events: [
          // The checkpoint goes FIRST, in the same commit as the delivery.
          //
          // Same commit, because that is what makes "a checkpoint conflict is
          // not a delivery failure" true by construction: one CAS, and a
          // conflict re-runs this callback against fresh state, recomputing the
          // checkpoint rather than committing a stale one. A separate append
          // would need its own retry loop and a swallow-on-conflict rule.
          //
          // First, because the checkpoint summarises `state.version` — the head
          // before this commit — so it lands at `upToSequence + 1`. A reader
          // resuming at `upToSequence + 1` therefore starts *on* the checkpoint
          // and the delivered event that follows it is inside the tail. Put it
          // second and the delivery sits at `upToSequence + 1`, outside a read
          // that begins at the checkpoint, and the record it terminates would be
          // rehydrated from `carryOver` as still in flight.
          ...this.plannedCheckpoint(command.tenantId, state, attempt),
          {
            id: this.ids.next("evt_"),
            tenantId: command.tenantId,
            stream: documentDeliveryOutboxStream(command.tenantId),
            type: documentDeliveryOutboxEventType(payload),
            doctype: "__DocumentDeliveryOutbox",
            documentName: command.outboxId,
            actorId: "system",
            occurredAt: this.clock.now(),
            payload,
            metadata: command.metadata ?? {}
          }
        ]
      };
    });
  }

  /**
   * The compaction checkpoint to commit alongside a delivery, or nothing.
   *
   * `upToSequence` is `state.version` and `carryOver` is every record the
   * working set still holds at that version, so the claim it makes is true by
   * construction rather than by arithmetic: `state.records` *is* the in-flight
   * set at `state.version`, and a reader that rehydrates those ids and folds
   * from `state.version + 1` reconstructs exactly this state. Nothing here
   * depends on which sequence the delivered event lands on.
   */
  private plannedCheckpoint(
    tenantId: TenantId,
    state: DocumentDeliveryOutboxState,
    attempt: number
  ): readonly NewDomainEvent[] {
    if (attempt >= MAX_OUTBOX_APPEND_ATTEMPTS) {
      // Last chance to deliver: commit the delivery on its own. A checkpoint is
      // an optimisation and must never be the reason a delivery fails — not
      // even for a reason bundling does not cover, such as its derived id
      // colliding with a row already in the events table.
      return [];
    }
    if (state.records.size > DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_CARRY_OVER_LIMIT) {
      return [];
    }
    const payload: DocumentDeliveryOutboxEventPayload = {
      kind: "DocumentDeliveryOutboxCheckpointed",
      upToSequence: state.version,
      carryOver: [...state.records.keys()]
    };
    return [
      {
        // Derived, not drawn from the id generator: every outbox test hands
        // `deterministicIds` an exactly-sized list, and consuming an id here
        // would exhaust all of them. Uniqueness comes from the CAS — at most
        // one commit can succeed at a given `state.version`, so no two
        // checkpoints in a stream can share an `upToSequence` — which is also
        // why checkpoints make strict progress without tracking the last one.
        id: `evt_outbox_checkpoint_${tenantId}_${String(state.version)}`,
        tenantId,
        stream: documentDeliveryOutboxStream(tenantId),
        type: documentDeliveryOutboxEventType(payload),
        doctype: OUTBOX_DOCTYPE,
        documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
        actorId: "system",
        occurredAt: this.clock.now(),
        payload,
        metadata: {}
      }
    ];
  }

  private requireRecord(state: DocumentDeliveryOutboxState, outboxId: string): DocumentDeliveryOutboxRecord {
    const decision = documentDeliveryOutboxRecordLookup(state, outboxId);
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    return decision.record;
  }

  private async appendWithRetry(
    tenantId: TenantId,
    plan: (
      state: DocumentDeliveryOutboxState,
      /** 1-based, so a plan can drop optional events on the final attempt. */
      attempt: number
    ) => Promise<{
      readonly events: readonly NewDomainEvent[];
      readonly recordIds?: readonly string[];
      readonly state?: DocumentDeliveryOutboxState;
    }>
  ): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    const stream = documentDeliveryOutboxStream(tenantId);
    for (let attempt = 1; attempt <= MAX_OUTBOX_APPEND_ATTEMPTS; attempt += 1) {
      const state = await this.state(tenantId);
      const planned = await plan(state, attempt);
      if (planned.events.length === 0) {
        return selectedDocumentDeliveryOutboxRecords(planned.state ?? state, planned.recordIds);
      }
      try {
        const saved = await this.events.append(stream, state.version, planned.events);
        // `state` was folded from exactly the events this used to re-read, so
        // resume from it rather than reading and folding the stream a second
        // time on every outbox operation. See issue #28.
        return selectedDocumentDeliveryOutboxRecords(
          foldDocumentDeliveryOutboxFrom(state, tenantId, saved),
          planned.recordIds
        );
      } catch (error) {
        if (isDocumentConflictError(error) && attempt < MAX_OUTBOX_APPEND_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unreachable document delivery outbox append retry state");
  }

  /**
   * The tenant's in-flight working set, resumed from the last compaction
   * checkpoint rather than from the start of the stream.
   *
   * Without a checkpoint this folds the whole stream, which is what every
   * operation used to do: measured 87 / 177 / 267 / 357 events read per
   * enqueue+claim+deliver round at rounds 10 / 20 / 30 / 40 (#28). With one it
   * reads the checkpoint (one indexed row), the tail after it, and one indexed
   * read per carried-over id — a flat 24 events per round, and a flat 33 with a
   * permanently failing record pinned in flight. The trade is round trips: 11
   * reads per round rather than 5.
   */
  private async state(tenantId: TenantId): Promise<DocumentDeliveryOutboxState> {
    const stream = documentDeliveryOutboxStream(tenantId);
    const checkpoint = await this.lastCheckpoint(tenantId, stream);
    if (checkpoint === null) {
      return foldDocumentDeliveryOutbox(
        tenantId,
        await this.events.readStream(stream, { payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS })
      );
    }
    return foldDocumentDeliveryOutboxFrom(
      {
        tenantId,
        version: checkpoint.upToSequence,
        records: await this.carriedOverRecords(tenantId, checkpoint)
      },
      tenantId,
      // Inclusive lower bound of `upToSequence + 1`, which is the checkpoint's
      // own sequence — so the checkpoint is inside this read and folds
      // `state.version` up to the true stream head even when it is the last
      // event in the stream. Using the checkpoint event's own sequence as the
      // bound instead would be an off-by-one in the other direction and would
      // drop the delivery that wrote it.
      await this.events.readStream(stream, {
        minSequence: checkpoint.upToSequence + 1,
        payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS
      })
    );
  }

  /**
   * The newest compaction checkpoint in the tenant's outbox stream, or null.
   *
   * Reads exactly one row. The checkpoint is written under a `documentName`
   * sentinel no outbox id can take, so
   * `idx_cf_frappe_events_document_name` reaches it directly: 2.0 µs on a
   * 50k-event stream, and 0.6 µs when the stream has no checkpoint at all
   * because that is an empty index range rather than a scan. Filtering on the
   * `type` column or on the payload kind instead costs 6–14 ms in that second
   * case — a full backwards scan on every operation, which is the state every
   * already-deployed stream starts in.
   */
  private async lastCheckpoint(
    tenantId: TenantId,
    stream: StreamName
  ): Promise<DocumentDeliveryOutboxCheckpointPayload | null> {
    const [newest] = await this.events.readDocumentEvents({
      tenantId,
      doctype: OUTBOX_DOCTYPE,
      documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
      stream,
      order: "desc",
      limit: 1
    });
    return newest === undefined ? null : documentDeliveryOutboxCheckpoint(newest);
  }

  /**
   * Rehydrates the records a checkpoint carried past its own compaction point.
   *
   * This is what keeps a permanently failing target from pinning history:
   * `claimableDocumentDeliveryOutboxRecords` re-claims the oldest in-flight
   * record first, so a poison record stays the oldest forever, and a checkpoint
   * that had to wait for it would never advance past its enqueue sequence.
   * Carrying the id instead costs one indexed read (2.0 µs at 50k events).
   */
  /**
   * The carried-over records **as of the checkpoint**, ready for the tail fold
   * to replay the rest onto.
   *
   * Two facts are needed per record and they come from one read:
   *
   * - **State at `upToSequence`.** Only the prefix the checkpoint covers is
   *   folded, because `state()` replays everything after it. Folding the whole
   *   history here applied those later events twice, and
   *   `DocumentDeliveryOutboxClaimed` is the one case in the fold that is not
   *   idempotent — so `attempts` came out inflated by the number of claims
   *   sitting above the newest checkpoint, growing with checkpoint spacing.
   *   `list()` and {@link record} then disagreed about the same record, and
   *   `documentDeliveryOutboxRetryAt` reads that number to back off.
   * - **Whether it has finished since.** The full history decides that. A
   *   carried record can finish between this read and the tail read — a
   *   concurrent writer, or this read racing its own tail — and the working set
   *   holds in-flight records only, so a torn read must not surface a delivered
   *   record from `list()` in the window before the tail fold drops it.
   *
   * Bounding the read alone is not enough for the second point, which is why
   * both folds run over the same events rather than the prefix being read on
   * its own.
   */
  private async carriedOverRecords(
    tenantId: TenantId,
    checkpoint: DocumentDeliveryOutboxCheckpointPayload
  ): Promise<ReadonlyMap<string, DocumentDeliveryOutboxRecord>> {
    const records = new Map<string, DocumentDeliveryOutboxRecord>();
    const histories = await Promise.all(
      checkpoint.carryOver.map(async (outboxId) => ({
        outboxId,
        events: await this.events.readDocumentEvents({
          tenantId,
          doctype: OUTBOX_DOCTYPE,
          documentName: outboxId,
          stream: documentDeliveryOutboxStream(tenantId)
        })
      }))
    );
    for (const { outboxId, events } of histories) {
      const atCheckpoint = foldDocumentDeliveryOutboxRecord(
        tenantId,
        outboxId,
        events.filter((event) => event.sequence <= checkpoint.upToSequence)
      );
      if (atCheckpoint === null) {
        continue;
      }
      const current = foldDocumentDeliveryOutboxRecordFrom(
        atCheckpoint,
        tenantId,
        outboxId,
        events.filter((event) => event.sequence > checkpoint.upToSequence)
      );
      if (current !== null && current.status !== "delivered") {
        records.set(atCheckpoint.id, atCheckpoint);
      }
    }
    return records;
  }
}
