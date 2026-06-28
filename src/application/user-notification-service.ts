import { FrameworkError, badRequest, notFound, permissionDenied } from "../core/errors.js";
import {
  documentUserNotificationsFromDomainEvent,
  documentUserNotificationsFromRules,
  type DocumentUserNotificationPayload
} from "../core/notifications.js";
import { userNotificationsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DocumentSnapshot,
  type DomainEvent,
  type NotificationRuleDefinition,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import type { UserNotificationEventPayload } from "./user-notification-events.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { UserNotificationEventPayload } from "./user-notification-events.js";

const DEFAULT_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 200;
const MAX_NOTIFICATION_APPEND_ATTEMPTS = 5;

export interface UserNotificationServiceOptions {
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly notificationRules?: NotificationRuleProvider;
}

export interface NotificationRuleProvider {
  notificationRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options?: { readonly occurredAt?: string }
  ): Promise<readonly NotificationRuleDefinition[]>;
}

export interface UserNotificationInboxQuery {
  readonly userId?: string;
  readonly unreadOnly?: boolean;
  readonly includeDismissed?: boolean;
  readonly limit?: number;
}

export interface UserNotificationCommand {
  readonly userId?: string;
  readonly metadata?: DocumentData;
}

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

interface UserNotificationState {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly version: number;
  readonly notifications: ReadonlyMap<string, UserNotificationRecord>;
}

export class UserNotificationService {
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly notificationRules: NotificationRuleProvider | undefined;

  constructor(options: UserNotificationServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.notificationRules = options.notificationRules;
  }

  async recordFromDomainEvent(
    event: DomainEvent,
    snapshot?: DocumentSnapshot | null
  ): Promise<readonly UserNotificationRecord[]> {
    const recorded: UserNotificationRecord[] = [];
    for (const notification of await this.notificationsForEvent(event, snapshot)) {
      recorded.push(await this.recordNotification(notification, event.occurredAt));
    }
    return recorded;
  }

  async inbox(actor: Actor, query: UserNotificationInboxQuery = {}): Promise<UserNotificationInbox> {
    const { tenantId, userId } = this.authorizeUser(actor, query.userId);
    const state = await this.state(tenantId, userId);
    const limit = normalizeLimit(query.limit);
    const unreadOnly = query.unreadOnly ?? false;
    const includeDismissed = query.includeDismissed ?? false;
    const all = sortedNotifications(state)
      .filter((notification) => includeDismissed || !notification.dismissed)
      .filter((notification) => !unreadOnly || !notification.read);
    return {
      tenantId,
      userId,
      limit,
      unreadCount: sortedNotifications(state).filter((notification) => !notification.read && !notification.dismissed).length,
      filters: { unreadOnly, includeDismissed },
      notifications: all.slice(0, limit)
    };
  }

  async markRead(
    actor: Actor,
    notificationId: string,
    command: UserNotificationCommand = {}
  ): Promise<UserNotificationRecord> {
    const { tenantId, userId } = this.authorizeUser(actor, command.userId);
    const state = await this.state(tenantId, userId);
    const id = normalizeNotificationId(notificationId);
    const notification = this.requireNotification(state, id);
    if (notification.read) {
      return notification;
    }
    await this.appendUserNotificationEvent(state, actor, {
      kind: "UserNotificationRead",
      notificationId: id
    }, command.metadata);
    return requireReplayedNotification(await this.state(tenantId, userId), id);
  }

  async dismiss(
    actor: Actor,
    notificationId: string,
    command: UserNotificationCommand = {}
  ): Promise<UserNotificationRecord> {
    const { tenantId, userId } = this.authorizeUser(actor, command.userId);
    const state = await this.state(tenantId, userId);
    const id = normalizeNotificationId(notificationId);
    const notification = this.requireNotification(state, id);
    if (notification.dismissed) {
      return notification;
    }
    await this.appendUserNotificationEvent(state, actor, {
      kind: "UserNotificationDismissed",
      notificationId: id
    }, command.metadata);
    return requireReplayedNotification(await this.state(tenantId, userId), id);
  }

  private async state(tenantId: TenantId, userId: string): Promise<UserNotificationState> {
    return foldUserNotifications(
      tenantId,
      userId,
      await this.events.readStream(userNotificationsStream(tenantId, userId))
    );
  }

  private async recordNotification(
    notification: DocumentUserNotificationPayload,
    occurredAt: string
  ): Promise<UserNotificationRecord> {
    const notificationId = notificationIdentity(notification);
    for (let attempt = 1; attempt <= MAX_NOTIFICATION_APPEND_ATTEMPTS; attempt += 1) {
      const state = await this.state(notification.tenantId, notification.recipientId);
      const existing = state.notifications.get(notificationId);
      if (existing) {
        return existing;
      }
      const stream = userNotificationsStream(notification.tenantId, notification.recipientId);
      try {
        const [saved] = await this.events.append(stream, state.version, [
          {
            id: this.ids.next("evt_"),
            tenantId: notification.tenantId,
            stream,
            type: "UserNotificationRecorded",
            doctype: "__UserNotifications",
            documentName: notification.recipientId,
            actorId: notification.actorId,
            occurredAt,
            payload: {
              kind: "UserNotificationRecorded",
              notificationId,
              sourceEventId: notification.eventId,
              eventType: notification.eventType,
              payloadKind: notification.payloadKind,
              recipientId: notification.recipientId,
              doctype: notification.doctype,
              documentName: notification.documentName,
              actorId: notification.actorId,
              ...(notification.subject === undefined ? {} : { subject: notification.subject }),
              ...(notification.ruleName === undefined ? {} : { ruleName: notification.ruleName })
            },
            metadata: {}
          } satisfies NewDomainEvent
        ]);
        return notificationFromRecordedEvent(saved!);
      } catch (error) {
        if (isStreamConflict(error) && attempt < MAX_NOTIFICATION_APPEND_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unreachable notification append retry state");
  }

  private requireNotification(state: UserNotificationState, notificationId: string): UserNotificationRecord {
    const id = normalizeNotificationId(notificationId);
    const notification = state.notifications.get(id);
    if (!notification) {
      throw notFound(`Notification '${id}' was not found`);
    }
    return notification;
  }

  private async appendUserNotificationEvent(
    state: UserNotificationState,
    actor: Actor,
    payload: Extract<UserNotificationEventPayload, { readonly kind: "UserNotificationRead" | "UserNotificationDismissed" }>,
    metadata: DocumentData | undefined
  ): Promise<DomainEvent> {
    const stream = userNotificationsStream(state.tenantId, state.userId);
    const [event] = await this.events.append(stream, state.version, [
      {
        id: this.ids.next("evt_"),
        tenantId: state.tenantId,
        stream,
        type: payload.kind,
        doctype: "__UserNotifications",
        documentName: state.userId,
        actorId: actor.id,
        occurredAt: this.clock.now(),
        payload,
        metadata: metadata ?? {}
      }
    ]);
    return event!;
  }

  private authorizeUser(actor: Actor, explicitUserId?: string): { readonly tenantId: TenantId; readonly userId: string } {
    const tenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeUserId(explicitUserId ?? actor.id);
    if (userId !== actor.id && !this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot inspect notifications for '${userId}'`);
    }
    return { tenantId, userId };
  }

  private async notificationsForEvent(
    event: DomainEvent,
    snapshot: DocumentSnapshot | null | undefined
  ): Promise<readonly DocumentUserNotificationPayload[]> {
    const direct = documentUserNotificationsFromDomainEvent(event);
    const rules = this.notificationRules === undefined
      ? []
      : await this.notificationRules.notificationRulesFor(event.tenantId, event.doctype, {
          occurredAt: event.occurredAt
        });
    if (rules.length === 0) {
      return direct;
    }
    return [
      ...direct,
      ...documentUserNotificationsFromRules(event, snapshot ?? null, rules)
    ];
  }
}

function foldUserNotifications(
  tenantId: TenantId,
  userId: string,
  events: readonly DomainEvent[]
): UserNotificationState {
  const notifications = new Map<string, UserNotificationRecord>();
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  for (const event of orderedEvents) {
    switch (event.payload.kind) {
      case "UserNotificationRecorded":
        notifications.set(event.payload.notificationId, {
          id: event.payload.notificationId,
          tenantId: event.tenantId,
          recipientId: event.payload.recipientId,
          sourceEventId: event.payload.sourceEventId,
          eventType: event.payload.eventType,
          payloadKind: event.payload.payloadKind,
          doctype: event.payload.doctype,
          documentName: event.payload.documentName,
          actorId: event.payload.actorId,
          subject: notificationSubject(event.payload),
          ...(event.payload.ruleName === undefined ? {} : { ruleName: event.payload.ruleName }),
          read: false,
          dismissed: false,
          createdAt: event.occurredAt
        });
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

function notificationFromRecordedEvent(event: DomainEvent): UserNotificationRecord {
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
    subject: notificationSubject(event.payload),
    ...(event.payload.ruleName === undefined ? {} : { ruleName: event.payload.ruleName }),
    read: false,
    dismissed: false,
    createdAt: event.occurredAt
  };
}

function sortedNotifications(state: UserNotificationState): readonly UserNotificationRecord[] {
  return [...state.notifications.values()].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  );
}

function requireReplayedNotification(
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

function notificationIdentity(notification: DocumentUserNotificationPayload): string {
  const source = notification.ruleName === undefined ? "" : `rule:${encodeURIComponent(notification.ruleName)}:`;
  return `${notification.eventId}:${source}user:${encodeURIComponent(notification.recipientId)}`;
}

function notificationSubject(
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

function normalizeUserId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest("Notification user is required");
  }
  return normalized;
}

function normalizeNotificationId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest("Notification id is required");
  }
  return normalized;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_NOTIFICATION_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_NOTIFICATION_LIMIT) {
    throw badRequest(`Notification limit must be between 1 and ${MAX_NOTIFICATION_LIMIT}`);
  }
  return value;
}

function isStreamConflict(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "DOCUMENT_CONFLICT";
}
