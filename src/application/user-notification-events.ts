import type { DocumentUserNotificationPayload } from "../core/notifications.js";
import type { DocTypeName, DocumentName, DomainEvent, TenantId } from "../core/types.js";

export type UserNotificationEventPayload =
  | {
      readonly kind: "UserNotificationRecorded";
      readonly notificationId: string;
      readonly sourceEventId: string;
      readonly eventType: string;
      readonly payloadKind: string;
      readonly recipientId: string;
      readonly doctype: DocTypeName;
      readonly documentName: DocumentName;
      readonly actorId: string;
      readonly subject?: string;
      readonly ruleName?: string;
    }
  | {
      readonly kind: "UserNotificationRead";
      readonly notificationId: string;
    }
  | {
      readonly kind: "UserNotificationDismissed";
      readonly notificationId: string;
    };

export interface UserNotificationRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly recipientId: string;
  readonly sourceEventId: string;
  readonly eventType: string;
  readonly payloadKind: string;
  readonly doctype: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly subject: string;
  readonly ruleName?: string;
  readonly read: boolean;
  readonly dismissed: boolean;
  readonly createdAt: string;
  readonly readAt?: string;
  readonly readBy?: string;
  readonly dismissedAt?: string;
  readonly dismissedBy?: string;
}

export interface UserNotificationState {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly version: number;
  readonly notifications: ReadonlyMap<string, UserNotificationRecord>;
}

export function foldUserNotifications(
  tenantId: TenantId,
  userId: string,
  events: readonly DomainEvent[]
): UserNotificationState {
  const notifications = new Map<string, UserNotificationRecord>();
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  for (const event of orderedEvents) {
    switch (event.payload.kind) {
      case "UserNotificationRecorded":
        notifications.set(event.payload.notificationId, notificationFromRecordedEvent(event));
        break;
      case "UserNotificationRead": {
        const current = notifications.get(event.payload.notificationId);
        if (current) {
          notifications.set(event.payload.notificationId, {
            ...current,
            read: true,
            readAt: event.occurredAt,
            readBy: event.actorId
          });
        }
        break;
      }
      case "UserNotificationDismissed": {
        const current = notifications.get(event.payload.notificationId);
        if (current) {
          notifications.set(event.payload.notificationId, {
            ...current,
            dismissed: true,
            dismissedAt: event.occurredAt,
            dismissedBy: event.actorId
          });
        }
        break;
      }
    }
  }
  return {
    tenantId,
    userId,
    version: orderedEvents.at(-1)?.sequence ?? 0,
    notifications
  };
}

export function notificationFromRecordedEvent(event: DomainEvent): UserNotificationRecord {
  if (event.payload.kind !== "UserNotificationRecorded") {
    throw new Error("Expected UserNotificationRecorded event");
  }
  return {
    id: event.payload.notificationId,
    tenantId: event.tenantId,
    recipientId: event.payload.recipientId,
    sourceEventId: event.payload.sourceEventId,
    eventType: event.payload.eventType,
    payloadKind: event.payload.payloadKind,
    doctype: event.payload.doctype,
    documentName: event.payload.documentName,
    actorId: event.payload.actorId,
    subject: userNotificationSubject(event.payload),
    ...(event.payload.ruleName === undefined ? {} : { ruleName: event.payload.ruleName }),
    read: false,
    dismissed: false,
    createdAt: event.occurredAt
  };
}

export function sortedUserNotifications(state: UserNotificationState): readonly UserNotificationRecord[] {
  return [...state.notifications.values()].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  );
}

export function userNotificationEventType(
  payload: UserNotificationEventPayload
): UserNotificationEventPayload["kind"] {
  return payload.kind;
}

export function requireReplayedNotification(
  state: UserNotificationState,
  notificationId: string
): UserNotificationRecord {
  const notification = state.notifications.get(notificationId);
  if (notification === undefined) {
    throw new Error(
      `Notification '${notificationId}' for user '${state.userId}' in tenant '${state.tenantId}' was not found after replay`
    );
  }
  return notification;
}

export function requireAppendedUserNotificationEvent(
  event: DomainEvent | undefined,
  tenantId: TenantId,
  userId: string,
  notificationId: string,
  payloadKind: UserNotificationEventPayload["kind"]
): DomainEvent {
  if (event === undefined) {
    throw new Error(
      `User notification append for '${notificationId}' and user '${userId}' in tenant '${tenantId}' did not return '${payloadKind}'`
    );
  }
  return event;
}

export function notificationIdentity(notification: DocumentUserNotificationPayload): string {
  const source = notification.ruleName === undefined ? "" : `rule:${encodeURIComponent(notification.ruleName)}:`;
  return `${notification.eventId}:${source}user:${encodeURIComponent(notification.recipientId)}`;
}

export function userNotificationSubject(
  payload: Extract<UserNotificationEventPayload, { readonly kind: "UserNotificationRecorded" }>
): string {
  if (payload.subject !== undefined) {
    return payload.subject;
  }
  const target = `${payload.doctype} ${payload.documentName}`;
  switch (payload.payloadKind) {
    case "DocumentAssigned":
      return `${payload.actorId} assigned you to ${target}`;
    case "DocumentUnassigned":
      return `${payload.actorId} removed your assignment from ${target}`;
    case "DocumentFollowed":
      return `${payload.actorId} followed ${target}`;
    case "DocumentUnfollowed":
      return `${payload.actorId} unfollowed ${target}`;
    case "DocumentShared":
      return `${payload.actorId} shared ${target} with you`;
    case "DocumentShareRevoked":
      return `${payload.actorId} revoked your share on ${target}`;
    default:
      return `${payload.actorId} updated ${target}`;
  }
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserNotificationRecorded: Extract<
      UserNotificationEventPayload,
      { readonly kind: "UserNotificationRecorded" }
    >;
    readonly UserNotificationRead: Extract<
      UserNotificationEventPayload,
      { readonly kind: "UserNotificationRead" }
    >;
    readonly UserNotificationDismissed: Extract<
      UserNotificationEventPayload,
      { readonly kind: "UserNotificationDismissed" }
    >;
  }
}
