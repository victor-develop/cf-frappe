import { domainEventPayloadKind } from "./domain-events.js";
import { FrameworkError } from "./errors.js";
import { evaluatePredicateExpression, normalizePredicateExpression } from "./predicates.js";
import type {
  Actor,
  DocTypeDefinition,
  DocTypeName,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  FieldTransitionPolicyDefinition,
  NamedWorkflowDefinition,
  NamedWorkflowTransition,
  TenantId
} from "./types.js";

export type NamedWorkflowStatePayloadKind = "NamedWorkflowSaved" | "NamedWorkflowCleared";

export type NamedWorkflowStateEventPayload =
  | {
      readonly kind: "NamedWorkflowSaved";
      readonly doctypeName: DocTypeName;
      readonly workflowName: string;
      readonly workflow: NamedWorkflowDefinition;
    }
  | {
      readonly kind: "NamedWorkflowCleared";
      readonly doctypeName: DocTypeName;
      readonly workflowName: string;
    };

export const NAMED_WORKFLOW_STATE_PAYLOAD_KINDS = Object.freeze([
  "NamedWorkflowSaved",
  "NamedWorkflowCleared"
] as const satisfies readonly NamedWorkflowStatePayloadKind[]);

const NAMED_WORKFLOW_STATE_PAYLOAD_KIND_SET = new Set<string>(NAMED_WORKFLOW_STATE_PAYLOAD_KINDS);

export interface NamedWorkflowTransitionContext {
  readonly actor: Actor;
  readonly document: DocumentSnapshot;
  readonly workflow: NamedWorkflowDefinition;
  readonly input?: DocumentData;
}

export type NamedWorkflowTransitionDecision =
  | {
      readonly status: "allowed";
      readonly from: string;
      readonly transition: NamedWorkflowTransition;
    }
  | {
      readonly status: "action-not-found";
      readonly from: string;
    }
  | {
      readonly status: "state-denied";
      readonly from: string;
    }
  | {
      readonly status: "role-denied";
      readonly from: string;
      readonly transition: NamedWorkflowTransition;
    }
  | {
      readonly status: "condition-denied";
      readonly from: string;
      readonly transition: NamedWorkflowTransition;
    };

export interface NamedWorkflowDefinitionState {
  readonly tenantId: TenantId;
  readonly doctypeName: string;
  readonly workflowName: string;
  readonly version: number;
  readonly cleared: boolean;
  readonly workflow?: NamedWorkflowDefinition;
}

export const DEFAULT_MAX_WORKFLOWS = 16;
export const DEFAULT_MAX_TRANSITIONS_PER_WORKFLOW = 64;

export interface WorkflowNormalizationLimits {
  readonly maxWorkflows?: number;
  readonly maxTransitionsPerWorkflow?: number;
}

export function normalizeNamedWorkflows(
  doctype: DocTypeDefinition,
  workflows: readonly NamedWorkflowDefinition[] | undefined,
  limits: WorkflowNormalizationLimits = {}
): readonly NamedWorkflowDefinition[] | undefined {
  if (workflows === undefined) {
    return undefined;
  }
  if (!Array.isArray(workflows)) {
    throw workflowInvalid("DocType workflows must be an array");
  }
  const maxWorkflows = positiveLimit(limits.maxWorkflows, DEFAULT_MAX_WORKFLOWS, "Workflow count limit");
  if (workflows.length > maxWorkflows) {
    throw workflowInvalid(`DocType '${doctype.name}' cannot define more than ${maxWorkflows} workflows`);
  }
  const normalized = workflows.map((workflow) => normalizeNamedWorkflowDefinition(doctype, workflow, limits));
  const names = new Set<string>();
  const fields = new Set<string>();
  for (const workflow of normalized) {
    if (names.has(workflow.name)) {
      throw workflowInvalid(`Workflow name '${workflow.name}' is duplicated on ${doctype.name}`);
    }
    if (fields.has(workflow.stateField)) {
      throw workflowInvalid(`Workflow state field '${workflow.stateField}' is owned by more than one workflow`);
    }
    names.add(workflow.name);
    fields.add(workflow.stateField);
  }
  return Object.freeze(normalized);
}

export function normalizeNamedWorkflowDefinition(
  doctype: DocTypeDefinition,
  workflow: NamedWorkflowDefinition,
  limits: WorkflowNormalizationLimits = {}
): NamedWorkflowDefinition {
  if (!isRecord(workflow)) {
    throw workflowInvalid("Workflow definition must be an object");
  }
  const name = normalizeStableId(workflow.name, "Workflow name");
  const label = optionalRequiredString(workflow.label, "Workflow label");
  const stateField = normalizeRequiredString(workflow.stateField, "Workflow state field");
  const stateFieldDefinition = doctype.fields.find((field) => field.name === stateField);
  if (!stateFieldDefinition) {
    throw workflowInvalid(`Workflow '${name}' state field '${stateField}' is not defined on ${doctype.name}`);
  }
  const states = uniqueRequiredStrings(workflow.states, `Workflow '${name}' states`);
  assertWorkflowStateFieldCanStoreStates(stateFieldDefinition, states, name);
  const initialState = normalizeRequiredString(workflow.initialState, `Workflow '${name}' initial state`);
  if (!states.includes(initialState)) {
    throw workflowInvalid(`Workflow '${name}' initial state '${initialState}' is not listed in states`);
  }
  if (!Array.isArray(workflow.transitions)) {
    throw workflowInvalid(`Workflow '${name}' transitions must be an array`);
  }
  const maxTransitions = positiveLimit(
    limits.maxTransitionsPerWorkflow,
    DEFAULT_MAX_TRANSITIONS_PER_WORKFLOW,
    "Workflow transition count limit"
  );
  if (workflow.transitions.length > maxTransitions) {
    throw workflowInvalid(`Workflow '${name}' cannot define more than ${maxTransitions} transitions`);
  }
  const transitions = workflow.transitions.map((transition, index) =>
    normalizeNamedWorkflowTransition(doctype, name, transition, states, index)
  );
  if (transitions.length === 0) {
    throw workflowInvalid(`Workflow '${name}' must define at least one transition`);
  }
  assertUniqueTransitionActions(name, transitions);
  return Object.freeze({
    name,
    ...(label === undefined ? {} : { label }),
    stateField,
    initialState,
    states: Object.freeze(states),
    transitions: Object.freeze(transitions)
  });
}

export function namedWorkflowByName(
  doctype: DocTypeDefinition,
  workflowName: string
): NamedWorkflowDefinition | undefined {
  return doctype.workflows?.find((workflow) => workflow.name === workflowName);
}

export function currentWorkflowState(
  workflow: NamedWorkflowDefinition,
  document: DocumentSnapshot
): string {
  return String(document.data[workflow.stateField] ?? workflow.initialState);
}

export function allowedWorkflowTransitions(
  context: NamedWorkflowTransitionContext
): readonly NamedWorkflowTransition[] {
  const currentState = currentWorkflowState(context.workflow, context.document);
  return context.workflow.transitions
    .filter((transition) => transition.from === currentState)
    .filter((transition) => evaluateNamedWorkflowTransition(context, transition.action).status === "allowed");
}

export function evaluateNamedWorkflowTransition(
  context: NamedWorkflowTransitionContext,
  action: string
): NamedWorkflowTransitionDecision {
  const from = currentWorkflowState(context.workflow, context.document);
  const transitionsForAction = context.workflow.transitions.filter((transition) => transition.action === action);
  if (transitionsForAction.length === 0) {
    return { status: "action-not-found", from };
  }
  const transition = transitionsForAction.find((candidate) => candidate.from === from);
  if (transition === undefined) {
    return { status: "state-denied", from };
  }
  if (transition.roles !== undefined && !transition.roles.some((role) => context.actor.roles.includes(role))) {
    return { status: "role-denied", from, transition };
  }
  const after = Object.freeze({
    ...context.document,
    data: Object.freeze({ ...context.document.data, [context.workflow.stateField]: transition.to })
  });
  if (!evaluatePredicateExpression(transition.allowWhen, {
    before: context.document,
    after,
    input: context.input ?? { action },
    actor: context.actor
  })) {
    return { status: "condition-denied", from, transition };
  }
  return { status: "allowed", from, transition };
}

export function compileWorkflowTransitionPolicies(
  workflow: NamedWorkflowDefinition
): readonly FieldTransitionPolicyDefinition[] {
  return Object.freeze(workflow.transitions.map((transition) => Object.freeze({
    name: `${workflow.name}.${transition.action}`,
    field: workflow.stateField,
    action: transition.action,
    from: transition.from,
    to: transition.to,
    ...(transition.roles === undefined ? {} : { roles: transition.roles }),
    ...(transition.allowWhen === undefined ? {} : { allowWhen: transition.allowWhen }),
    ...(transition.eventType === undefined ? {} : { eventType: transition.eventType })
  })));
}

export function workflowStateFieldNames(doctype: DocTypeDefinition): readonly string[] {
  return Object.freeze((doctype.workflows ?? []).map((workflow) => workflow.stateField));
}

export function foldNamedWorkflowDefinition(
  tenantId: TenantId,
  doctypeName: string,
  workflowName: string,
  events: readonly DomainEvent[]
): NamedWorkflowDefinitionState {
  return foldNamedWorkflowDefinitionFrom(null, tenantId, doctypeName, workflowName, events);
}

export function foldNamedWorkflowDefinitionFrom(
  initial: NamedWorkflowDefinitionState | null,
  tenantId: TenantId,
  doctypeName: string,
  workflowName: string,
  events: readonly DomainEvent[]
): NamedWorkflowDefinitionState {
  let workflow: NamedWorkflowDefinition | undefined = initial?.workflow;
  let cleared = initial?.cleared ?? false;
  let version = initial?.version ?? 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    if (!isNamedWorkflowStateEvent(event) ||
      event.payload.doctypeName !== doctypeName ||
      event.payload.workflowName !== workflowName) {
      continue;
    }
    if (event.payload.kind === "NamedWorkflowSaved") {
      workflow = event.payload.workflow;
      cleared = false;
      continue;
    }
    workflow = undefined;
    cleared = true;
  }
  return Object.freeze({
    tenantId,
    doctypeName,
    workflowName,
    version,
    cleared,
    ...(workflow === undefined ? {} : { workflow })
  });
}

export function namedWorkflowStateEventType(
  payload: NamedWorkflowStateEventPayload
): NamedWorkflowStatePayloadKind {
  return payload.kind;
}

export function isNamedWorkflowStatePayloadKind(kind: string): kind is NamedWorkflowStatePayloadKind {
  return NAMED_WORKFLOW_STATE_PAYLOAD_KIND_SET.has(kind);
}

export function applyNamedWorkflowDefinitionToDocType(
  doctype: DocTypeDefinition,
  state: NamedWorkflowDefinitionState,
  limits: WorkflowNormalizationLimits = {}
): DocTypeDefinition {
  if (state.version === 0) {
    return doctype;
  }
  const retained = (doctype.workflows ?? []).filter((workflow) => workflow.name !== state.workflowName);
  const workflows = state.workflow === undefined ? retained : [...retained, state.workflow];
  const normalized = normalizeNamedWorkflows(doctype, workflows, limits);
  return Object.freeze({
    ...doctype,
    ...(normalized === undefined || normalized.length === 0 ? { workflows: undefined } : { workflows: normalized })
  }) as DocTypeDefinition;
}

export function isWorkflowStateField(field: FieldDefinition): boolean {
  return ["text", "longText", "date", "datetime", "link", "select"].includes(field.type);
}

function isNamedWorkflowStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: NamedWorkflowStateEventPayload } {
  return isNamedWorkflowStatePayloadKind(domainEventPayloadKind(event));
}

function normalizeNamedWorkflowTransition(
  doctype: DocTypeDefinition,
  workflowName: string,
  transition: NamedWorkflowTransition,
  states: readonly string[],
  index: number
): NamedWorkflowTransition {
  if (!isRecord(transition)) {
    throw workflowInvalid(`Workflow '${workflowName}' transition ${String(index + 1)} must be an object`);
  }
  const label = `Workflow '${workflowName}' transition ${String(index + 1)}`;
  const action = normalizeStableId(transition.action, `${label} action`);
  const from = normalizeRequiredString(transition.from, `${label} from`);
  const to = normalizeRequiredString(transition.to, `${label} to`);
  if (!states.includes(from)) {
    throw workflowInvalid(`${label} from state '${from}' is not listed in states`);
  }
  if (!states.includes(to)) {
    throw workflowInvalid(`${label} to state '${to}' is not listed in states`);
  }
  const roles = transition.roles === undefined ? undefined : uniqueRequiredStrings(transition.roles, `${label} roles`);
  const allowWhen = transition.allowWhen === undefined
    ? undefined
    : normalizePredicateExpression(doctype, transition.allowWhen, {
      availableScopes: ["before", "after", "input", "actor"],
      errorCode: "WORKFLOW_INVALID"
    });
  const eventType = optionalRequiredString(transition.eventType, `${label} event type`);
  return Object.freeze({
    action,
    from,
    to,
    ...(roles === undefined ? {} : { roles: Object.freeze(roles) }),
    ...(allowWhen === undefined ? {} : { allowWhen }),
    ...(eventType === undefined ? {} : { eventType })
  });
}

function assertWorkflowStateFieldCanStoreStates(
  field: FieldDefinition,
  states: readonly string[],
  workflowName: string
): void {
  if (!isWorkflowStateField(field)) {
    throw workflowInvalid(`Workflow '${workflowName}' state field '${field.name}' must be a string-compatible field`);
  }
  if (field.type !== "select" || field.options === undefined) {
    return;
  }
  const missing = states.filter((state) => !field.options?.includes(state));
  if (missing.length > 0) {
    throw workflowInvalid(
      `Workflow '${workflowName}' state field '${field.name}' options must include ${missing.map((state) => `'${state}'`).join(", ")}`
    );
  }
}

function assertUniqueTransitionActions(
  workflowName: string,
  transitions: readonly NamedWorkflowTransition[]
): void {
  const seen = new Set<string>();
  for (const transition of transitions) {
    const key = `${transition.from}\u0000${transition.action}`;
    if (seen.has(key)) {
      throw workflowInvalid(
        `Workflow '${workflowName}' transition action '${transition.action}' is duplicated for state '${transition.from}'`
      );
    }
    seen.add(key);
  }
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw workflowInvalid(`${label} must be a positive integer`);
  }
  return normalized;
}

function uniqueRequiredStrings(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw workflowInvalid(`${label} must contain at least one item`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = normalizeRequiredString(value, label);
    if (seen.has(item)) {
      throw workflowInvalid(`${label} contains duplicate '${item}'`);
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function optionalRequiredString(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : normalizeRequiredString(value, label);
}

function normalizeStableId(value: string, label: string): string {
  const normalized = normalizeRequiredString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw workflowInvalid(`${label} must be a stable identifier using letters, numbers, dot, underscore, colon, or hyphen`);
  }
  return normalized;
}

function normalizeRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw workflowInvalid(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw workflowInvalid(`${label} is required`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workflowInvalid(message: string): FrameworkError {
  return new FrameworkError("WORKFLOW_INVALID", message, { status: 400 });
}
