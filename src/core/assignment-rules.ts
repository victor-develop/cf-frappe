import { FrameworkError } from "./errors.js";
import { domainEventPayloadKind } from "./domain-events.js";
import { matchesListFilterExpression, normalizeListFilterExpression } from "./list-view.js";
import type {
  AssignmentRuleAssigneeDefinition,
  AssignmentRuleDefinition,
  AssignmentRuleEventKind,
  DocTypeName,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  TenantId
} from "./types.js";

export const ASSIGNMENT_RULE_EVENT_KINDS = Object.freeze([
  "DocumentCreated",
  "DocumentUpdated",
  "DocumentSubmitted",
  "DocumentCancelled",
  "WorkflowTransitioned",
  "DomainCommandApplied"
] as const satisfies readonly AssignmentRuleEventKind[]);

export type AssignmentRuleStatePayloadKind = "AssignmentRuleSaved" | "AssignmentRuleCleared";

export type AssignmentRuleStateEventPayload =
  | {
      readonly kind: "AssignmentRuleSaved";
      readonly doctypeName: DocTypeName;
      readonly rule: AssignmentRuleDefinition;
    }
  | {
      readonly kind: "AssignmentRuleCleared";
      readonly doctypeName: DocTypeName;
      readonly ruleName: string;
    };

export const ASSIGNMENT_RULE_STATE_PAYLOAD_KINDS = Object.freeze([
  "AssignmentRuleSaved",
  "AssignmentRuleCleared"
] as const satisfies readonly AssignmentRuleStatePayloadKind[]);

const ASSIGNMENT_RULE_STATE_PAYLOAD_KIND_SET = new Set<string>(ASSIGNMENT_RULE_STATE_PAYLOAD_KINDS);

export interface AssignmentRuleEvaluationContext {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
  readonly rules: readonly AssignmentRuleDefinition[];
}

export interface AssignmentRuleEntry {
  readonly tenantId: TenantId;
  readonly doctypeName: string;
  readonly rule: AssignmentRuleDefinition;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: DocumentData;
}

export interface AssignmentRuleState {
  readonly tenantId: TenantId;
  readonly doctypeName: string;
  readonly version: number;
  readonly rules: readonly AssignmentRuleEntry[];
}

export interface AssignmentRuleDocumentAssignment {
  readonly assigneeId: string;
  readonly ruleName: string;
}

export function foldAssignmentRules(
  tenantId: TenantId,
  doctypeName: string,
  events: readonly DomainEvent[]
): AssignmentRuleState {
  const rules = new Map<string, AssignmentRuleEntry>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!isAssignmentRuleStateEvent(event)) {
      continue;
    }
    version = Math.max(version, event.sequence);
    if (event.payload.doctypeName !== doctypeName) {
      continue;
    }
    if (event.payload.kind === "AssignmentRuleSaved") {
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

export function assignmentRuleStateEventType(payload: AssignmentRuleStateEventPayload): AssignmentRuleStatePayloadKind {
  return payload.kind;
}

export function isAssignmentRuleStatePayloadKind(kind: string): kind is AssignmentRuleStatePayloadKind {
  return ASSIGNMENT_RULE_STATE_PAYLOAD_KIND_SET.has(kind);
}

function isAssignmentRuleStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: AssignmentRuleStateEventPayload } {
  return isAssignmentRuleStatePayloadKind(domainEventPayloadKind(event));
}

export function normalizeAssignmentRules(
  doctype: DocTypeDefinition,
  rules: readonly AssignmentRuleDefinition[] | undefined
): readonly AssignmentRuleDefinition[] | undefined {
  if (rules === undefined) {
    return undefined;
  }
  if (!Array.isArray(rules)) {
    throw invalid("Assignment rules must be an array");
  }
  const normalized: AssignmentRuleDefinition[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const normalizedRule = normalizeAssignmentRule(doctype, rule);
    if (seen.has(normalizedRule.name)) {
      throw invalid(`Assignment rule '${normalizedRule.name}' is duplicated`);
    }
    seen.add(normalizedRule.name);
    normalized.push(normalizedRule);
  }
  return Object.freeze(normalized);
}

export function normalizeAssignmentRule(
  doctype: DocTypeDefinition,
  rule: AssignmentRuleDefinition
): AssignmentRuleDefinition {
  const name = normalizeRequiredString(rule.name, "Assignment rule name");
  const enabled = optionalBoolean(rule.enabled, "Assignment rule enabled");
  const events = normalizeEventKinds(rule.events);
  const assignees = normalizeAssignees(doctype, rule.assignees);
  const condition = rule.condition === undefined
    ? undefined
    : normalizeListFilterExpression(doctype, rule.condition, { errorCode: "ASSIGNMENT_RULE_INVALID" });
  const excludeActor = optionalBoolean(rule.excludeActor, "Assignment rule excludeActor");
  return Object.freeze({
    name,
    ...(enabled === undefined ? {} : { enabled }),
    events: Object.freeze(events),
    assignees: Object.freeze(assignees),
    ...(condition === undefined ? {} : { condition }),
    ...(excludeActor === undefined ? {} : { excludeActor })
  });
}

export function assignmentRuleAssignmentsFromDomainEvent(
  context: AssignmentRuleEvaluationContext
): readonly AssignmentRuleDocumentAssignment[] {
  const snapshot = context.snapshot;
  const payloadKind = domainEventPayloadKind(context.event);
  if (snapshot === null || snapshot.docstatus === "deleted" || !isAssignmentRuleEventKind(payloadKind)) {
    return [];
  }
  const assignments: AssignmentRuleDocumentAssignment[] = [];
  const seen = new Set<string>();
  for (const rule of context.rules) {
    if (!ruleMatches(rule, context.event, snapshot)) {
      continue;
    }
    for (const assigneeId of assignmentRuleAssignees(rule, snapshot)) {
      if ((rule.excludeActor ?? false) && assigneeId === context.event.actorId) {
        continue;
      }
      const key = `${rule.name}\u0000${assigneeId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      assignments.push({ assigneeId, ruleName: rule.name });
    }
  }
  return Object.freeze(assignments);
}

function ruleMatches(
  rule: AssignmentRuleDefinition,
  event: DomainEvent,
  snapshot: DocumentSnapshot
): boolean {
  const payloadKind = domainEventPayloadKind(event);
  if (rule.enabled === false || !rule.events.includes(payloadKind as AssignmentRuleEventKind)) {
    return false;
  }
  if (rule.condition === undefined) {
    return true;
  }
  return matchesListFilterExpression(snapshot, rule.condition);
}

function assignmentRuleAssignees(
  rule: AssignmentRuleDefinition,
  snapshot: DocumentSnapshot
): readonly string[] {
  const assignees: string[] = [];
  for (const assignee of rule.assignees) {
    const assigneeId = assignee.kind === "user"
      ? assignee.userId
      : documentStringValue(snapshot, assignee.field);
    if (assigneeId !== undefined && !assignees.includes(assigneeId)) {
      assignees.push(assigneeId);
    }
  }
  return assignees;
}

function normalizeEventKinds(values: readonly AssignmentRuleEventKind[]): readonly AssignmentRuleEventKind[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Assignment rule events must contain at least one event kind");
  }
  const normalized: AssignmentRuleEventKind[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !isAssignmentRuleEventKind(value)) {
      throw invalid(`Assignment rule event kind '${String(value)}' is not supported`);
    }
    if (seen.has(value)) {
      throw invalid(`Assignment rule events contain duplicate '${value}'`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeAssignees(
  doctype: DocTypeDefinition,
  values: readonly AssignmentRuleAssigneeDefinition[]
): readonly AssignmentRuleAssigneeDefinition[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Assignment rule assignees must contain at least one assignee");
  }
  const assignees: AssignmentRuleAssigneeDefinition[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const assignee = normalizeAssignee(doctype, value);
    const key = JSON.stringify(assignee);
    if (seen.has(key)) {
      throw invalid("Assignment rule assignees contain a duplicate assignee");
    }
    seen.add(key);
    assignees.push(assignee);
  }
  return assignees;
}

function normalizeAssignee(
  doctype: DocTypeDefinition,
  value: AssignmentRuleAssigneeDefinition
): AssignmentRuleAssigneeDefinition {
  if (!value || typeof value !== "object") {
    throw invalid("Assignment rule assignee must be an object");
  }
  if (value.kind === "user") {
    return Object.freeze({
      kind: "user",
      userId: normalizeRequiredString(value.userId, "Assignment rule assignee user")
    });
  }
  if (value.kind === "field") {
    const field = normalizeRequiredString(value.field, "Assignment rule assignee field");
    const definition = doctype.fields.find((candidate) => candidate.name === field);
    if (!definition || !isAssignmentRuleAssigneeField(definition)) {
      throw invalid(`Assignment rule assignee field '${field}' must be a text or link field on ${doctype.name}`);
    }
    return Object.freeze({ kind: "field", field });
  }
  throw invalid(`Assignment rule assignee kind '${String((value as { readonly kind?: unknown }).kind)}' is not supported`);
}

export function isAssignmentRuleAssigneeField(field: FieldDefinition): boolean {
  return field.type === "text" || field.type === "link";
}

function documentStringValue(snapshot: DocumentSnapshot, field: string): string | undefined {
  const value = snapshot.data[field];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function isAssignmentRuleEventKind(value: string): value is AssignmentRuleEventKind {
  return ASSIGNMENT_RULE_EVENT_KINDS.includes(value as AssignmentRuleEventKind);
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

function optionalBoolean(value: boolean | undefined, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalid(`${label} must be a boolean`);
  }
  return value;
}

function invalid(message: string): FrameworkError {
  return new FrameworkError("ASSIGNMENT_RULE_INVALID", message, { status: 400 });
}
