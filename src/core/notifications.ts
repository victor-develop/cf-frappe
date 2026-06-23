import type {
  DocTypeName,
  DocumentEventPayload,
  DocumentName,
  DomainEvent,
  TenantId
} from "./types.js";

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
}

export function documentUserNotificationsFromDomainEvent(
  event: DomainEvent
): readonly DocumentUserNotificationPayload[] {
  return documentUserNotificationRecipients(event).map((recipientId) => ({
    kind: "DocumentUserNotification",
    eventId: event.id,
    eventType: event.type,
    payloadKind: event.payload.kind,
    tenantId: event.tenantId,
    doctype: event.doctype,
    documentName: event.documentName,
    actorId: event.actorId,
    recipientId
  }));
}

function documentUserNotificationRecipients(event: DomainEvent): readonly string[] {
  switch (event.payload.kind) {
    case "DocumentAssigned":
    case "DocumentUnassigned":
      return [event.payload.assigneeId];
    case "DocumentFollowed":
    case "DocumentUnfollowed":
      return [event.payload.followerId];
    default:
      return [];
  }
}
