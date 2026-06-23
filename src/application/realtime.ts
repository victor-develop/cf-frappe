import type { DocumentHooks } from "../core/registry.js";
import { realtimeEventFromDomainEvent, realtimeUserNotificationsFromDomainEvent } from "../core/realtime.js";
import type { RealtimePublisher } from "../ports/realtime.js";
import type { UserNotificationService } from "./user-notification-service.js";

export interface DocumentDeliveryHookOptions {
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
  if (!notificationAfterCommit && !realtimeAfterCommit) {
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
      if (firstError) {
        throw firstError;
      }
    }
  };
}

export function createDocumentNotificationHooks(notifications: UserNotificationService): DocumentHooks {
  return {
    async afterCommit({ event }) {
      await notifications.recordFromDomainEvent(event);
    }
  };
}
