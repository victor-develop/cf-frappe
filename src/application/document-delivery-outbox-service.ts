import { badRequest, conflict, notFound } from "../core/errors.js";
import { documentDeliveryOutboxStream } from "../core/streams.js";
import type { DocumentDeliveryOutboxTarget } from "./document-delivery-outbox-events.js";
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

export type { DocumentDeliveryOutboxEventPayload, DocumentDeliveryOutboxTarget } from "./document-delivery-outbox-events.js";

const MAX_OUTBOX_APPEND_ATTEMPTS = 5;
const DEFAULT_CLAIM_LIMIT = 25;
const MAX_CLAIM_LIMIT = 100;

export type DocumentDeliveryOutboxStatus = "pending" | "claimed" | "delivered" | "failed";

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

export interface DocumentDeliveryOutboxRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly target: DocumentDeliveryOutboxTarget;
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly payloadKind: string;
  readonly doctype: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly payload: DocumentData;
  readonly status: DocumentDeliveryOutboxStatus;
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly claimedAt?: string;
  readonly claimId?: string;
  readonly deliveredAt?: string;
  readonly failedAt?: string;
  readonly error?: string;
  readonly retryAt?: string;
}

interface DocumentDeliveryOutboxState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly records: ReadonlyMap<string, DocumentDeliveryOutboxRecord>;
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
      const recordIds = uniqueTargets.map((target) => outboxRecordId(command.event.id, target));
      const events = uniqueTargets
        .map((target): NewDomainEvent | undefined => {
          const outboxId = outboxRecordId(command.event.id, target);
          if (state.records.has(outboxId)) {
            return undefined;
          }
          return {
            id: this.ids.next("evt_"),
            tenantId: command.event.tenantId,
            stream: documentDeliveryOutboxStream(command.event.tenantId),
            type: "DocumentDeliveryOutboxEnqueued",
            doctype: "__DocumentDeliveryOutbox",
            documentName: outboxId,
            actorId: command.event.actorId,
            occurredAt: command.event.occurredAt,
            payload: {
              kind: "DocumentDeliveryOutboxEnqueued",
              outboxId,
              target,
              sourceEventId: command.event.id,
              sourceEventType: command.event.type,
              payloadKind: command.event.payload.kind,
              doctype: command.event.doctype,
              documentName: command.event.documentName,
              actorId: command.event.actorId,
              payload: outboxPayload(command.event, command.snapshot)
            },
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
    const limit = normalizeClaimLimit(command.limit);
    return this.appendWithRetry(command.tenantId, async (state) => {
      const records = [...state.records.values()]
        .filter((record) => record.status === "pending" || (record.status === "failed" && retryDue(record, now)))
        .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id))
        .slice(0, limit);
      const recordIds = records.map((record) => record.id);
      const events = records.map((record): NewDomainEvent => ({
        id: this.ids.next("evt_"),
        tenantId: command.tenantId,
        stream: documentDeliveryOutboxStream(command.tenantId),
        type: "DocumentDeliveryOutboxClaimed",
        doctype: "__DocumentDeliveryOutbox",
        documentName: record.id,
        actorId: "system",
        occurredAt: now,
        payload: {
          kind: "DocumentDeliveryOutboxClaimed",
          outboxId: record.id,
          claimId
        },
        metadata: {}
      }));
      return { events, recordIds };
    });
  }

  async markDelivered(command: CompleteDocumentDeliveryOutboxCommand): Promise<DocumentDeliveryOutboxRecord> {
    const [record] = await this.appendTerminalEvent(command, "DocumentDeliveryOutboxDelivered");
    return record ?? this.requireRecord(await this.state(command.tenantId), command.outboxId);
  }

  async markFailed(command: FailDocumentDeliveryOutboxCommand): Promise<DocumentDeliveryOutboxRecord> {
    const normalizedError = command.error.trim();
    if (normalizedError.length === 0) {
      throw badRequest("Delivery failure error is required");
    }
    const [record] = await this.appendWithRetry(command.tenantId, async (state) => {
      const existing = this.requireRecord(state, command.outboxId);
      ensureClaimed(existing, command.claimId);
      return {
        recordIds: [command.outboxId],
        events: [{
          id: this.ids.next("evt_"),
          tenantId: command.tenantId,
          stream: documentDeliveryOutboxStream(command.tenantId),
          type: "DocumentDeliveryOutboxFailed",
          doctype: "__DocumentDeliveryOutbox",
          documentName: command.outboxId,
          actorId: "system",
          occurredAt: this.clock.now(),
          payload: {
            kind: "DocumentDeliveryOutboxFailed",
            outboxId: command.outboxId,
            claimId: command.claimId,
            error: normalizedError,
            ...(command.retryAt === undefined ? {} : { retryAt: command.retryAt })
          },
          metadata: command.metadata ?? {}
        }]
      };
    });
    return record ?? this.requireRecord(await this.state(command.tenantId), command.outboxId);
  }

  async list(tenantId: TenantId): Promise<readonly DocumentDeliveryOutboxRecord[]> {
    return sortedRecords(await this.state(tenantId));
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
      ensureClaimed(existing, command.claimId);
      return {
        recordIds: [command.outboxId],
        events: [{
          id: this.ids.next("evt_"),
          tenantId: command.tenantId,
          stream: documentDeliveryOutboxStream(command.tenantId),
          type: kind,
          doctype: "__DocumentDeliveryOutbox",
          documentName: command.outboxId,
          actorId: "system",
          occurredAt: this.clock.now(),
          payload: {
            kind,
            outboxId: command.outboxId,
            claimId: command.claimId
          },
          metadata: command.metadata ?? {}
        }]
      };
    });
  }

  private requireRecord(state: DocumentDeliveryOutboxState, outboxId: string): DocumentDeliveryOutboxRecord {
    const record = state.records.get(outboxId);
    if (!record) {
      throw notFound(`Document delivery outbox record '${outboxId}' was not found`);
    }
    return record;
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
        return selectedRecords(planned.state ?? state, planned.recordIds);
      }
      try {
        const saved = await this.events.append(stream, state.version, planned.events);
        return selectedRecords(foldDocumentDeliveryOutbox(tenantId, [
          ...(await this.events.readStream(stream, { maxSequence: state.version })),
          ...saved
        ]), planned.recordIds);
      } catch (error) {
        if (isStreamConflict(error) && attempt < MAX_OUTBOX_APPEND_ATTEMPTS) {
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
      await this.events.readStream(documentDeliveryOutboxStream(tenantId))
    );
  }
}

export function foldDocumentDeliveryOutbox(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): DocumentDeliveryOutboxState {
  const records = new Map<string, DocumentDeliveryOutboxRecord>();
  let version = 0;
  for (const event of events) {
    version = Math.max(version, event.sequence);
    switch (event.payload.kind) {
      case "DocumentDeliveryOutboxEnqueued":
        records.set(event.payload.outboxId, {
          id: event.payload.outboxId,
          tenantId,
          target: event.payload.target,
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          doctype: event.payload.doctype,
          documentName: event.payload.documentName,
          actorId: event.payload.actorId,
          payload: event.payload.payload ?? {},
          status: "pending",
          attempts: 0,
          enqueuedAt: event.occurredAt
        });
        break;
      case "DocumentDeliveryOutboxClaimed": {
        const current = records.get(event.payload.outboxId);
        if (current) {
          const { error: _error, retryAt: _retryAt, ...claimable } = current;
          records.set(current.id, {
            ...claimable,
            status: "claimed",
            attempts: current.attempts + 1,
            claimId: event.payload.claimId,
            claimedAt: event.occurredAt
          });
        }
        break;
      }
      case "DocumentDeliveryOutboxDelivered": {
        const current = records.get(event.payload.outboxId);
        if (current) {
          const { error: _error, retryAt: _retryAt, ...deliverable } = current;
          records.set(current.id, {
            ...deliverable,
            status: "delivered",
            claimId: event.payload.claimId,
            deliveredAt: event.occurredAt
          });
        }
        break;
      }
      case "DocumentDeliveryOutboxFailed": {
        const current = records.get(event.payload.outboxId);
        if (current) {
          records.set(current.id, {
            ...current,
            status: "failed",
            claimId: event.payload.claimId,
            failedAt: event.occurredAt,
            error: event.payload.error,
            ...(event.payload.retryAt === undefined ? {} : { retryAt: event.payload.retryAt })
          });
        }
        break;
      }
    }
  }
  return { tenantId, version, records };
}

function outboxRecordId(eventId: string, target: DocumentDeliveryOutboxTarget): string {
  return `${eventId}:${target}`;
}

function outboxPayload(event: DomainEvent, snapshot: DocumentSnapshot | null | undefined): DocumentData {
  return {
    event: event as unknown as DocumentData,
    ...(snapshot === undefined || snapshot === null ? {} : { snapshot: snapshot as unknown as DocumentData })
  };
}

function normalizeClaimLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_CLAIM_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_CLAIM_LIMIT) {
    throw badRequest(`Delivery outbox claim limit must be an integer between 1 and ${String(MAX_CLAIM_LIMIT)}`);
  }
  return limit;
}

function ensureClaimed(record: DocumentDeliveryOutboxRecord, claimId: string): void {
  if (record.status !== "claimed" || record.claimId !== claimId) {
    throw conflict(`Document delivery outbox record '${record.id}' is not claimed by '${claimId}'`);
  }
}

function retryDue(record: DocumentDeliveryOutboxRecord, now: string): boolean {
  return record.retryAt === undefined || record.retryAt <= now;
}

function sortedRecords(state: DocumentDeliveryOutboxState): readonly DocumentDeliveryOutboxRecord[] {
  return [...state.records.values()].sort(
    (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id)
  );
}

function selectedRecords(
  state: DocumentDeliveryOutboxState,
  recordIds: readonly string[] | undefined
): readonly DocumentDeliveryOutboxRecord[] {
  if (recordIds === undefined) {
    return sortedRecords(state);
  }
  return recordIds.flatMap((id) => {
    const record = state.records.get(id);
    return record ? [record] : [];
  });
}

function isStreamConflict(error: unknown): boolean {
  return error instanceof Error && (error as { readonly code?: string }).code === "DOCUMENT_CONFLICT";
}
