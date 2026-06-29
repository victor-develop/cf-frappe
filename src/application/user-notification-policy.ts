import { badRequest } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type TenantId
} from "../core/types.js";
import {
  sortedUserNotifications,
  type UserNotificationRecord,
  type UserNotificationState
} from "./user-notification-events.js";

export const USER_NOTIFICATION_DEFAULT_INBOX_LIMIT = 50;
export const USER_NOTIFICATION_MAX_INBOX_LIMIT = 200;

export interface UserNotificationInbox {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly limit: number;
  readonly unreadCount: number;
  readonly filters: {
    readonly unreadOnly: boolean;
    readonly includeDismissed: boolean;
  };
  readonly notifications: readonly UserNotificationRecord[];
}

export type UserNotificationAccessDecision =
  | { readonly status: "allow"; readonly tenantId: TenantId; readonly userId: string }
  | { readonly status: "deny"; readonly message: string };

export type UserNotificationChangeDecision =
  | { readonly status: "append" }
  | { readonly status: "noop" };

export function planUserNotificationAccess(options: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly explicitUserId?: string;
}): UserNotificationAccessDecision {
  const tenantId = options.actor.tenantId ?? DEFAULT_TENANT_ID;
  const userId = normalizeUserNotificationUserId(options.explicitUserId ?? options.actor.id);
  if (userId !== options.actor.id && !options.adminRoles.some((role) => options.actor.roles.includes(role))) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot inspect notifications for '${userId}'`
    };
  }
  return { status: "allow", tenantId, userId };
}

export function planUserNotificationRead(notification: UserNotificationRecord): UserNotificationChangeDecision {
  if (notification.read) {
    return { status: "noop" };
  }
  return { status: "append" };
}

export function planUserNotificationDismiss(notification: UserNotificationRecord): UserNotificationChangeDecision {
  if (notification.dismissed) {
    return { status: "noop" };
  }
  return { status: "append" };
}

export function normalizeUserNotificationUserId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest("Notification user is required");
  }
  return normalized;
}

export function normalizeUserNotificationId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest("Notification id is required");
  }
  return normalized;
}

export function normalizeUserNotificationInboxLimit(value: number | undefined): number {
  if (value === undefined) {
    return USER_NOTIFICATION_DEFAULT_INBOX_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1 || value > USER_NOTIFICATION_MAX_INBOX_LIMIT) {
    throw badRequest(`Notification limit must be between 1 and ${USER_NOTIFICATION_MAX_INBOX_LIMIT}`);
  }
  return value;
}

export function userNotificationInboxProjection(command: {
  readonly state: UserNotificationState;
  readonly limit: number;
  readonly unreadOnly?: boolean | undefined;
  readonly includeDismissed?: boolean | undefined;
}): UserNotificationInbox {
  const unreadOnly = command.unreadOnly ?? false;
  const includeDismissed = command.includeDismissed ?? false;
  const ordered = sortedUserNotifications(command.state);
  const notifications = ordered
    .filter((notification) => includeDismissed || !notification.dismissed)
    .filter((notification) => !unreadOnly || !notification.read);
  return {
    tenantId: command.state.tenantId,
    userId: command.state.userId,
    limit: command.limit,
    unreadCount: ordered.filter((notification) => !notification.read && !notification.dismissed).length,
    filters: { unreadOnly, includeDismissed },
    notifications: notifications.slice(0, command.limit)
  };
}
