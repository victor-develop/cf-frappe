import { defineDocumentHooks, type DocumentHooks } from "../core/document-hooks.js";
import { realtimeEventFromDomainEvent, realtimeUserNotificationsFromDomainEvent } from "../core/realtime.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, TenantId } from "../core/types.js";
import type { RealtimePublisher } from "../ports/realtime.js";
import type { DocumentDeliveryOutboxTarget } from "./document-delivery-outbox-service.js";
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
  readonly deliveryOutbox?: DocumentDeliveryOutboxWriter;
  readonly deliveryOutboxTargets?: readonly DocumentDeliveryOutboxTarget[];
  readonly realtime?: RealtimePublisher;
  readonly notifications?: UserNotificationService;
}

export interface DocumentDeliveryOutboxWriter {
  enqueueFromDomainEvent(command: {
    readonly event: DomainEvent;
    readonly snapshot?: DocumentSnapshot | null;
    readonly targets: readonly DocumentDeliveryOutboxTarget[];
    readonly metadata?: DocumentData;
  }): Promise<unknown>;
}

export function createDocumentRealtimeHooks(publisher: RealtimePublisher): DocumentHooks {
  return defineDocumentHooks({
    async afterCommit({ event, snapshot }) {
      await publisher.publish(realtimeEventFromDomainEvent(event, snapshot));
      await Promise.all(
        realtimeUserNotificationsFromDomainEvent(event).map((notification) => publisher.publish(notification))
      );
    }
  });
}

export function createDocumentDeliveryHooks(options: DocumentDeliveryHookOptions): DocumentHooks {
  const outboxAfterCommit = options.deliveryOutbox
    ? createDocumentDeliveryOutboxHooks(
        options.deliveryOutbox,
        options.deliveryOutboxTargets ?? deliveryOutboxTargets(options)
      ).afterCommit
    : undefined;
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
  if (!outboxAfterCommit && !notificationAfterCommit && !realtimeAfterCommit && !emailAfterCommit) {
    return defineDocumentHooks({});
  }
  return defineDocumentHooks({
    async afterCommit(context) {
      let firstError: unknown;
      try {
        await outboxAfterCommit?.(context);
      } catch (error) {
        firstError = error;
      }
      try {
        await notificationAfterCommit?.(context);
      } catch (error) {
        firstError ??= error;
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
  });
}

export function createDocumentDeliveryOutboxHooks(
  outbox: DocumentDeliveryOutboxWriter,
  targets: readonly DocumentDeliveryOutboxTarget[]
): DocumentHooks {
  return defineDocumentHooks({
    async afterCommit({ event, snapshot }) {
      await outbox.enqueueFromDomainEvent({ event, snapshot, targets });
    }
  });
}

export function createDocumentNotificationHooks(notifications: UserNotificationService): DocumentHooks {
  return defineDocumentHooks({
    async afterCommit({ event, snapshot }) {
      await notifications.recordFromDomainEvent(event, snapshot);
    }
  });
}

export function createDocumentEmailNotificationHooks(emailNotifications: EmailNotificationService): DocumentHooks {
  return defineDocumentHooks({
    async afterCommit({ event, snapshot }) {
      await emailNotifications.sendFromDomainEvent(event, snapshot);
    }
  });
}

export function createDocumentQueuedEmailNotificationHooks(
  emailNotifications: EmailNotificationService,
  deliveryQueue: EmailNotificationDeliveryQueue
): DocumentHooks {
  return defineDocumentHooks({
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
  });
}

function deliveryOutboxTargets(options: DocumentDeliveryHookOptions): readonly DocumentDeliveryOutboxTarget[] {
  return [
    ...(options.notifications ? ["notification" as const] : []),
    ...(options.realtime ? ["realtime" as const] : []),
    ...(options.emailNotifications ? ["email" as const] : [])
  ];
}
