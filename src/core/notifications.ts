import type {
  DocTypeName,
  DocumentEventPayload,
  DocumentName,
  DomainEvent,
  NotificationRuleDefinition,
  TenantId
} from "./types.js";
import { domainEventPayloadKind } from "./domain-events.js";
import {
  notificationRuleEmailNotificationsFromDomainEvent,
  notificationRuleUserNotificationsFromDomainEvent
} from "./notification-rules.js";
import type { DocumentEmailNotificationPayload } from "./notification-rules.js";

export interface DocumentUserNotificationPayload {
  readonly kind: "DocumentUserNotification";
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadKind: DocumentEventPayload["kind"];
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly documentName: DocumentName;
  readonly actorId: string;
  readonly recipientId: string;
  readonly subject?: string;
  readonly ruleName?: string;
}

export function documentUserNotificationsFromDomainEvent(
  event: DomainEvent
): readonly DocumentUserNotificationPayload[] {
  return documentUserNotificationRecipients(event).map((recipientId) => ({
    kind: "DocumentUserNotification",
    eventId: event.id,
    eventType: event.type,
    payloadKind: domainEventPayloadKind(event),
    tenantId: event.tenantId,
    doctype: event.doctype,
    documentName: event.documentName,
    actorId: event.actorId,
    recipientId
  }));
}

export function documentUserNotificationsFromRules(
  event: DomainEvent,
  snapshot: Parameters<typeof notificationRuleUserNotificationsFromDomainEvent>[0]["snapshot"],
  rules: readonly NotificationRuleDefinition[]
): readonly DocumentUserNotificationPayload[] {
  return notificationRuleUserNotificationsFromDomainEvent({ event, snapshot, rules });
}

export function documentEmailNotificationsFromRules(
  event: DomainEvent,
  snapshot: Parameters<typeof notificationRuleEmailNotificationsFromDomainEvent>[0]["snapshot"],
  rules: readonly NotificationRuleDefinition[]
): readonly DocumentEmailNotificationPayload[] {
  return notificationRuleEmailNotificationsFromDomainEvent({ event, snapshot, rules });
}

function documentUserNotificationRecipients(event: DomainEvent): readonly string[] {
  switch (event.payload.kind) {
    case "DocumentAssigned":
    case "DocumentUnassigned":
      return [event.payload.assigneeId];
    case "DocumentFollowed":
    case "DocumentUnfollowed":
      return [event.payload.followerId];
    case "DocumentShared":
    case "DocumentShareRevoked":
      return [event.payload.userId];
    default:
      return [];
  }
}
