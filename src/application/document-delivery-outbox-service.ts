import { notFound } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { documentDeliveryOutboxStream } from "../core/streams.js";
import {
  documentDeliveryOutboxEventType,
  documentDeliveryOutboxRecordId,
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  foldDocumentDeliveryOutbox,
  foldDocumentDeliveryOutboxFrom,
  foldDocumentDeliveryOutboxRecord,
  selectedDocumentDeliveryOutboxRecords,
  sortedDocumentDeliveryOutboxRecords,
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
    return this.appendWithRetry(command.tenantId, async (state) => {
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
      state: DocumentDeliveryOutboxState
    ) => Promise<{
      readonly events: readonly NewDomainEvent[];
      readonly recordIds?: readonly string[];
      readonly state?: DocumentDeliveryOutboxState;
    }>
  ): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    const stream = documentDeliveryOutboxStream(tenantId);
    for (let attempt = 1; attempt <= MAX_OUTBOX_APPEND_ATTEMPTS; attempt += 1) {
      const state = await this.state(tenantId);
      const planned = await plan(state);
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

  private async state(tenantId: TenantId): Promise<DocumentDeliveryOutboxState> {
    return foldDocumentDeliveryOutbox(
      tenantId,
      await this.events.readStream(documentDeliveryOutboxStream(tenantId), {
        payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS
      })
    );
  }
}
