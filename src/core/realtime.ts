import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentSnapshot,
  type DomainEvent,
  type JsonValue
} from "./types.js";
import { isJsonValue } from "./json.js";
import { documentUserNotificationsFromDomainEvent } from "./notifications.js";
export { documentUserNotificationsFromDomainEvent } from "./notifications.js";
export type { DocumentUserNotificationPayload } from "./notifications.js";

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

export const REALTIME_COLLABORATION_MESSAGE_TYPE = "cf-frappe.realtime.collaboration";
export const DOCUMENT_FIELD_EDIT_MESSAGE_TYPE = "cf-frappe.collaboration.field_edit";
export const DOCUMENT_FIELD_EDIT_EVENT_TYPE = "DocumentFieldEditIntent";
export const DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE = "cf-frappe.collaboration.shared_draft";
export const DOCUMENT_SHARED_DRAFT_EVENT_TYPE = "DocumentSharedDraftPatch";

export interface RealtimeConnectionIdentity {
  readonly connectionId: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

export interface DocumentFieldEditMessage {
  readonly type: typeof DOCUMENT_FIELD_EDIT_MESSAGE_TYPE;
  readonly field: string;
  readonly editing?: boolean;
  readonly value?: JsonValue;
}

export interface DocumentSharedDraftMessage {
  readonly type: typeof DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE;
  readonly baseVersion?: number;
  readonly patch?: Readonly<Record<string, JsonValue>>;
  readonly unset?: readonly string[];
}

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
  return documentUserNotificationsFromDomainEvent(event).map((notification) => ({
    id: `${event.id}:user:${encodeTopicPart(notification.recipientId)}`,
    type: event.type,
    topics: [userRealtimeTopic(event.tenantId, notification.recipientId)],
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    payload: notification as unknown as JsonValue
  }));
}

export function realtimeEventFromDocumentFieldEdit(input: {
  readonly id: string;
  readonly topic: RealtimeTopic;
  readonly connection: RealtimeConnectionIdentity;
  readonly message: unknown;
  readonly occurredAt: string;
}): RealtimeEvent | null {
  const scope = parseRealtimeTopic(input.topic);
  if (!scope || scope.kind !== "document") {
    return null;
  }
  const message = documentFieldEditMessage(input.message);
  if (!message) {
    return null;
  }
  return {
    id: input.id,
    type: DOCUMENT_FIELD_EDIT_EVENT_TYPE,
    topics: [input.topic],
    tenantId: scope.tenantId,
    occurredAt: input.occurredAt,
    payload: {
      kind: DOCUMENT_FIELD_EDIT_EVENT_TYPE,
      tenantId: scope.tenantId,
      doctype: scope.doctype,
      name: scope.name,
      field: message.field,
      editing: message.editing ?? true,
      connectionId: input.connection.connectionId,
      ...(input.connection.userId === undefined ? {} : { actorId: input.connection.userId }),
      ...(Object.prototype.hasOwnProperty.call(message, "value") ? { value: message.value as JsonValue } : {})
    }
  };
}

export function realtimeEventFromDocumentSharedDraft(input: {
  readonly id: string;
  readonly topic: RealtimeTopic;
  readonly connection: RealtimeConnectionIdentity;
  readonly message: unknown;
  readonly occurredAt: string;
}): RealtimeEvent | null {
  const scope = parseRealtimeTopic(input.topic);
  if (!scope || scope.kind !== "document") {
    return null;
  }
  const message = documentSharedDraftMessage(input.message);
  if (!message) {
    return null;
  }
  return {
    id: input.id,
    type: DOCUMENT_SHARED_DRAFT_EVENT_TYPE,
    topics: [input.topic],
    tenantId: scope.tenantId,
    occurredAt: input.occurredAt,
    payload: {
      kind: DOCUMENT_SHARED_DRAFT_EVENT_TYPE,
      tenantId: scope.tenantId,
      doctype: scope.doctype,
      name: scope.name,
      ...(message.baseVersion === undefined ? {} : { baseVersion: message.baseVersion }),
      ...(message.patch === undefined ? {} : { patch: message.patch as JsonValue }),
      ...(message.unset === undefined ? {} : { unset: message.unset as unknown as JsonValue }),
      connectionId: input.connection.connectionId,
      ...(input.connection.userId === undefined ? {} : { actorId: input.connection.userId })
    }
  };
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

function documentFieldEditMessage(value: unknown): DocumentFieldEditMessage | null {
  if (!isRecord(value) || value.type !== DOCUMENT_FIELD_EDIT_MESSAGE_TYPE) {
    return null;
  }
  const field = typeof value.field === "string" ? value.field.trim() : "";
  if (field.length === 0 || field.length > 256) {
    return null;
  }
  if (value.editing !== undefined && typeof value.editing !== "boolean") {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(value, "value") && !isJsonValue(value.value, { maxDepth: 8 })) {
    return null;
  }
  const message: {
    type: typeof DOCUMENT_FIELD_EDIT_MESSAGE_TYPE;
    field: string;
    editing?: boolean;
    value?: JsonValue;
  } = {
    type: DOCUMENT_FIELD_EDIT_MESSAGE_TYPE,
    field
  };
  if (value.editing !== undefined) {
    message.editing = value.editing;
  }
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    message.value = value.value as JsonValue;
  }
  if (JSON.stringify(message).length > 16_384) {
    return null;
  }
  return message;
}

function documentSharedDraftMessage(value: unknown): DocumentSharedDraftMessage | null {
  if (!isRecord(value) || value.type !== DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE) {
    return null;
  }
  const baseVersion = value.baseVersion;
  if (
    baseVersion !== undefined &&
    (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0)
  ) {
    return null;
  }
  const patch = value.patch === undefined ? undefined : documentSharedDraftPatch(value.patch);
  const unset = value.unset === undefined ? undefined : documentSharedDraftUnset(value.unset);
  if (patch === null || unset === null) {
    return null;
  }
  const patchKeys = patch ? Object.keys(patch) : [];
  const unsetFields = unset ?? [];
  if (patchKeys.length === 0 && unsetFields.length === 0) {
    return null;
  }
  if (unsetFields.some((field) => patchKeys.includes(field))) {
    return null;
  }
  const message: {
    type: typeof DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE;
    baseVersion?: number;
    patch?: Readonly<Record<string, JsonValue>>;
    unset?: readonly string[];
  } = {
    type: DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE
  };
  if (baseVersion !== undefined) {
    message.baseVersion = baseVersion;
  }
  if (patchKeys.length > 0 && patch) {
    message.patch = patch;
  }
  if (unsetFields.length > 0) {
    message.unset = unsetFields;
  }
  if (JSON.stringify(message).length > 16_384) {
    return null;
  }
  return message;
}

function documentSharedDraftPatch(value: unknown): Readonly<Record<string, JsonValue>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const patch: Record<string, JsonValue> = {};
  for (const [rawField, fieldValue] of Object.entries(value)) {
    const field = documentSharedDraftField(rawField);
    if (!field || Object.prototype.hasOwnProperty.call(patch, field) || !isJsonValue(fieldValue, { maxDepth: 8 })) {
      return null;
    }
    patch[field] = fieldValue;
  }
  return patch;
}

function documentSharedDraftUnset(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const unset: string[] = [];
  for (const item of value) {
    const field = typeof item === "string" ? documentSharedDraftField(item) : null;
    if (!field || unset.includes(field)) {
      return null;
    }
    unset.push(field);
  }
  return unset;
}

function documentSharedDraftField(value: string): string | null {
  const field = value.trim();
  return field.length > 0 && field.length <= 256 ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
