import { badRequest, notFound } from "../core/errors.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { DocumentData, TenantId } from "../core/types.js";
import { retryableJobError } from "./job-errors.js";
import type { JobDispatcher } from "./job-dispatcher.js";
import type { DocumentEmailNotificationDelivery } from "./email-notification-service.js";
import type { JobMessage } from "../ports/job-queue.js";

export const EMAIL_NOTIFICATION_DELIVERY_JOB_NAME = "cf-frappe.email-notifications.deliver";

export type EmailNotificationDeliveryJobPayload = DocumentData & {
  readonly messageId: string;
};

export interface EmailNotificationDeliveryPort {
  deliverOutboxMessage(
    tenantId: TenantId,
    messageId: string
  ): Promise<DocumentEmailNotificationDelivery | undefined>;
}

export interface EmailNotificationDeliveryJobResources {
  readonly emailNotifications?: EmailNotificationDeliveryPort;
}

export interface EmailNotificationDeliveryJobOptions {
  readonly name?: string;
}

export interface EmailNotificationDeliveryQueueOptions {
  readonly delaySeconds?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: DocumentData;
}

export interface EmailNotificationDeliveryQueueResult {
  readonly message: JobMessage<EmailNotificationDeliveryJobPayload>;
}

export interface EmailNotificationDeliveryQueueServiceOptions<TResources> {
  readonly dispatcher: JobDispatcher<TResources>;
  readonly jobName?: string;
}

export class EmailNotificationDeliveryQueueService<TResources = unknown> {
  private readonly dispatcher: JobDispatcher<TResources>;
  private readonly jobName: string;

  constructor(options: EmailNotificationDeliveryQueueServiceOptions<TResources>) {
    this.dispatcher = options.dispatcher;
    this.jobName = options.jobName ?? EMAIL_NOTIFICATION_DELIVERY_JOB_NAME;
  }

  async enqueue(
    tenantId: TenantId,
    messageId: string,
    options: EmailNotificationDeliveryQueueOptions = {}
  ): Promise<EmailNotificationDeliveryQueueResult> {
    const normalizedTenantId = requiredString(tenantId, "Email notification delivery tenantId");
    const normalizedMessageId = requiredString(messageId, "Email notification delivery messageId");
    const message = await this.dispatcher.dispatch<EmailNotificationDeliveryJobPayload>({
      tenantId: normalizedTenantId,
      jobName: this.jobName,
      payload: { messageId: normalizedMessageId },
      idempotencyKey:
        options.idempotencyKey ?? defaultDeliveryIdempotencyKey(this.jobName, normalizedTenantId, normalizedMessageId),
      ...(options.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds }),
      metadata: {
        ...(options.metadata ?? {}),
        dispatchSource: "email-notifications"
      }
    });
    return { message };
  }
}

export function createEmailNotificationDeliveryJob<
  TResources extends EmailNotificationDeliveryJobResources = EmailNotificationDeliveryJobResources
>(options: EmailNotificationDeliveryJobOptions = {}): JobDefinition<JobPayload, TResources> {
  const name = options.name ?? EMAIL_NOTIFICATION_DELIVERY_JOB_NAME;
  return {
    name,
    description: "Deliver one claimed cf-frappe email notification outbox message",
    retry: { maxAttempts: 5, baseDelaySeconds: 30, maxDelaySeconds: 1_800 },
    async handler({ tenantId, payload, resources }) {
      const emailNotifications = resources.emailNotifications;
      if (emailNotifications === undefined) {
        throw notFound("Email notification delivery service is not available");
      }
      const messageId = parseJobMessageId(payload.messageId);
      const delivery = await emailNotifications.deliverOutboxMessage(tenantId ?? "default", messageId);
      if (delivery?.status === "failed") {
        throw retryableJobError(delivery.error);
      }
      return deliveryResultJson(messageId, delivery);
    }
  };
}

function parseJobMessageId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Email notification delivery job messageId is invalid");
  }
  return value;
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

function defaultDeliveryIdempotencyKey(jobName: string, tenantId: string, messageId: string): string {
  return `${jobName}:${stableHash(tenantId)}:${stableHash(messageId)}`;
}

function stableHash(value: string): string {
  const left = fnv1a64(value, 0xcbf29ce484222325n);
  const right = fnv1a64(value, 0x84222325cbf29ce4n);
  return `${left}${right}`;
}

function fnv1a64(value: string, seed: bigint): string {
  let hash = seed;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function deliveryResultJson(
  messageId: string,
  delivery: DocumentEmailNotificationDelivery | undefined
): DocumentData {
  if (delivery === undefined) {
    return { delivered: false, messageId };
  }
  if (delivery.status === "sent") {
    return {
      delivered: true,
      status: "sent",
      messageId: delivery.messageId,
      eventId: delivery.eventId,
      ruleName: delivery.ruleName,
      recipientId: delivery.recipientId,
      to: delivery.to,
      subject: delivery.subject,
      ...(delivery.providerMessageId === undefined ? {} : { providerMessageId: delivery.providerMessageId })
    };
  }
  if (delivery.status === "skipped") {
    return {
      delivered: true,
      status: "skipped",
      messageId: delivery.messageId,
      eventId: delivery.eventId,
      ruleName: delivery.ruleName,
      recipientId: delivery.recipientId,
      reason: delivery.reason
    };
  }
  return {
    delivered: true,
    status: "failed",
    messageId: delivery.messageId,
    eventId: delivery.eventId,
    ruleName: delivery.ruleName,
    recipientId: delivery.recipientId,
    to: delivery.to,
    subject: delivery.subject,
    error: delivery.error
  };
}
