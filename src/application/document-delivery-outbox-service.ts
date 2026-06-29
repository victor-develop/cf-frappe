import { notFound } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { documentDeliveryOutboxStream } from "../core/streams.js";
import {
  documentDeliveryOutboxEventType,
  documentDeliveryOutboxRecordId,
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  foldDocumentDeliveryOutbox,
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

export interface DocumentDeliveryOutboxServiceOptions {
  readonly events: EventStore;
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
  private readonly events: EventStore;
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
    return this.appendWithRetry(command.event.tenantId, async (state) => {
      const uniqueTargets = [...new Set(command.targets)];
      const recordIds = uniqueTargets.map((target) => documentDeliveryOutboxRecordId(command.event.id, target));
      const events = uniqueTargets
        .map((target): NewDomainEvent | undefined => {
          const outboxId = documentDeliveryOutboxRecordId(command.event.id, target);
          if (state.records.has(outboxId)) {
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
    return record ?? this.requireRecord(await this.state(command.tenantId), command.outboxId);
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

  async list(tenantId: TenantId): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    return sortedDocumentDeliveryOutboxRecords(await this.state(tenantId));
  }

  private async appendTerminalEvent(
    command: CompleteDocumentDeliveryOutboxCommand,
    kind: "DocumentDeliveryOutboxDelivered"
  ): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    return this.appendWithRetry(command.tenantId, async (state) => {
      const existing = this.requireRecord(state, command.outboxId);
      if (existing.status === "delivered") {
        return { events: [], state, recordIds: [command.outboxId] };
      }
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
        return selectedDocumentDeliveryOutboxRecords(foldDocumentDeliveryOutbox(tenantId, [
          ...(await this.events.readStream(stream, {
            maxSequence: state.version,
            payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS
          })),
          ...saved
        ]), planned.recordIds);
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
