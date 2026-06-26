import type { DocumentHooks } from "../core/registry.js";
import { realtimeEventFromDomainEvent, realtimeUserNotificationsFromDomainEvent } from "../core/realtime.js";
import type { DocumentData, TenantId } from "../core/types.js";
import type { RealtimePublisher } from "../ports/realtime.js";
import type { EmailNotificationService } from "./email-notification-service.js";
import type { UserNotificationService } from "./user-notification-service.js";

export interface EmailNotificationDeliveryQueue {
  enqueue(
    tenantId: TenantId,
    messageId: string,
    options?: { readonly metadata?: DocumentData }
  ): Promise<unknown>;
}

export interface DocumentDeliveryHookOptions {
  readonly emailNotificationDeliveryQueue?: EmailNotificationDeliveryQueue;
  readonly emailNotifications?: EmailNotificationService;
  readonly realtime?: RealtimePublisher;
  readonly notifications?: UserNotificationService;
}

export function createDocumentRealtimeHooks(publisher: RealtimePublisher): DocumentHooks {
  return {
    async afterCommit({ event, snapshot }) {
      await publisher.publish(realtimeEventFromDomainEvent(event, snapshot));
      await Promise.all(
        realtimeUserNotificationsFromDomainEvent(event).map((notification) => publisher.publish(notification))
      );
    }
  };
}

export function createDocumentDeliveryHooks(options: DocumentDeliveryHookOptions): DocumentHooks {
  const notificationAfterCommit = options.notifications
    ? createDocumentNotificationHooks(options.notifications).afterCommit
    : undefined;
  const realtimeAfterCommit = options.realtime
    ? createDocumentRealtimeHooks(options.realtime).afterCommit
    : undefined;
  const emailAfterCommit = options.emailNotifications
    ? options.emailNotificationDeliveryQueue
      ? createDocumentQueuedEmailNotificationHooks(
          options.emailNotifications,
          options.emailNotificationDeliveryQueue
        ).afterCommit
      : createDocumentEmailNotificationHooks(options.emailNotifications).afterCommit
    : undefined;
  if (!notificationAfterCommit && !realtimeAfterCommit && !emailAfterCommit) {
    return {};
  }
  return {
    async afterCommit(context) {
      let firstError: unknown;
      try {
        await notificationAfterCommit?.(context);
      } catch (error) {
        firstError = error;
      }
      try {
        await realtimeAfterCommit?.(context);
      } catch (error) {
        firstError ??= error;
      }
      try {
        await emailAfterCommit?.(context);
      } catch (error) {
        firstError ??= error;
      }
      if (firstError) {
        throw firstError;
      }
    }
  };
}

export function createDocumentNotificationHooks(notifications: UserNotificationService): DocumentHooks {
  return {
    async afterCommit({ event, snapshot }) {
      await notifications.recordFromDomainEvent(event, snapshot);
    }
  };
}

export function createDocumentEmailNotificationHooks(emailNotifications: EmailNotificationService): DocumentHooks {
  return {
    async afterCommit({ event, snapshot }) {
      await emailNotifications.sendFromDomainEvent(event, snapshot);
    }
  };
}

export function createDocumentQueuedEmailNotificationHooks(
  emailNotifications: EmailNotificationService,
  deliveryQueue: EmailNotificationDeliveryQueue
): DocumentHooks {
  return {
    async afterCommit({ event, snapshot }) {
      const deliveries = await emailNotifications.queueFromDomainEvent(event, snapshot);
      await Promise.all(
        deliveries
          .filter((delivery) => delivery.status === "queued")
          .map((delivery) =>
            deliveryQueue.enqueue(event.tenantId, delivery.messageId, {
              metadata: {
                sourceEventId: event.id,
                sourceEventType: event.type,
                sourcePayloadKind: event.payload.kind,
                ruleName: delivery.ruleName,
                recipientId: delivery.recipientId
              }
            })
          )
      );
    }
  };
}
