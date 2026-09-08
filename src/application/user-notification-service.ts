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
  foldUserNotificationsFrom,
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
import type { SnapshotStore } from "../ports/snapshot-store.js";
import { StreamFoldSnapshots, type StreamFold } from "./stream-fold-snapshots.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import {
  normalizeUserNotificationId,
  normalizeUserNotificationInboxLimit,
  planUserNotificationAccess,
  planUserNotificationDismiss,
  planUserNotificationLookup,
  planUserNotificationRecord,
  planUserNotificationRead,
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
  /**
   * Folded state cached so a notification does not replay a user's whole
   * history.
   *
   * Optional, and omitting it leaves every path identical to not having the
   * feature — issue #17's rule that a snapshot may always be ignored, held by
   * construction. This stream never ends: it grows for as long as the user
   * receives notifications, and every read and write folded all of it.
   */
  readonly snapshots?: SnapshotStore;
}

/**
 * The fold, with its event filter bound to it.
 *
 * Bound rather than passed per call so a snapshot can never be taken over one
 * subset of the stream's events and resumed over another.
 */
const USER_NOTIFICATIONS_FOLD = (tenantId: TenantId, userId: string): StreamFold<UserNotificationState> => ({
  name: "userNotifications",
  version: 1,
  payloadKinds: USER_NOTIFICATION_PAYLOAD_KINDS,
  foldFrom: (prior, events) => foldUserNotificationsFrom(prior, tenantId, userId, events)
});

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
  private readonly foldSnapshots: StreamFoldSnapshots;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly notificationRules: NotificationRuleProvider | undefined;

  constructor(options: UserNotificationServiceOptions) {
    this.events = options.events;
    this.foldSnapshots = new StreamFoldSnapshots(options.events, options.snapshots);
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
    if (planUserNotificationRead(notification).status === "noop") {
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
    if (planUserNotificationDismiss(notification).status === "noop") {
      return notification;
    }
    await this.appendUserNotificationEvent(state, actor, {
      kind: "UserNotificationDismissed",
      notificationId: id
    }, command.metadata);
    return requireReplayedNotification(await this.state(tenantId, userId), id);
  }

  private async state(tenantId: TenantId, userId: string): Promise<UserNotificationState> {
    return this.foldSnapshots.resume(
      userNotificationsStream(tenantId, userId),
      USER_NOTIFICATIONS_FOLD(tenantId, userId)
    );
  }

  /**
   * Records the state an append just produced.
   *
   * Called with the state already folded forward over the saved events, so this
   * costs no extra read. The sequence comes from the saved events because only
   * the caller knows which of them landed on this stream.
   */
  private async recordState(state: UserNotificationState, saved: readonly DomainEvent[]): Promise<void> {
    const stream = userNotificationsStream(state.tenantId, state.userId);
    const uptoSequence = saved.filter((event) => event.stream === stream).at(-1)?.sequence;
    if (uptoSequence === undefined) {
      return;
    }
    await this.foldSnapshots.record(
      stream,
      USER_NOTIFICATIONS_FOLD(state.tenantId, state.userId),
      state,
      uptoSequence
    );
  }

  private async recordNotification(
    notification: DocumentUserNotificationPayload,
    occurredAt: string
  ): Promise<UserNotificationRecord> {
    const notificationId = notificationIdentity(notification);
    for (let attempt = 1; attempt <= MAX_NOTIFICATION_APPEND_ATTEMPTS; attempt += 1) {
      const state = await this.state(notification.tenantId, notification.recipientId);
      const decision = planUserNotificationRecord(state, notificationId);
      if (decision.status === "noop") {
        return decision.notification;
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
        const appended = await this.events.append(stream, state.version, [
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
        const [saved] = appended;
        // Folded forward from the state this attempt already read, so recording
        // costs no extra read.
        await this.recordState(
          USER_NOTIFICATIONS_FOLD(notification.tenantId, notification.recipientId).foldFrom(state, appended),
          appended
        );
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
    const decision = planUserNotificationLookup(state, id);
    if (decision.status === "missing") {
      throw notFound(decision.message, decision.code);
    }
    return decision.notification;
  }

  private async appendUserNotificationEvent(
    state: UserNotificationState,
    actor: Actor,
    payload: Extract<UserNotificationEventPayloadForService, { readonly kind: "UserNotificationRead" | "UserNotificationDismissed" }>,
    metadata: DocumentData | undefined
  ): Promise<DomainEvent> {
    const stream = userNotificationsStream(state.tenantId, state.userId);
    const appended = await this.events.append(stream, state.version, [
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
    const [event] = appended;
    await this.recordState(
      USER_NOTIFICATIONS_FOLD(state.tenantId, state.userId).foldFrom(state, appended),
      appended
    );
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
