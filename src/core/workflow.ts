import { FrameworkError } from "./errors.js";
import { domainEventPayloadKind } from "./domain-events.js";
import type {
  Actor,
  DocTypeName,
  DocTypeDefinition,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  TenantId,
  WorkflowDefinition,
  WorkflowTransition
} from "./types.js";

export type WorkflowDefinitionStatePayloadKind =
  | "WorkflowDefinitionSaved"
  | "WorkflowDefinitionCleared";

export type WorkflowDefinitionStateEventPayload =
  | {
      readonly kind: "WorkflowDefinitionSaved";
      readonly doctypeName: DocTypeName;
      readonly workflow: WorkflowDefinition;
    }
  | {
      readonly kind: "WorkflowDefinitionCleared";
      readonly doctypeName: DocTypeName;
    };

export const WORKFLOW_DEFINITION_STATE_PAYLOAD_KINDS = Object.freeze([
  "WorkflowDefinitionSaved",
  "WorkflowDefinitionCleared"
] as const satisfies readonly WorkflowDefinitionStatePayloadKind[]);

const WORKFLOW_DEFINITION_STATE_PAYLOAD_KIND_SET = new Set<string>(WORKFLOW_DEFINITION_STATE_PAYLOAD_KINDS);

export interface WorkflowTransitionContext {
  readonly actor: Actor;
  readonly document: DocumentSnapshot;
  readonly workflow: WorkflowDefinition;
}

export function currentWorkflowState(
  workflow: WorkflowDefinition,
  document: DocumentSnapshot
): string {
  const stateField = workflow.stateField ?? "workflow_state";
  return String(document.data[stateField] ?? workflow.initialState);
}

export function allowedWorkflowTransitions(
  context: WorkflowTransitionContext
): readonly WorkflowTransition[] {
  const currentState = currentWorkflowState(context.workflow, context.document);
  return context.workflow.transitions.filter(
    (transition) =>
      transition.from === currentState &&
      (transition.roles === undefined || transition.roles.some((role) => context.actor.roles.includes(role)))
  );
}

export interface WorkflowDefinitionState {
  readonly tenantId: TenantId;
  readonly doctypeName: string;
  readonly version: number;
  readonly workflow?: WorkflowDefinition;
}

export function foldWorkflowDefinition(
  tenantId: TenantId,
  doctypeName: string,
  events: readonly DomainEvent[]
): WorkflowDefinitionState {
  let workflow: WorkflowDefinition | undefined;
  let version = 0;
  for (const event of events) {
    version = Math.max(version, event.sequence);
    if (!isWorkflowDefinitionStateEvent(event) || event.payload.doctypeName !== doctypeName) {
      continue;
    }
    if (event.payload.kind === "WorkflowDefinitionSaved") {
      workflow = event.payload.workflow;
      continue;
    }
    if (event.payload.kind === "WorkflowDefinitionCleared") {
      workflow = undefined;
    }
  }
  return Object.freeze({
    tenantId,
    doctypeName,
    version,
    ...(workflow === undefined ? {} : { workflow })
  });
}

export function workflowDefinitionStateEventType(
  payload: WorkflowDefinitionStateEventPayload
): WorkflowDefinitionStatePayloadKind {
  return payload.kind;
}

export function isWorkflowDefinitionStatePayloadKind(kind: string): kind is WorkflowDefinitionStatePayloadKind {
  return WORKFLOW_DEFINITION_STATE_PAYLOAD_KIND_SET.has(kind);
}

function isWorkflowDefinitionStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: WorkflowDefinitionStateEventPayload } {
  return isWorkflowDefinitionStatePayloadKind(domainEventPayloadKind(event));
}

export function applyWorkflowDefinitionToDocType(
  doctype: DocTypeDefinition,
  state: WorkflowDefinitionState
): DocTypeDefinition {
  if (state.workflow === undefined) {
    return doctype;
  }
  return Object.freeze({
    ...doctype,
    workflow: state.workflow
  });
}

export function normalizeWorkflowDefinition(
  doctype: DocTypeDefinition,
  workflow: WorkflowDefinition
): WorkflowDefinition {
  const stateField = workflow.stateField?.trim() || "workflow_state";
  const stateFieldDefinition = doctype.fields.find((field) => field.name === stateField);
  if (!stateFieldDefinition) {
    throw new FrameworkError(
      "WORKFLOW_INVALID",
      `Workflow state field '${stateField}' is not defined on ${doctype.name}`,
      { status: 400 }
    );
  }
  const states = uniqueRequiredStrings(workflow.states, "Workflow states");
  assertWorkflowStateFieldCanStoreStates(stateFieldDefinition, states);
  const initialState = normalizeRequiredString(workflow.initialState, "Workflow initial state");
  if (!states.includes(initialState)) {
    throw new FrameworkError("WORKFLOW_INVALID", `Workflow initial state '${initialState}' is not listed in states`, {
      status: 400
    });
  }
  const transitions = workflow.transitions.map((transition, index) =>
    normalizeWorkflowTransition(transition, states, index)
  );
  if (transitions.length === 0) {
    throw new FrameworkError("WORKFLOW_INVALID", "Workflow must define at least one transition", { status: 400 });
  }
  assertUniqueTransitionActions(transitions);
  return Object.freeze({
    ...(stateField === "workflow_state" ? {} : { stateField }),
    initialState,
    states: Object.freeze(states),
    transitions: Object.freeze(transitions)
  });
}

export function isWorkflowStateField(field: FieldDefinition): boolean {
  return ["text", "longText", "date", "datetime", "link", "select"].includes(field.type);
}

function assertWorkflowStateFieldCanStoreStates(field: FieldDefinition, states: readonly string[]): void {
  if (!isWorkflowStateField(field)) {
    throw new FrameworkError(
      "WORKFLOW_INVALID",
      `Workflow state field '${field.name}' must be a string-compatible field`,
      { status: 400 }
    );
  }
  if (field.type !== "select" || field.options === undefined) {
    return;
  }
  const missing = states.filter((state) => !field.options?.includes(state));
  if (missing.length > 0) {
    throw new FrameworkError(
      "WORKFLOW_INVALID",
      `Workflow state field '${field.name}' options must include ${missing.map((state) => `'${state}'`).join(", ")}`,
      { status: 400 }
    );
  }
}

function assertUniqueTransitionActions(transitions: readonly WorkflowTransition[]): void {
  const seen = new Set<string>();
  for (const transition of transitions) {
    const key = `${transition.from}\u0000${transition.action}`;
    if (seen.has(key)) {
      throw new FrameworkError(
        "WORKFLOW_INVALID",
        `Workflow transition action '${transition.action}' is duplicated for state '${transition.from}'`,
        { status: 400 }
      );
    }
    seen.add(key);
  }
}

function normalizeWorkflowTransition(
  transition: WorkflowTransition,
  states: readonly string[],
  index: number
): WorkflowTransition {
  const label = `Workflow transition ${index + 1}`;
  const action = normalizeRequiredString(transition.action, `${label} action`);
  const from = normalizeRequiredString(transition.from, `${label} from`);
  const to = normalizeRequiredString(transition.to, `${label} to`);
  if (!states.includes(from)) {
    throw new FrameworkError("WORKFLOW_INVALID", `${label} from state '${from}' is not listed in states`, { status: 400 });
  }
  if (!states.includes(to)) {
    throw new FrameworkError("WORKFLOW_INVALID", `${label} to state '${to}' is not listed in states`, { status: 400 });
  }
  const roles = transition.roles === undefined ? undefined : uniqueRequiredStrings(transition.roles, `${label} roles`);
  const eventType = transition.eventType?.trim();
  return Object.freeze({
    action,
    from,
    to,
    ...(roles === undefined ? {} : { roles: Object.freeze(roles) }),
    ...(eventType === undefined || eventType === "" ? {} : { eventType })
  });
}

function uniqueRequiredStrings(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new FrameworkError("WORKFLOW_INVALID", `${label} must contain at least one item`, { status: 400 });
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = normalizeRequiredString(value, label);
    if (seen.has(item)) {
      throw new FrameworkError("WORKFLOW_INVALID", `${label} contains duplicate '${item}'`, { status: 400 });
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function normalizeRequiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new FrameworkError("WORKFLOW_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}
