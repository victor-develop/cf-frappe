import { FrameworkError } from "./errors.js";
import { domainEventPayloadKind } from "./domain-events.js";
import { matchesListFilterExpression, normalizeListFilterExpression } from "./list-view.js";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  JsonValue,
  NotificationRuleChannel,
  NotificationRuleDefinition,
  NotificationRuleEventKind,
  NotificationRuleRecipientDefinition,
  TenantId
} from "./types.js";
import type { DocumentUserNotificationPayload } from "./notifications.js";

export const NOTIFICATION_RULE_EVENT_KINDS = Object.freeze([
  "DocumentCreated",
  "DocumentUpdated",
  "DocumentDeleted",
  "DocumentSubmitted",
  "DocumentCancelled",
  "DocumentCommentAdded",
  "DocumentActivityRecorded",
  "DocumentAssigned",
  "DocumentUnassigned",
  "DocumentTagged",
  "DocumentUntagged",
  "DocumentFollowed",
  "DocumentUnfollowed",
  "DocumentShared",
  "DocumentShareRevoked",
  "WorkflowTransitioned",
  "DomainCommandApplied"
] as const satisfies readonly NotificationRuleEventKind[]);

export interface NotificationRuleEntry {
  readonly tenantId: TenantId;
  readonly doctypeName: string;
  readonly rule: NotificationRuleDefinition;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: DocumentData;
}

export interface NotificationRuleState {
  readonly tenantId: TenantId;
  readonly doctypeName: string;
  readonly version: number;
  readonly rules: readonly NotificationRuleEntry[];
}

export interface NotificationRuleEvaluationContext {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
  readonly rules: readonly NotificationRuleDefinition[];
}

export interface DocumentEmailNotificationPayload {
  readonly kind: "DocumentEmailNotification";
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadKind: DomainEvent["payload"]["kind"];
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly recipientId: string;
  readonly subject: string;
  readonly text: string;
  readonly ruleName: string;
}

export function foldNotificationRules(
  tenantId: TenantId,
  doctypeName: string,
  events: readonly DomainEvent[]
): NotificationRuleState {
  const rules = new Map<string, NotificationRuleEntry>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.payload.kind !== "NotificationRuleSaved" && event.payload.kind !== "NotificationRuleCleared") {
      continue;
    }
    version = Math.max(version, event.sequence);
    if (event.payload.doctypeName !== doctypeName) {
      continue;
    }
    if (event.payload.kind === "NotificationRuleSaved") {
      const existing = rules.get(event.payload.rule.name);
      rules.set(event.payload.rule.name, {
        tenantId,
        doctypeName,
        rule: event.payload.rule,
        enabled: event.payload.rule.enabled ?? true,
        createdAt: existing?.createdAt ?? event.occurredAt,
        updatedAt: event.occurredAt,
        metadata: event.metadata
      });
      continue;
    }
    rules.delete(event.payload.ruleName);
  }
  return Object.freeze({
    tenantId,
    doctypeName,
    version,
    rules: Object.freeze([...rules.values()].sort((left, right) => left.rule.name.localeCompare(right.rule.name)))
  });
}

export function normalizeNotificationRule(
  doctype: DocTypeDefinition,
  rule: NotificationRuleDefinition
): NotificationRuleDefinition {
  const name = normalizeRequiredString(rule.name, "Notification rule name");
  const events = normalizeEventKinds(rule.events);
  const recipients = normalizeRecipients(doctype, rule.recipients);
  const channels = normalizeChannels(rule.channels);
  const condition = rule.condition === undefined
    ? undefined
    : normalizeListFilterExpression(doctype, rule.condition, { errorCode: "NOTIFICATION_RULE_INVALID" });
  const subject = optionalTrimmedString(rule.subject, "Notification rule subject");
  const enabled = optionalBoolean(rule.enabled, "Notification rule enabled");
  const excludeActor = optionalBoolean(rule.excludeActor, "Notification rule excludeActor");
  return Object.freeze({
    name,
    ...(enabled === undefined ? {} : { enabled }),
    events: Object.freeze(events),
    recipients: Object.freeze(recipients),
    ...(channels === undefined ? {} : { channels: Object.freeze(channels) }),
    ...(condition === undefined ? {} : { condition }),
    ...(subject === undefined ? {} : { subject }),
    ...(excludeActor === undefined ? {} : { excludeActor })
  });
}

export function notificationRuleUserNotificationsFromDomainEvent(
  context: NotificationRuleEvaluationContext
): readonly DocumentUserNotificationPayload[] {
  const snapshot = context.snapshot;
  if (snapshot === null || !isNotificationRuleEventKind(context.event.payload.kind)) {
    return [];
  }
  const notifications: DocumentUserNotificationPayload[] = [];
  const seen = new Set<string>();
  for (const rule of context.rules) {
    if (!ruleMatches(rule, context.event, snapshot, "inbox")) {
      continue;
    }
    for (const recipientId of notificationRecipientsForRule(rule, snapshot)) {
      if ((rule.excludeActor ?? true) && recipientId === context.event.actorId) {
        continue;
      }
      const key = `${rule.name}\u0000${recipientId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      notifications.push({
        kind: "DocumentUserNotification",
        eventId: context.event.id,
        eventType: context.event.type,
        payloadKind: domainEventPayloadKind(context.event),
        tenantId: context.event.tenantId,
        doctype: context.event.doctype,
        documentName: context.event.documentName,
        actorId: context.event.actorId,
        recipientId,
        subject: renderRuleSubject(rule, context.event, snapshot),
        ruleName: rule.name
      });
    }
  }
  return Object.freeze(notifications);
}

export function notificationRuleEmailNotificationsFromDomainEvent(
  context: NotificationRuleEvaluationContext
): readonly DocumentEmailNotificationPayload[] {
  const snapshot = context.snapshot;
  if (snapshot === null || !isNotificationRuleEventKind(context.event.payload.kind)) {
    return [];
  }
  const notifications: DocumentEmailNotificationPayload[] = [];
  const seen = new Set<string>();
  for (const rule of context.rules) {
    if (!ruleMatches(rule, context.event, snapshot, "email")) {
      continue;
    }
    for (const recipientId of notificationRecipientsForRule(rule, snapshot)) {
      if ((rule.excludeActor ?? true) && recipientId === context.event.actorId) {
        continue;
      }
      const key = `${rule.name}\u0000${recipientId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const subject = renderRuleSubject(rule, context.event, snapshot);
      notifications.push({
        kind: "DocumentEmailNotification",
        eventId: context.event.id,
        eventType: context.event.type,
        payloadKind: domainEventPayloadKind(context.event),
        tenantId: context.event.tenantId,
        doctype: context.event.doctype,
        documentName: context.event.documentName,
        actorId: context.event.actorId,
        recipientId,
        subject,
        text: renderRuleEmailText(subject, rule, context.event),
        ruleName: rule.name
      });
    }
  }
  return Object.freeze(notifications);
}

function normalizeEventKinds(values: readonly NotificationRuleEventKind[]): readonly NotificationRuleEventKind[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Notification rule events must contain at least one event kind");
  }
  const normalized: NotificationRuleEventKind[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !isNotificationRuleEventKind(value)) {
      throw invalid(`Notification rule event kind '${String(value)}' is not supported`);
    }
    if (seen.has(value)) {
      throw invalid(`Notification rule events contain duplicate '${value}'`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeChannels(values: readonly NotificationRuleChannel[] | undefined): readonly NotificationRuleChannel[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Notification rule channels must contain at least one channel");
  }
  const channels: NotificationRuleChannel[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value !== "inbox" && value !== "email") {
      throw invalid(`Notification rule channel '${String(value)}' is not supported`);
    }
    if (seen.has(value)) {
      throw invalid(`Notification rule channels contain duplicate '${value}'`);
    }
    seen.add(value);
    channels.push(value);
  }
  return channels;
}

function normalizeRecipients(
  doctype: DocTypeDefinition,
  values: readonly NotificationRuleRecipientDefinition[]
): readonly NotificationRuleRecipientDefinition[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Notification rule recipients must contain at least one recipient");
  }
  const recipients: NotificationRuleRecipientDefinition[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const recipient = normalizeRecipient(doctype, value);
    const key = JSON.stringify(recipient);
    if (seen.has(key)) {
      throw invalid("Notification rule recipients contain a duplicate recipient");
    }
    seen.add(key);
    recipients.push(recipient);
  }
  return recipients;
}

function normalizeRecipient(
  doctype: DocTypeDefinition,
  value: NotificationRuleRecipientDefinition
): NotificationRuleRecipientDefinition {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw invalid("Notification rule recipient must be an object");
  }
  if (value.kind === "user") {
    return Object.freeze({ kind: "user", userId: normalizeUserId(value.userId, "Notification rule recipient userId") });
  }
  if (value.kind === "field") {
    const fieldName = normalizeRequiredString(value.field, "Notification rule recipient field");
    const field = requireField(doctype, fieldName);
    assertRecipientField(field);
    return Object.freeze({ kind: "field", field: field.name });
  }
  if (value.kind === "documentOwner") {
    return Object.freeze({ kind: "documentOwner" });
  }
  throw invalid(`Notification rule recipient kind '${String((value as { readonly kind?: unknown }).kind)}' is not supported`);
}

function notificationRecipientsForRule(
  rule: NotificationRuleDefinition,
  snapshot: DocumentSnapshot
): readonly string[] {
  const recipients: string[] = [];
  for (const recipient of rule.recipients) {
    if (recipient.kind === "user") {
      recipients.push(recipient.userId);
      continue;
    }
    if (recipient.kind === "field") {
      recipients.push(...userIdsFromValue(snapshot.data[recipient.field]));
      continue;
    }
    recipients.push(...userIdsFromValue(snapshot.data.created_by));
  }
  return uniqueRecipients(recipients);
}

function userIdsFromValue(value: JsonValue | undefined): readonly string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function uniqueRecipients(recipients: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    if (seen.has(recipient)) {
      return false;
    }
    seen.add(recipient);
    return true;
  });
}

function renderRuleSubject(
  rule: NotificationRuleDefinition,
  event: DomainEvent,
  snapshot: DocumentSnapshot
): string {
  const subject = rule.subject?.trim();
  if (subject) {
    return subject
      .replaceAll("{{ doctype }}", event.doctype)
      .replaceAll("{{ name }}", event.documentName)
      .replaceAll("{{ actor }}", event.actorId);
  }
  const title = typeof snapshot.data.title === "string" && snapshot.data.title.trim()
    ? snapshot.data.title.trim()
    : event.documentName;
  return `${event.actorId} triggered ${rule.name} for ${event.doctype} ${title}`;
}

function renderRuleEmailText(subject: string, rule: NotificationRuleDefinition, event: DomainEvent): string {
  return [
    subject,
    "",
    `Document: ${event.doctype} ${event.documentName}`,
    `Event: ${event.payload.kind}`,
    `Actor: ${event.actorId}`,
    `Rule: ${rule.name}`
  ].join("\n");
}

function ruleMatches(
  rule: NotificationRuleDefinition,
  event: DomainEvent,
  snapshot: DocumentSnapshot,
  channel: NotificationRuleChannel
): boolean {
  return (rule.enabled ?? true) !== false &&
    rule.events.includes(event.payload.kind as NotificationRuleEventKind) &&
    matchesListFilterExpression(snapshot, rule.condition) &&
    ruleChannels(rule).includes(channel);
}

function ruleChannels(rule: NotificationRuleDefinition): readonly NotificationRuleChannel[] {
  return rule.channels ?? ["inbox"];
}

function isNotificationRuleEventKind(value: string): value is NotificationRuleEventKind {
  return (NOTIFICATION_RULE_EVENT_KINDS as readonly string[]).includes(value);
}

function requireField(doctype: DocTypeDefinition, fieldName: string): FieldDefinition {
  const field = doctype.fields.find((item) => item.name === fieldName);
  if (!field) {
    throw invalid(`Notification rule recipient field '${fieldName}' is not defined on ${doctype.name}`);
  }
  return field;
}

function assertRecipientField(field: FieldDefinition): void {
  if (!["text", "longText", "select", "link", "json"].includes(field.type)) {
    throw invalid(`Notification rule recipient field '${field.name}' must store user ids`);
  }
}

function optionalBoolean(value: boolean | undefined, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalid(`${label} must be a boolean`);
  }
  return value;
}

function optionalTrimmedString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalid(`${label} must be a string`);
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw invalid(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw invalid(`${label} is required`);
  }
  return normalized;
}

function normalizeUserId(value: string, label: string): string {
  return normalizeRequiredString(value, label);
}

function invalid(message: string): FrameworkError {
  return new FrameworkError("NOTIFICATION_RULE_INVALID", message, { status: 400 });
}
