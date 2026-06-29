import { notFound, permissionDenied } from "../core/errors.js";
import {
  documentUserNotificationsFromDomainEvent,
  documentUserNotificationsFromRules,
  type DocumentUserNotificationPayload
} from "../core/notifications.js";
import { userNotificationsStream } from "../core/streams.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DocumentSnapshot,
  type DomainEvent,
  type NotificationRuleDefinition,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  foldUserNotifications,
  notificationFromRecordedEvent,
  notificationIdentity,
  requireAppendedUserNotificationEvent,
  requireReplayedNotification,
  USER_NOTIFICATION_PAYLOAD_KINDS,
  userNotificationEventType,
  type UserNotificationEventPayload as UserNotificationEventPayloadForService,
  type UserNotificationRecord,
  type UserNotificationState
} from "./user-notification-events.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import {
  normalizeUserNotificationId,
  normalizeUserNotificationInboxLimit,
  planUserNotificationAccess,
  userNotificationInboxProjection,
  type UserNotificationInbox
} from "./user-notification-policy.js";
import { isDocumentConflictError } from "./concurrency-policy.js";

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

export type { UserNotificationEventPayload, UserNotificationRecord } from "./user-notification-events.js";
export type { UserNotificationInbox } from "./user-notification-policy.js";

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
    return userNotificationInboxProjection({
      state,
      limit: normalizeUserNotificationInboxLimit(query.limit),
      unreadOnly: query.unreadOnly,
      includeDismissed: query.includeDismissed
    });
  }

  async markRead(
    actor: Actor,
    notificationId: string,
    command: UserNotificationCommand = {}
  ): Promise<UserNotificationRecord> {
    const { tenantId, userId } = this.authorizeUser(actor, command.userId);
    const state = await this.state(tenantId, userId);
    const id = normalizeUserNotificationId(notificationId);
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
    const id = normalizeUserNotificationId(notificationId);
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
      await this.events.readStream(userNotificationsStream(tenantId, userId), {
        payloadKinds: USER_NOTIFICATION_PAYLOAD_KINDS
      })
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
        const payload: Extract<UserNotificationEventPayloadForService, { readonly kind: "UserNotificationRecorded" }> = {
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
        };
        const [saved] = await this.events.append(stream, state.version, [
          {
            id: this.ids.next("evt_"),
            tenantId: notification.tenantId,
            stream,
            type: userNotificationEventType(payload),
            doctype: "__UserNotifications",
            documentName: notification.recipientId,
            actorId: notification.actorId,
            occurredAt,
            payload,
            metadata: {}
          } satisfies NewDomainEvent
        ]);
        return notificationFromRecordedEvent(
          requireAppendedUserNotificationEvent(
            saved,
            notification.tenantId,
            notification.recipientId,
            notificationId,
            "UserNotificationRecorded"
          )
        );
      } catch (error) {
        if (isDocumentConflictError(error) && attempt < MAX_NOTIFICATION_APPEND_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unreachable notification append retry state");
  }

  private requireNotification(state: UserNotificationState, notificationId: string): UserNotificationRecord {
    const id = normalizeUserNotificationId(notificationId);
    const notification = state.notifications.get(id);
    if (!notification) {
      throw notFound(`Notification '${id}' was not found`);
    }
    return notification;
  }

  private async appendUserNotificationEvent(
    state: UserNotificationState,
    actor: Actor,
    payload: Extract<UserNotificationEventPayloadForService, { readonly kind: "UserNotificationRead" | "UserNotificationDismissed" }>,
    metadata: DocumentData | undefined
  ): Promise<DomainEvent> {
    const stream = userNotificationsStream(state.tenantId, state.userId);
    const [event] = await this.events.append(stream, state.version, [
      {
        id: this.ids.next("evt_"),
        tenantId: state.tenantId,
        stream,
        type: userNotificationEventType(payload),
        doctype: "__UserNotifications",
        documentName: state.userId,
        actorId: actor.id,
        occurredAt: this.clock.now(),
        payload,
        metadata: metadata ?? {}
      }
    ]);
    return requireAppendedUserNotificationEvent(
      event,
      state.tenantId,
      state.userId,
      payload.notificationId,
      userNotificationEventType(payload)
    );
  }

  private authorizeUser(actor: Actor, explicitUserId?: string): { readonly tenantId: TenantId; readonly userId: string } {
    const decision = planUserNotificationAccess({
      actor,
      adminRoles: this.adminRoles,
      ...(explicitUserId === undefined ? {} : { explicitUserId })
    });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return { tenantId: decision.tenantId, userId: decision.userId };
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
