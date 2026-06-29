import { notFound } from "../core/errors.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { DocumentData, TenantId } from "../core/types.js";
import {
  emailNotificationDeliveryIdempotencyKey,
  emailNotificationDeliveryRequiredString,
  emailNotificationDeliveryResultJson,
  parseEmailNotificationDeliveryJobMessageId
} from "./email-notification-job-policy.js";
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
    const normalizedTenantId = emailNotificationDeliveryRequiredString(tenantId, "Email notification delivery tenantId");
    const normalizedMessageId = emailNotificationDeliveryRequiredString(
      messageId,
      "Email notification delivery messageId"
    );
    const message = await this.dispatcher.dispatch<EmailNotificationDeliveryJobPayload>({
      tenantId: normalizedTenantId,
      jobName: this.jobName,
      payload: { messageId: normalizedMessageId },
      idempotencyKey:
        options.idempotencyKey ??
        emailNotificationDeliveryIdempotencyKey(this.jobName, normalizedTenantId, normalizedMessageId),
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
      const messageId = parseEmailNotificationDeliveryJobMessageId(payload.messageId);
      const delivery = await emailNotifications.deliverOutboxMessage(tenantId ?? "default", messageId);
      if (delivery?.status === "failed") {
        throw retryableJobError(delivery.error);
      }
      return emailNotificationDeliveryResultJson(messageId, delivery);
    }
  };
}
