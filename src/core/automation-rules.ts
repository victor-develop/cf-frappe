import { domainEventPayloadKind } from "./domain-events.js";
import { FrameworkError } from "./errors.js";
import { cloneJsonValue, isJsonValue } from "./json.js";
import { evaluatePredicateExpression, jsonValuesEqual, normalizePredicateExpression } from "./predicates.js";
import type {
  Actor,
  AutomationActionDefinition,
  AutomationChangeSelectorDefinition,
  AutomationRuleDefinition,
  AutomationRuleEventKind,
  AutomationTriggerDefinition,
  AutomationUpdateDocumentActionDefinition,
  AutomationValueExpression,
  DocTypeDefinition,
  DocumentChangeContext,
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

export const DEFAULT_MAX_AUTOMATION_RULES = 64;
export const DEFAULT_MAX_AUTOMATION_ACTIONS_PER_RULE = 16;

export interface AutomationNormalizationLimits {
  readonly maxRules?: number;
  readonly maxActionsPerRule?: number;
}

export interface AutomationRuleMatchContext {
  readonly event: DomainEvent;
  readonly change: DocumentChangeContext;
  readonly input: DocumentData;
  readonly actor: Actor;
}

export interface AutomationRuleEvaluationContext extends AutomationRuleMatchContext {
  readonly rules: readonly AutomationRuleDefinition[];
}

export interface ResolvedAutomationAction {
  readonly runId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly actionId: string;
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
  rules: readonly AutomationRuleDefinition[] | undefined,
  limits: AutomationNormalizationLimits = {}
): readonly AutomationRuleDefinition[] | undefined {
  if (rules === undefined) {
    return undefined;
  }
  if (!Array.isArray(rules)) {
    throw invalid("Automation rules must be an array");
  }
  const maxRules = positiveLimit(limits.maxRules, DEFAULT_MAX_AUTOMATION_RULES, "Automation rule count limit");
  if (rules.length > maxRules) {
    throw invalid(`DocType '${doctype.name}' cannot define more than ${maxRules} Automation rules`);
  }
  const normalized: AutomationRuleDefinition[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const rule of rules) {
    const normalizedRule = normalizeAutomationRule(doctype, rule, limits);
    if (ids.has(normalizedRule.id)) {
      throw invalid(`Automation rule id '${normalizedRule.id}' is duplicated`);
    }
    if (names.has(normalizedRule.name)) {
      throw invalid(`Automation rule name '${normalizedRule.name}' is duplicated`);
    }
    ids.add(normalizedRule.id);
    names.add(normalizedRule.name);
    normalized.push(normalizedRule);
  }
  return Object.freeze(normalized);
}

export function normalizeAutomationRule(
  doctype: DocTypeDefinition,
  rule: AutomationRuleDefinition,
  limits: AutomationNormalizationLimits = {}
): AutomationRuleDefinition {
  if (!isRecord(rule)) {
    throw invalid("Automation rule must be an object");
  }
  const id = normalizeStableId(rule.id, "Automation rule id");
  const name = normalizeRequiredText(rule.name, "Automation rule name");
  const enabled = optionalBoolean(rule.enabled, "Automation rule enabled");
  const trigger = normalizeTrigger(doctype, rule.trigger);
  const runWhen = rule.runWhen === undefined
    ? undefined
    : normalizePredicateExpression(doctype, rule.runWhen, {
      availableScopes: ["before", "after", "input", "event", "actor"],
      errorCode: "AUTOMATION_RULE_INVALID"
    });
  const actions = normalizeActions(doctype, rule.actions, limits);
  return Object.freeze({
    id,
    name,
    ...(enabled === undefined ? {} : { enabled }),
    trigger,
    ...(runWhen === undefined ? {} : { runWhen }),
    actions: Object.freeze(actions)
  });
}

export function automationActionsFromDomainEvent(
  context: AutomationRuleEvaluationContext
): readonly ResolvedAutomationAction[] {
  const snapshot = context.change.after;
  const payloadKind = domainEventPayloadKind(context.event);
  if (snapshot === null || snapshot.docstatus === "deleted" || !isAutomationRuleEventKind(payloadKind)) {
    return [];
  }
  const actions: ResolvedAutomationAction[] = [];
  for (const rule of context.rules) {
    if (!automationRuleMatches(rule, context)) {
      continue;
    }
    for (const action of rule.actions) {
      const resolved = resolveAutomationAction(action, context.event, snapshot);
      if (resolved === undefined) {
        continue;
      }
      actions.push(Object.freeze({
        runId: automationActionId(context.event.id, rule.id, action.id),
        ruleId: rule.id,
        ruleName: rule.name,
        actionId: action.id,
        action: resolved
      }));
    }
  }
  return Object.freeze(actions);
}

export function automationActionId(sourceEventId: string, ruleId: string, actionId: string): string {
  return `${automationIdentityPart(sourceEventId)}:${automationActionIdentity(ruleId, actionId)}`;
}

export function automationActionIdentity(ruleId: string, actionId: string): string {
  return `${automationIdentityPart(ruleId)}:${automationIdentityPart(actionId)}`;
}

export function automationRuleMatches(
  rule: AutomationRuleDefinition,
  context: AutomationRuleMatchContext
): boolean {
  const payloadKind = domainEventPayloadKind(context.event);
  if (rule.enabled === false || !rule.trigger.events.includes(payloadKind as AutomationRuleEventKind)) {
    return false;
  }
  if (!triggerIdentityMatches(rule.trigger, context.event)) {
    return false;
  }
  if (rule.trigger.touchedFields !== undefined &&
    !rule.trigger.touchedFields.some((field) => context.change.touchedFields.includes(field))) {
    return false;
  }
  if (rule.trigger.changes !== undefined &&
    !rule.trigger.changes.some((selector) => automationChangeSelectorMatches(selector, context.change))) {
    return false;
  }
  return evaluatePredicateExpression(rule.runWhen, {
    before: context.change.before,
    after: context.change.after,
    input: context.input,
    event: context.event,
    actor: context.actor
  });
}

function automationChangeSelectorMatches(
  selector: AutomationChangeSelectorDefinition,
  change: DocumentChangeContext
): boolean {
  const fieldChange = change.changes[selector.field];
  return fieldChange !== undefined &&
    (selector.from === undefined || jsonValuesEqual(fieldChange.before, selector.from)) &&
    (selector.to === undefined || jsonValuesEqual(fieldChange.after, selector.to));
}

function triggerIdentityMatches(trigger: AutomationTriggerDefinition, event: DomainEvent): boolean {
  const payload = event.payload as unknown as Record<string, unknown>;
  if ((trigger.workflow !== undefined || trigger.workflowAction !== undefined) &&
    !workflowIdentityMatches(trigger, payload)) {
    return false;
  }
  if (trigger.domainCommand !== undefined &&
    (payload.kind !== "DomainCommandApplied" || payload.command !== trigger.domainCommand)) {
    return false;
  }
  return true;
}

function workflowIdentityMatches(
  trigger: AutomationTriggerDefinition,
  payload: Record<string, unknown>
): boolean {
  if (payload.kind === "WorkflowTransitioned") {
    return (trigger.workflow === undefined || payload.workflow === trigger.workflow) &&
      (trigger.workflowAction === undefined || payload.action === trigger.workflowAction);
  }
  if (payload.kind !== "DomainCommandApplied" || !Array.isArray(payload.transitions)) {
    return false;
  }
  return payload.transitions.some((transition) =>
    isRecord(transition) &&
    (trigger.workflow === undefined || transition.workflow === trigger.workflow) &&
    (trigger.workflowAction === undefined || transition.action === trigger.workflowAction)
  );
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
  return Object.freeze({
    kind: "updateDocument",
    target: Object.freeze({
      doctype: action.target.doctype,
      name: name.trim()
    }),
    patch: Object.freeze(patch)
  });
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

function normalizeTrigger(
  doctype: DocTypeDefinition,
  trigger: AutomationTriggerDefinition
): AutomationTriggerDefinition {
  if (!isRecord(trigger)) {
    throw invalid("Automation rule trigger must be an object");
  }
  const events = normalizeEventKinds(trigger.events);
  const touchedFields = normalizeFieldNames(doctype, trigger.touchedFields, "touchedFields");
  const changes = normalizeChangeSelectors(doctype, trigger.changes);
  const workflow = optionalStableId(trigger.workflow, "Automation trigger workflow");
  const workflowAction = optionalStableId(trigger.workflowAction, "Automation trigger workflow action");
  const domainCommand = optionalStableId(trigger.domainCommand, "Automation trigger domain command");
  if (workflowAction !== undefined && workflow === undefined) {
    throw invalid("Automation trigger workflowAction requires workflow");
  }
  if ((workflow !== undefined || workflowAction !== undefined) &&
    !events.includes("WorkflowTransitioned") &&
    !events.includes("DomainCommandApplied")) {
    throw invalid("Automation trigger workflow selectors require WorkflowTransitioned or DomainCommandApplied");
  }
  if (domainCommand !== undefined && !events.includes("DomainCommandApplied")) {
    throw invalid("Automation trigger domainCommand requires DomainCommandApplied");
  }
  return Object.freeze({
    events: Object.freeze(events),
    ...(touchedFields === undefined ? {} : { touchedFields: Object.freeze(touchedFields) }),
    ...(changes === undefined ? {} : { changes: Object.freeze(changes) }),
    ...(workflow === undefined ? {} : { workflow }),
    ...(workflowAction === undefined ? {} : { workflowAction }),
    ...(domainCommand === undefined ? {} : { domainCommand })
  });
}

function normalizeEventKinds(values: readonly AutomationRuleEventKind[]): readonly AutomationRuleEventKind[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Automation trigger events must contain at least one event kind");
  }
  const normalized: AutomationRuleEventKind[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !isAutomationRuleEventKind(value)) {
      throw invalid(`Automation rule event kind '${String(value)}' is not supported`);
    }
    if (seen.has(value)) {
      throw invalid(`Automation trigger events contain duplicate '${value}'`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeFieldNames(
  doctype: DocTypeDefinition,
  values: readonly string[] | undefined,
  property: string
): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid(`Automation trigger ${property} must contain at least one field`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const field = normalizeRequiredText(value, `Automation trigger ${property} field`);
    requireAutomationField(doctype, field);
    if (seen.has(field)) {
      throw invalid(`Automation trigger ${property} contain duplicate '${field}'`);
    }
    seen.add(field);
    normalized.push(field);
  }
  return normalized;
}

function normalizeChangeSelectors(
  doctype: DocTypeDefinition,
  selectors: readonly AutomationChangeSelectorDefinition[] | undefined
): readonly AutomationChangeSelectorDefinition[] | undefined {
  if (selectors === undefined) {
    return undefined;
  }
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw invalid("Automation trigger changes must contain at least one selector");
  }
  const normalized: AutomationChangeSelectorDefinition[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    if (!isRecord(selector)) {
      throw invalid("Automation change selector must be an object");
    }
    const field = normalizeRequiredText(selector.field as string, "Automation change selector field");
    requireAutomationField(doctype, field);
    if (seen.has(field)) {
      throw invalid(`Automation trigger changes contain duplicate '${field}'`);
    }
    seen.add(field);
    normalized.push(Object.freeze({
      field,
      ...(selector.from === undefined ? {} : { from: normalizeJsonValue(selector.from, "Automation change from") }),
      ...(selector.to === undefined ? {} : { to: normalizeJsonValue(selector.to, "Automation change to") })
    }));
  }
  return normalized;
}

function normalizeActions(
  doctype: DocTypeDefinition,
  values: readonly AutomationActionDefinition[],
  limits: AutomationNormalizationLimits
): readonly AutomationActionDefinition[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalid("Automation rule actions must contain at least one action");
  }
  const maxActions = positiveLimit(
    limits.maxActionsPerRule,
    DEFAULT_MAX_AUTOMATION_ACTIONS_PER_RULE,
    "Automation action count limit"
  );
  if (values.length > maxActions) {
    throw invalid(`Automation rule cannot define more than ${maxActions} actions`);
  }
  const actionIds = new Set<string>();
  return values.map((action) => {
    const normalized = Object.freeze(normalizeAction(doctype, action));
    if (actionIds.has(normalized.id)) {
      throw invalid(`Automation action id '${normalized.id}' is duplicated`);
    }
    actionIds.add(normalized.id);
    return normalized;
  });
}

function normalizeAction(
  doctype: DocTypeDefinition,
  action: AutomationActionDefinition
): AutomationActionDefinition {
  if (!isRecord(action) || action.kind !== "updateDocument") {
    throw invalid(`Automation action kind '${String((action as { readonly kind?: unknown } | undefined)?.kind)}' is not supported`);
  }
  const id = normalizeStableId(action.id, "Automation action id");
  const targetDoctype = normalizeRequiredText(action.target?.doctype, "Automation action target DocType");
  const targetName = normalizeValueExpression(doctype, action.target?.name, "Automation action target name");
  const patch = normalizePatch(doctype, action.patch);
  return {
    id,
    kind: "updateDocument",
    target: Object.freeze({
      doctype: targetDoctype,
      name: targetName
    }),
    patch: Object.freeze(patch)
  };
}

function normalizePatch(
  doctype: DocTypeDefinition,
  patch: Readonly<Record<string, AutomationValueExpression>>
): Readonly<Record<string, AutomationValueExpression>> {
  if (!isRecord(patch)) {
    throw invalid("Automation updateDocument patch must be an object");
  }
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    throw invalid("Automation updateDocument patch must contain at least one field");
  }
  const normalized: Record<string, AutomationValueExpression> = {};
  for (const [field, expression] of entries) {
    const normalizedField = normalizeRequiredText(field, "Automation updateDocument patch field");
    normalized[normalizedField] = normalizeValueExpression(
      doctype,
      expression,
      `Automation updateDocument patch '${normalizedField}'`
    );
  }
  return normalized;
}

function normalizeValueExpression(
  doctype: DocTypeDefinition,
  value: AutomationValueExpression,
  label: string
): AutomationValueExpression {
  if (value?.kind === "literal") {
    return Object.freeze({ kind: "literal", value: normalizeJsonValue(value.value, `${label} literal`) });
  }
  if (value?.kind === "field") {
    const field = normalizeRequiredText(value.field, `${label} field`);
    requireAutomationField(doctype, field);
    return Object.freeze({ kind: "field", field });
  }
  if (value?.kind === "documentName") {
    return Object.freeze({ kind: "documentName" });
  }
  if (value?.kind === "actor") {
    return Object.freeze({ kind: "actor" });
  }
  throw invalid(`${label} expression is invalid`);
}

function requireAutomationField(doctype: DocTypeDefinition, field: string): void {
  if (!doctype.fields.some((candidate) => candidate.name === field)) {
    throw invalid(`Automation field '${field}' is not defined on ${doctype.name}`);
  }
}

function normalizeJsonValue(value: unknown, label: string): JsonValue {
  if (!isJsonValue(value, { maxDepth: 16 })) {
    throw invalid(`${label} must be valid JSON`);
  }
  return cloneJsonValue(value);
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

function optionalStableId(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : normalizeStableId(value, label);
}

function normalizeStableId(value: string, label: string): string {
  const normalized = normalizeRequiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw invalid(`${label} must be a stable identifier using letters, numbers, dot, underscore, colon, or hyphen`);
  }
  return normalized;
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

function automationIdentityPart(value: string): string {
  return value.replaceAll("%", "%25").replaceAll(":", "%3A");
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw invalid(`${label} must be a positive integer`);
  }
  return normalized;
}

function isAutomationRuleEventKind(value: string): value is AutomationRuleEventKind {
  return (AUTOMATION_RULE_EVENT_KINDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): FrameworkError {
  return new FrameworkError("AUTOMATION_RULE_INVALID", message, { status: 400 });
}
