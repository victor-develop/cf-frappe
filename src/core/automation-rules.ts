import { domainEventPayloadKind } from "./domain-events.js";
import { FrameworkError } from "./errors.js";
import { matchesListFilterExpression, normalizeListFilterExpression } from "./list-view.js";
import type {
  AutomationActionDefinition,
  AutomationRuleDefinition,
  AutomationRuleEventKind,
  AutomationUpdateDocumentActionDefinition,
  AutomationValueExpression,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  JsonValue
} from "./types.js";

export const AUTOMATION_RULE_EVENT_KINDS = Object.freeze([
  "DocumentCreated",
  "DocumentUpdated",
  "DocumentSubmitted",
  "DocumentCancelled",
  "WorkflowTransitioned",
  "DomainCommandApplied"
] as const satisfies readonly AutomationRuleEventKind[]);

export interface AutomationRuleEvaluationContext {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
  readonly rules: readonly AutomationRuleDefinition[];
}

export interface ResolvedAutomationAction {
  readonly actionId: string;
  readonly ruleName: string;
  readonly actionIndex: number;
  readonly action: ResolvedAutomationActionDefinition;
}

export type ResolvedAutomationActionDefinition =
  | {
      readonly kind: "updateDocument";
      readonly target: {
        readonly doctype: string;
        readonly name: string;
      };
      readonly patch: DocumentData;
    };

export function normalizeAutomationRules(
  doctype: DocTypeDefinition,
  rules: readonly AutomationRuleDefinition[] | undefined
): readonly AutomationRuleDefinition[] | undefined {
  if (rules === undefined) {
    return undefined;
  }
  if (!Array.isArray(rules)) {
    throw invalid("Automation rules must be an array");
  }
  const normalized: AutomationRuleDefinition[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const normalizedRule = normalizeAutomationRule(doctype, rule);
    if (seen.has(normalizedRule.name)) {
      throw invalid(`Automation rule '${normalizedRule.name}' is duplicated`);
    }
    seen.add(normalizedRule.name);
    normalized.push(normalizedRule);
  }
  return Object.freeze(normalized);
}

export function normalizeAutomationRule(
  doctype: DocTypeDefinition,
  rule: AutomationRuleDefinition
): AutomationRuleDefinition {
  const name = normalizeRequiredText(rule.name, "Automation rule name");
  const enabled = optionalBoolean(rule.enabled, "Automation rule enabled");
  const events = normalizeEventKinds(rule.events);
  const changedFields = normalizeChangedFields(rule.changedFields);
  const condition = rule.condition === undefined
    ? undefined
    : normalizeListFilterExpression(doctype, rule.condition, { errorCode: "AUTOMATION_RULE_INVALID" });
  const actions = normalizeActions(rule.actions);
  return Object.freeze({
    name,
    ...(enabled === undefined ? {} : { enabled }),
    events: Object.freeze(events),
    ...(changedFields === undefined ? {} : { changedFields: Object.freeze(changedFields) }),
    ...(condition === undefined ? {} : { condition }),
    actions: Object.freeze(actions)
  });
}

export function automationActionsFromDomainEvent(
  context: AutomationRuleEvaluationContext
): readonly ResolvedAutomationAction[] {
  const snapshot = context.snapshot;
  const payloadKind = domainEventPayloadKind(context.event);
  if (snapshot === null || snapshot.docstatus === "deleted" || !isAutomationRuleEventKind(payloadKind)) {
    return [];
  }
  const actions: ResolvedAutomationAction[] = [];
  for (const rule of context.rules) {
    if (!automationRuleMatches(rule, context.event, snapshot)) {
      continue;
    }
    rule.actions.forEach((action, actionIndex) => {
      const resolved = resolveAutomationAction(action, context.event, snapshot);
      if (resolved === undefined) {
        return;
      }
      actions.push({
        actionId: automationActionId(context.event.id, rule.name, actionIndex),
        ruleName: rule.name,
        actionIndex,
        action: resolved
      });
    });
  }
  return Object.freeze(actions);
}

export function automationActionId(sourceEventId: string, ruleName: string, actionIndex: number): string {
  return `${sourceEventId}:${ruleName}:${String(actionIndex)}`;
}

export function automationRuleMatches(
  rule: AutomationRuleDefinition,
  event: DomainEvent,
  snapshot: DocumentSnapshot
): boolean {
  const payloadKind = domainEventPayloadKind(event);
  if (rule.enabled === false || !rule.events.includes(payloadKind as AutomationRuleEventKind)) {
    return false;
  }
  if (rule.changedFields !== undefined && !automationChangedFields(event).some((field) => rule.changedFields?.includes(field))) {
    return false;
  }
  if (rule.condition === undefined) {
    return true;
  }
  return matchesListFilterExpression(snapshot, rule.condition);
}

export function automationChangedFields(event: DomainEvent): readonly string[] {
  const payload = event.payload;
  switch (payload.kind) {
    case "DocumentCreated":
      return Object.keys(payload.data);
    case "DocumentUpdated":
      return [...new Set([...Object.keys(payload.patch), ...(payload.unset ?? [])])].sort();
    case "WorkflowTransitioned":
    case "DomainCommandApplied":
      return Object.keys(payload.patch).sort();
    default:
      return [];
  }
}

function resolveAutomationAction(
  action: AutomationActionDefinition,
  event: DomainEvent,
  snapshot: DocumentSnapshot
): ResolvedAutomationActionDefinition | undefined {
  return resolveUpdateDocumentAction(action, event, snapshot);
}

function resolveUpdateDocumentAction(
  action: AutomationUpdateDocumentActionDefinition,
  event: DomainEvent,
  snapshot: DocumentSnapshot
): ResolvedAutomationActionDefinition | undefined {
  const name = resolveAutomationValue(action.target.name, event, snapshot);
  if (typeof name !== "string" || name.trim().length === 0) {
    return undefined;
  }
  const patch: Record<string, JsonValue> = {};
  for (const [field, expression] of Object.entries(action.patch)) {
    const value = resolveAutomationValue(expression, event, snapshot);
    if (value !== undefined) {
      patch[field] = value;
    }
  }
  if (Object.keys(patch).length === 0) {
    return undefined;
  }
  return {
    kind: "updateDocument",
    target: {
      doctype: action.target.doctype,
      name: name.trim()
    },
    patch
  };
}

function resolveAutomationValue(
  expression: AutomationValueExpression,
  event: DomainEvent,
  snapshot: DocumentSnapshot
): JsonValue | undefined {
  if (expression.kind === "literal") {
    return expression.value;
  }
  if (expression.kind === "documentName") {
    return snapshot.name;
  }
  if (expression.kind === "actor") {
    return event.actorId;
  }
  return snapshot.data[expression.field];
}

function normalizeEventKinds(values: readonly AutomationRuleEventKind[]): readonly AutomationRuleEventKind[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Automation rule events must contain at least one event kind");
  }
  const normalized: AutomationRuleEventKind[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !isAutomationRuleEventKind(value)) {
      throw invalid(`Automation rule event kind '${String(value)}' is not supported`);
    }
    if (seen.has(value)) {
      throw invalid(`Automation rule events contain duplicate '${value}'`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeChangedFields(values: readonly string[] | undefined): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Automation rule changedFields must contain at least one field");
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const field = normalizeRequiredText(value, "Automation rule changed field");
    if (seen.has(field)) {
      throw invalid(`Automation rule changedFields contain duplicate '${field}'`);
    }
    seen.add(field);
    normalized.push(field);
  }
  return normalized;
}

function normalizeActions(values: readonly AutomationActionDefinition[]): readonly AutomationActionDefinition[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Automation rule actions must contain at least one action");
  }
  return values.map((action) => Object.freeze(normalizeAction(action)));
}

function normalizeAction(action: AutomationActionDefinition): AutomationActionDefinition {
  if (action.kind !== "updateDocument") {
    throw invalid(`Automation action kind '${String((action as { readonly kind?: unknown }).kind)}' is not supported`);
  }
  const targetDoctype = normalizeRequiredText(action.target.doctype, "Automation action target DocType");
  const targetName = normalizeValueExpression(action.target.name, "Automation action target name");
  const patch = normalizePatch(action.patch);
  return {
    kind: "updateDocument",
    target: {
      doctype: targetDoctype,
      name: targetName
    },
    patch: Object.freeze(patch)
  };
}

function normalizePatch(patch: Readonly<Record<string, AutomationValueExpression>>): Readonly<Record<string, AutomationValueExpression>> {
  if (patch === undefined || patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw invalid("Automation updateDocument patch must be an object");
  }
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    throw invalid("Automation updateDocument patch must contain at least one field");
  }
  const normalized: Record<string, AutomationValueExpression> = {};
  for (const [field, expression] of entries) {
    const normalizedField = normalizeRequiredText(field, "Automation updateDocument patch field");
    normalized[normalizedField] = normalizeValueExpression(expression, `Automation updateDocument patch '${normalizedField}'`);
  }
  return normalized;
}

function normalizeValueExpression(value: AutomationValueExpression, label: string): AutomationValueExpression {
  if (value?.kind === "literal") {
    return Object.freeze({ kind: "literal", value: value.value });
  }
  if (value?.kind === "field") {
    return Object.freeze({ kind: "field", field: normalizeRequiredText(value.field, `${label} field`) });
  }
  if (value?.kind === "documentName") {
    return Object.freeze({ kind: "documentName" });
  }
  if (value?.kind === "actor") {
    return Object.freeze({ kind: "actor" });
  }
  throw invalid(`${label} expression is invalid`);
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

function normalizeRequiredText(value: string, label: string): string {
  if (typeof value !== "string") {
    throw invalid(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw invalid(`${label} is required`);
  }
  return normalized;
}

function isAutomationRuleEventKind(value: string): value is AutomationRuleEventKind {
  return (AUTOMATION_RULE_EVENT_KINDS as readonly string[]).includes(value);
}

function invalid(message: string): FrameworkError {
  return new FrameworkError("AUTOMATION_RULE_INVALID", message, { status: 400 });
}
