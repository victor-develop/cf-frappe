import { badRequest, notFound } from "../core/errors.js";
import { realtimeEventFromDomainEvent, realtimeUserNotificationsFromDomainEvent } from "../core/realtime.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, TenantId } from "../core/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { RealtimePublisher } from "../ports/realtime.js";
import type {
  DocumentDeliveryOutboxRecord,
  DocumentDeliveryOutboxTarget
} from "./document-delivery-outbox-service.js";
import type { EmailNotificationDeliveryQueue } from "./realtime.js";

const DEFAULT_DRAIN_LIMIT = 25;
const MAX_DRAIN_LIMIT = 100;
const DEFAULT_RETRY_BASE_DELAY_SECONDS = 30;
const DEFAULT_RETRY_MAX_DELAY_SECONDS = 1_800;

export const DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME = "cf-frappe.document-delivery-outbox.drain";

export interface DocumentDeliveryOutboxConsumerOutbox {
  claimPending(command: {
    readonly tenantId: TenantId;
    readonly claimId?: string;
    readonly limit?: number;
    readonly now?: string;
  }): Promise<readonly DocumentDeliveryOutboxRecord[]>;
  markDelivered(command: {
    readonly tenantId: TenantId;
    readonly outboxId: string;
    readonly claimId: string;
    readonly metadata?: DocumentData;
  }): Promise<DocumentDeliveryOutboxRecord>;
  markFailed(command: {
    readonly tenantId: TenantId;
    readonly outboxId: string;
    readonly claimId: string;
    readonly error: string;
    readonly retryAt?: string;
    readonly metadata?: DocumentData;
  }): Promise<DocumentDeliveryOutboxRecord>;
}

export interface DocumentDeliveryOutboxDeliveryHandler {
  deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData | void>;
}

export type DocumentDeliveryOutboxDeliveryHandlers = Readonly<
  Partial<Record<DocumentDeliveryOutboxTarget, DocumentDeliveryOutboxDeliveryHandler>>
>;

export interface DocumentDeliveryOutboxConsumerOptions {
  readonly outbox: DocumentDeliveryOutboxConsumerOutbox;
  readonly deliveries: DocumentDeliveryOutboxDeliveryHandlers;
  readonly clock?: Clock;
  readonly retry?: {
    readonly baseDelaySeconds?: number;
    readonly maxDelaySeconds?: number;
  };
}

export interface DrainDocumentDeliveryOutboxCommand {
  readonly tenantId: TenantId;
  readonly claimId?: string;
  readonly limit?: number;
  readonly now?: string;
}

export interface DocumentDeliveryOutboxDeliveryOutcome {
  readonly outboxId: string;
  readonly target: DocumentDeliveryOutboxTarget;
  readonly status: "delivered" | "failed";
  readonly attempts: number;
  readonly error?: string;
  readonly retryAt?: string;
}

export interface DocumentDeliveryOutboxDrainResult {
  readonly tenantId: TenantId;
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly outcomes: readonly DocumentDeliveryOutboxDeliveryOutcome[];
}

export interface DocumentDeliveryOutboxDeliveryServices {
  readonly emailNotificationDeliveryQueue?: EmailNotificationDeliveryQueue;
  readonly emailNotifications?: {
    sendFromDomainEvent(event: DomainEvent, snapshot?: DocumentSnapshot | null): Promise<unknown>;
    queueFromDomainEvent?(
      event: DomainEvent,
      snapshot?: DocumentSnapshot | null
    ): Promise<readonly {
      readonly status: string;
      readonly messageId?: string;
      readonly ruleName?: string;
      readonly recipientId?: string;
    }[]>;
  };
  readonly notifications?: {
    recordFromDomainEvent(event: DomainEvent, snapshot?: DocumentSnapshot | null): Promise<unknown>;
  };
  readonly realtime?: RealtimePublisher;
}

export interface DocumentDeliveryOutboxDrainJobResources {
  readonly documentDeliveryOutboxConsumer?: {
    drain(command: DrainDocumentDeliveryOutboxCommand): Promise<DocumentDeliveryOutboxDrainResult>;
  };
}

export type DocumentDeliveryOutboxDrainJobPayload = DocumentData & {
  readonly limit?: number;
  readonly claimId?: string;
};

export interface DocumentDeliveryOutboxDrainJobOptions {
  readonly name?: string;
}

export class DocumentDeliveryOutboxConsumer {
  private readonly outbox: DocumentDeliveryOutboxConsumerOutbox;
  private readonly deliveries: DocumentDeliveryOutboxDeliveryHandlers;
  private readonly clock: Clock;
  private readonly retryBaseDelaySeconds: number;
  private readonly retryMaxDelaySeconds: number;

  constructor(options: DocumentDeliveryOutboxConsumerOptions) {
    this.outbox = options.outbox;
    this.deliveries = options.deliveries;
    this.clock = options.clock ?? systemClock;
    this.retryBaseDelaySeconds = normalizeDelaySeconds(
      options.retry?.baseDelaySeconds ?? DEFAULT_RETRY_BASE_DELAY_SECONDS,
      "Document delivery outbox retry baseDelaySeconds"
    );
    this.retryMaxDelaySeconds = normalizeDelaySeconds(
      options.retry?.maxDelaySeconds ?? DEFAULT_RETRY_MAX_DELAY_SECONDS,
      "Document delivery outbox retry maxDelaySeconds"
    );
    if (this.retryMaxDelaySeconds < this.retryBaseDelaySeconds) {
      throw badRequest("Document delivery outbox retry maxDelaySeconds must be greater than or equal to baseDelaySeconds");
    }
  }

  async drain(command: DrainDocumentDeliveryOutboxCommand): Promise<DocumentDeliveryOutboxDrainResult> {
    const now = command.now ?? this.clock.now();
    const claimed = await this.outbox.claimPending({
      tenantId: command.tenantId,
      ...(command.claimId === undefined ? {} : { claimId: command.claimId }),
      limit: normalizeLimit(command.limit),
      now
    });
    const outcomes: DocumentDeliveryOutboxDeliveryOutcome[] = [];
    for (const record of claimed) {
      outcomes.push(await this.deliver(record, now));
    }
    return {
      tenantId: command.tenantId,
      claimed: claimed.length,
      delivered: outcomes.filter((outcome) => outcome.status === "delivered").length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      outcomes
    };
  }

  private async deliver(
    record: DocumentDeliveryOutboxRecord,
    now: string
  ): Promise<DocumentDeliveryOutboxDeliveryOutcome> {
    const claimId = requireClaimId(record);
    const handler = this.deliveries[record.target];
    if (handler === undefined) {
      return this.fail(record, claimId, now, `No document delivery handler is configured for target '${record.target}'`);
    }
    try {
      const metadata = await handler.deliver(record);
      const delivered = await this.outbox.markDelivered({
        tenantId: record.tenantId,
        outboxId: record.id,
        claimId,
        metadata: {
          target: record.target,
          sourceEventId: record.sourceEventId,
          ...(metadata ?? {})
        }
      });
      return {
        outboxId: delivered.id,
        target: delivered.target,
        status: "delivered",
        attempts: delivered.attempts
      };
    } catch (error) {
      return this.fail(record, claimId, now, errorMessage(error));
    }
  }

  private async fail(
    record: DocumentDeliveryOutboxRecord,
    claimId: string,
    now: string,
    error: string
  ): Promise<DocumentDeliveryOutboxDeliveryOutcome> {
    const retryAt = retryAtFrom(now, record.attempts, this.retryBaseDelaySeconds, this.retryMaxDelaySeconds);
    const failed = await this.outbox.markFailed({
      tenantId: record.tenantId,
      outboxId: record.id,
      claimId,
      error,
      retryAt,
      metadata: {
        target: record.target,
        sourceEventId: record.sourceEventId
      }
    });
    return {
      outboxId: failed.id,
      target: failed.target,
      status: "failed",
      attempts: failed.attempts,
      error,
      retryAt
    };
  }
}

export function createDocumentDeliveryOutboxDeliveryHandlers(
  services: DocumentDeliveryOutboxDeliveryServices
): DocumentDeliveryOutboxDeliveryHandlers {
  return {
    ...(services.notifications === undefined
      ? {}
      : {
          notification: {
            async deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData> {
              const source = sourceFromOutboxRecord(record);
              await services.notifications!.recordFromDomainEvent(source.event, source.snapshot);
              return { deliveredBy: "notifications" };
            }
          }
        }),
    ...(services.realtime === undefined
      ? {}
      : {
          realtime: {
            async deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData> {
              const source = sourceFromOutboxRecord(record);
              const published = await Promise.all([
                services.realtime!.publish(realtimeEventFromDomainEvent(source.event, source.snapshot)),
                ...realtimeUserNotificationsFromDomainEvent(source.event).map((event) => services.realtime!.publish(event))
              ]);
              return {
                deliveredBy: "realtime",
                delivered: published.reduce((total, result) => total + result.delivered, 0)
              };
            }
          }
        }),
    ...(services.emailNotifications === undefined
      ? {}
      : {
          email: {
            async deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData> {
              const source = sourceFromOutboxRecord(record);
              if (
                services.emailNotificationDeliveryQueue !== undefined &&
                services.emailNotifications!.queueFromDomainEvent !== undefined
              ) {
                const deliveries = await services.emailNotifications!.queueFromDomainEvent(source.event, source.snapshot);
                await Promise.all(
                  deliveries
                    .filter((delivery) => delivery.status === "queued" && delivery.messageId !== undefined)
                    .map((delivery) =>
                      services.emailNotificationDeliveryQueue!.enqueue(source.event.tenantId, delivery.messageId!, {
                        metadata: {
                          sourceEventId: source.event.id,
                          sourceEventType: source.event.type,
                          sourcePayloadKind: source.event.payload.kind,
                          ...(delivery.ruleName === undefined ? {} : { ruleName: delivery.ruleName }),
                          ...(delivery.recipientId === undefined ? {} : { recipientId: delivery.recipientId })
                        }
                      })
                    )
                );
                return { deliveredBy: "email-queue", queued: deliveries.length };
              }
              await services.emailNotifications!.sendFromDomainEvent(source.event, source.snapshot);
              return { deliveredBy: "email" };
            }
          }
        })
  };
}

export function createDocumentDeliveryOutboxDrainJob<
  TResources extends DocumentDeliveryOutboxDrainJobResources = DocumentDeliveryOutboxDrainJobResources
>(options: DocumentDeliveryOutboxDrainJobOptions = {}): JobDefinition<JobPayload, TResources> {
  const name = options.name ?? DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME;
  return {
    name,
    description: "Drain claimed cf-frappe document delivery outbox records",
    retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
    async handler({ tenantId, payload, resources }) {
      const consumer = resources.documentDeliveryOutboxConsumer;
      if (consumer === undefined) {
        throw notFound("Document delivery outbox consumer is not available");
      }
      const limit = parseOptionalLimit(payload.limit);
      const claimId = parseOptionalClaimId(payload.claimId);
      const result = await consumer.drain({
        tenantId: tenantId ?? "default",
        ...(limit === undefined ? {} : { limit }),
        ...(claimId === undefined ? {} : { claimId })
      });
      return drainResultJson(result);
    }
  };
}

function drainResultJson(result: DocumentDeliveryOutboxDrainResult): DocumentData {
  return {
    tenantId: result.tenantId,
    claimed: result.claimed,
    delivered: result.delivered,
    failed: result.failed,
    outcomes: result.outcomes.map((outcome) => ({
      outboxId: outcome.outboxId,
      target: outcome.target,
      status: outcome.status,
      attempts: outcome.attempts,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
      ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt })
    }))
  };
}

function sourceFromOutboxRecord(record: DocumentDeliveryOutboxRecord): {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
} {
  const event = record.payload.event;
  if (!isDomainEvent(event)) {
    throw badRequest(`Document delivery outbox record '${record.id}' does not contain a source domain event`);
  }
  const snapshot = record.payload.snapshot;
  if (snapshot === undefined || snapshot === null) {
    return { event, snapshot: null };
  }
  if (!isDocumentSnapshot(snapshot)) {
    throw badRequest(`Document delivery outbox record '${record.id}' contains an invalid source snapshot`);
  }
  return { event, snapshot };
}

function isDomainEvent(value: unknown): value is DomainEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.tenantId === "string" &&
    typeof value.stream === "string" &&
    typeof value.sequence === "number" &&
    typeof value.type === "string" &&
    typeof value.doctype === "string" &&
    typeof value.documentName === "string" &&
    typeof value.actorId === "string" &&
    typeof value.occurredAt === "string" &&
    isRecord(value.payload) &&
    typeof value.payload.kind === "string" &&
    isRecord(value.metadata)
  );
}

function isDocumentSnapshot(value: unknown): value is DocumentSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tenantId === "string" &&
    typeof value.doctype === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "number" &&
    typeof value.docstatus === "string" &&
    isRecord(value.data) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireClaimId(record: DocumentDeliveryOutboxRecord): string {
  if (record.claimId === undefined || record.claimId.trim().length === 0) {
    throw badRequest(`Document delivery outbox record '${record.id}' is not claimed`);
  }
  return record.claimId;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_DRAIN_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_DRAIN_LIMIT) {
    throw badRequest(`Document delivery outbox drain limit must be an integer between 1 and ${MAX_DRAIN_LIMIT}`);
  }
  return limit;
}

function parseOptionalLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw badRequest("Document delivery outbox drain job limit is invalid");
  }
  return normalizeLimit(value);
}

function parseOptionalClaimId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Document delivery outbox drain job claimId is invalid");
  }
  return value;
}

function normalizeDelaySeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return value;
}

function retryAtFrom(now: string, attempts: number, baseDelaySeconds: number, maxDelaySeconds: number): string {
  const delaySeconds = Math.min(maxDelaySeconds, baseDelaySeconds * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.parse(now) + delaySeconds * 1000).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
