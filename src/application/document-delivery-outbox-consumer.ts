import { badRequest } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { realtimeEventFromDomainEvent, realtimeUserNotificationsFromDomainEvent } from "../core/realtime.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, TenantId } from "../core/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { RealtimePublisher } from "../ports/realtime.js";
import type {
  DocumentDeliveryOutboxRecord,
  DocumentDeliveryOutboxTarget
} from "./document-delivery-outbox-service.js";
import {
  documentDeliveryOutboxDrainLimit,
  documentDeliveryOutboxDrainResultJson,
  documentDeliveryOutboxErrorMessage,
  documentDeliveryOutboxRecordClaimId,
  documentDeliveryOutboxRetryAt,
  documentDeliveryOutboxRetryDelaySeconds,
  documentDeliveryOutboxSourceFromRecord,
  ensureDocumentDeliveryOutboxConsumerAvailable,
  hasQueuedDocumentDeliveryEmailMessageId,
  parseDocumentDeliveryOutboxDrainJobClaimId,
  parseDocumentDeliveryOutboxDrainJobLimit,
  type DocumentDeliveryOutboxDeliveryOutcome,
  type DocumentDeliveryOutboxDrainResult
} from "./document-delivery-outbox-consumer-policy.js";
import type { EmailNotificationDeliveryQueue } from "./realtime.js";

const DEFAULT_RETRY_BASE_DELAY_SECONDS = 30;
const DEFAULT_RETRY_MAX_DELAY_SECONDS = 1_800;

export const DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME = "cf-frappe.document-delivery-outbox.drain";

export type {
  DocumentDeliveryOutboxDeliveryOutcome,
  DocumentDeliveryOutboxDrainResult
} from "./document-delivery-outbox-consumer-policy.js";

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
    this.retryBaseDelaySeconds = documentDeliveryOutboxRetryDelaySeconds(
      options.retry?.baseDelaySeconds ?? DEFAULT_RETRY_BASE_DELAY_SECONDS,
      "Document delivery outbox retry baseDelaySeconds"
    );
    this.retryMaxDelaySeconds = documentDeliveryOutboxRetryDelaySeconds(
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
      limit: documentDeliveryOutboxDrainLimit(command.limit),
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
    const claimId = documentDeliveryOutboxRecordClaimId(record);
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
      return this.fail(record, claimId, now, documentDeliveryOutboxErrorMessage(error));
    }
  }

  private async fail(
    record: DocumentDeliveryOutboxRecord,
    claimId: string,
    now: string,
    error: string
  ): Promise<DocumentDeliveryOutboxDeliveryOutcome> {
    const retryAt = documentDeliveryOutboxRetryAt({
      now,
      attempts: record.attempts,
      baseDelaySeconds: this.retryBaseDelaySeconds,
      maxDelaySeconds: this.retryMaxDelaySeconds
    });
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
  const notifications = services.notifications;
  const realtime = services.realtime;
  const emailNotifications = services.emailNotifications;
  const emailNotificationDeliveryQueue = services.emailNotificationDeliveryQueue;
  return {
    ...(notifications === undefined
      ? {}
      : {
          notification: {
            async deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData> {
              const source = documentDeliveryOutboxSourceFromRecord(record);
              await notifications.recordFromDomainEvent(source.event, source.snapshot);
              return { deliveredBy: "notifications" };
            }
          }
        }),
    ...(realtime === undefined
      ? {}
      : {
          realtime: {
            async deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData> {
              const source = documentDeliveryOutboxSourceFromRecord(record);
              const published = await Promise.all([
                realtime.publish(realtimeEventFromDomainEvent(source.event, source.snapshot)),
                ...realtimeUserNotificationsFromDomainEvent(source.event).map((event) => realtime.publish(event))
              ]);
              return {
                deliveredBy: "realtime",
                delivered: published.reduce((total, result) => total + result.delivered, 0)
              };
            }
          }
        }),
    ...(emailNotifications === undefined
      ? {}
      : {
          email: {
            async deliver(record: DocumentDeliveryOutboxRecord): Promise<DocumentData> {
              const source = documentDeliveryOutboxSourceFromRecord(record);
              if (
                emailNotificationDeliveryQueue !== undefined &&
                emailNotifications.queueFromDomainEvent !== undefined
              ) {
                const deliveries = await emailNotifications.queueFromDomainEvent(source.event, source.snapshot);
                await Promise.all(
                  deliveries
                    .filter(hasQueuedDocumentDeliveryEmailMessageId)
                    .map((delivery) =>
                      emailNotificationDeliveryQueue.enqueue(source.event.tenantId, delivery.messageId, {
                        metadata: {
                          sourceEventId: source.event.id,
                          sourceEventType: source.event.type,
                          sourcePayloadKind: domainEventPayloadKind(source.event),
                          ...(delivery.ruleName === undefined ? {} : { ruleName: delivery.ruleName }),
                          ...(delivery.recipientId === undefined ? {} : { recipientId: delivery.recipientId })
                        }
                      })
                    )
                );
                return { deliveredBy: "email-queue", queued: deliveries.length };
              }
              await emailNotifications.sendFromDomainEvent(source.event, source.snapshot);
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
      ensureDocumentDeliveryOutboxConsumerAvailable(consumer);
      const limit = parseDocumentDeliveryOutboxDrainJobLimit(payload.limit);
      const claimId = parseDocumentDeliveryOutboxDrainJobClaimId(payload.claimId);
      const result = await consumer.drain({
        tenantId: tenantId ?? "default",
        ...(limit === undefined ? {} : { limit }),
        ...(claimId === undefined ? {} : { claimId })
      });
      return documentDeliveryOutboxDrainResultJson(result);
    }
  };
}
