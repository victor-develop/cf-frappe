import { DEFAULT_TENANT_ID, SYSTEM_MANAGER_ROLE, type Actor, type DocumentSnapshot, type DomainEvent, type JsonValue } from "./types.js";

export type RealtimeTopic = string;

export interface RealtimeEvent {
  readonly id: string;
  readonly type: string;
  readonly topics: readonly RealtimeTopic[];
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly payload: JsonValue;
}

export type RealtimeTopicScope =
  | { readonly kind: "tenant"; readonly tenantId: string }
  | { readonly kind: "user"; readonly tenantId: string; readonly userId: string }
  | { readonly kind: "doctype"; readonly tenantId: string; readonly doctype: string }
  | { readonly kind: "document"; readonly tenantId: string; readonly doctype: string; readonly name: string };

export function tenantRealtimeTopic(tenantId: string): RealtimeTopic {
  return `tenant:${encodeTopicPart(tenantId)}`;
}

export function doctypeRealtimeTopic(tenantId: string, doctype: string): RealtimeTopic {
  return `doctype:${encodeTopicPart(tenantId)}:${encodeTopicPart(doctype)}`;
}

export function userRealtimeTopic(tenantId: string, userId: string): RealtimeTopic {
  return `user:${encodeTopicPart(tenantId)}:${encodeTopicPart(userId)}`;
}

export function documentRealtimeTopic(tenantId: string, doctype: string, name: string): RealtimeTopic {
  return `document:${encodeTopicPart(tenantId)}:${encodeTopicPart(doctype)}:${encodeTopicPart(name)}`;
}

export function parseRealtimeTopic(topic: RealtimeTopic): RealtimeTopicScope | null {
  const parts = topic.split(":");
  if (parts[0] === "tenant" && parts.length === 2) {
    return { kind: "tenant", tenantId: decodeTopicPart(parts[1] ?? "") };
  }
  if (parts[0] === "doctype" && parts.length === 3) {
    return {
      kind: "doctype",
      tenantId: decodeTopicPart(parts[1] ?? ""),
      doctype: decodeTopicPart(parts[2] ?? "")
    };
  }
  if (parts[0] === "user" && parts.length === 3) {
    return {
      kind: "user",
      tenantId: decodeTopicPart(parts[1] ?? ""),
      userId: decodeTopicPart(parts[2] ?? "")
    };
  }
  if (parts[0] === "document" && parts.length === 4) {
    return {
      kind: "document",
      tenantId: decodeTopicPart(parts[1] ?? ""),
      doctype: decodeTopicPart(parts[2] ?? ""),
      name: decodeTopicPart(parts[3] ?? "")
    };
  }
  return null;
}

export function realtimeTopicFromScope(scope: RealtimeTopicScope): RealtimeTopic {
  switch (scope.kind) {
    case "tenant":
      return tenantRealtimeTopic(scope.tenantId);
    case "doctype":
      return doctypeRealtimeTopic(scope.tenantId, scope.doctype);
    case "user":
      return userRealtimeTopic(scope.tenantId, scope.userId);
    case "document":
      return documentRealtimeTopic(scope.tenantId, scope.doctype, scope.name);
  }
}

export function canSubscribeToRealtimeTopic(actor: Actor, topic: RealtimeTopic): boolean {
  const parsed = parseRealtimeTopic(topic);
  if (!parsed) {
    return false;
  }
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  if (parsed.kind === "tenant") {
    return parsed.tenantId === actorTenantId && actor.roles.includes(SYSTEM_MANAGER_ROLE);
  }
  if (parsed.kind === "doctype") {
    return parsed.tenantId === actorTenantId && actor.roles.includes(SYSTEM_MANAGER_ROLE);
  }
  if (parsed.kind === "user") {
    return parsed.tenantId === actorTenantId && (parsed.userId === actor.id || actor.roles.includes(SYSTEM_MANAGER_ROLE));
  }
  return parsed.tenantId === actorTenantId || actor.roles.includes(SYSTEM_MANAGER_ROLE);
}

export function realtimeEventFromDomainEvent(event: DomainEvent, snapshot: DocumentSnapshot | null): RealtimeEvent {
  return {
    id: event.id,
    type: event.type,
    topics: [
      tenantRealtimeTopic(event.tenantId),
      doctypeRealtimeTopic(event.tenantId, event.doctype),
      documentRealtimeTopic(event.tenantId, event.doctype, event.documentName)
    ],
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    payload: {
      event: event as unknown as JsonValue,
      snapshot: snapshot as unknown as JsonValue
    }
  };
}

export function realtimeUserNotificationsFromDomainEvent(event: DomainEvent): readonly RealtimeEvent[] {
  return realtimeUserNotificationRecipients(event).map((recipientId) => ({
    id: `${event.id}:user:${encodeTopicPart(recipientId)}`,
    type: event.type,
    topics: [userRealtimeTopic(event.tenantId, recipientId)],
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    payload: {
      kind: "DocumentUserNotification",
      eventId: event.id,
      eventType: event.type,
      payloadKind: event.payload.kind,
      tenantId: event.tenantId,
      doctype: event.doctype,
      documentName: event.documentName,
      actorId: event.actorId,
      recipientId
    }
  }));
}

function realtimeUserNotificationRecipients(event: DomainEvent): readonly string[] {
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

function encodeTopicPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeTopicPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
