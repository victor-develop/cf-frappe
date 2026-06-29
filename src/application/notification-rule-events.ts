import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  NOTIFICATION_RULE_STATE_PAYLOAD_KINDS,
  foldNotificationRules,
  isNotificationRuleStatePayloadKind,
  notificationRuleStateEventType,
  type NotificationRuleState,
  type NotificationRuleStateEventPayload,
  type NotificationRuleStatePayloadKind
} from "../core/notification-rules.js";
import type {
  Actor,
  DocTypeName,
  DocumentData,
  DomainEvent,
  NewDomainEvent,
  NotificationRuleDefinition,
  StreamName,
  TenantId
} from "../core/types.js";

export type NotificationRuleEventPayload = NotificationRuleStateEventPayload;

export type NotificationRulePayloadKind = NotificationRuleStatePayloadKind;

export const NOTIFICATION_RULE_PAYLOAD_KINDS = NOTIFICATION_RULE_STATE_PAYLOAD_KINDS;

export interface NotificationRuleSavedPayloadInput {
  readonly doctypeName: DocTypeName;
  readonly rule: NotificationRuleDefinition;
}

export interface NotificationRuleClearedPayloadInput {
  readonly doctypeName: DocTypeName;
  readonly ruleName: string;
}

export function notificationRuleSavedPayload(
  input: NotificationRuleSavedPayloadInput
): Extract<NotificationRuleEventPayload, { readonly kind: "NotificationRuleSaved" }> {
  return {
    kind: "NotificationRuleSaved",
    doctypeName: input.doctypeName,
    rule: input.rule
  };
}

export function notificationRuleClearedPayload(
  input: NotificationRuleClearedPayloadInput
): Extract<NotificationRuleEventPayload, { readonly kind: "NotificationRuleCleared" }> {
  return {
    kind: "NotificationRuleCleared",
    doctypeName: input.doctypeName,
    ruleName: input.ruleName
  };
}

export interface NotificationRuleEventOptions<TPayload extends NotificationRuleEventPayload> {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actor: Actor;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}

export function notificationRuleEvent<TPayload extends NotificationRuleEventPayload>(
  options: NotificationRuleEventOptions<TPayload>
): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: notificationRuleEventType(options.payload),
    doctype: "__NotificationRules",
    documentName: notificationRuleDocumentName(options.payload),
    actorId: options.actor.id,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function notificationRuleEventType(
  payload: NotificationRuleEventPayload
): NotificationRulePayloadKind {
  return notificationRuleStateEventType(payload);
}

export function isNotificationRulePayloadKind(kind: string): kind is NotificationRulePayloadKind {
  return isNotificationRuleStatePayloadKind(kind);
}

export function isNotificationRuleEvent(event: DomainEvent): event is DomainEvent<NotificationRuleEventPayload> {
  return isNotificationRulePayloadKind(domainEventPayloadKind(event));
}

export function notificationRuleDocumentName(payload: NotificationRuleEventPayload): string {
  return `${payload.doctypeName}:${notificationRuleNameForPayload(payload)}`;
}

export function notificationRuleNameForPayload(payload: NotificationRuleEventPayload): string {
  if (payload.kind === "NotificationRuleSaved") {
    return payload.rule.name;
  }
  return payload.ruleName;
}

export function notificationRuleEventsVisibleAt(
  events: readonly DomainEvent[],
  occurredAt: string | undefined
): readonly DomainEvent[] {
  return occurredAt === undefined ? events : events.filter((event) => event.occurredAt <= occurredAt);
}

export function replayNotificationRuleAppend(
  state: NotificationRuleState,
  previousEvents: readonly DomainEvent[],
  savedEvents: readonly DomainEvent[]
): NotificationRuleState {
  return foldNotificationRules(state.tenantId, state.doctypeName, [...previousEvents, ...savedEvents]);
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly NotificationRuleSaved: Extract<
      NotificationRuleEventPayload,
      { readonly kind: "NotificationRuleSaved" }
    >;
    readonly NotificationRuleCleared: Extract<
      NotificationRuleEventPayload,
      { readonly kind: "NotificationRuleCleared" }
    >;
  }
}
