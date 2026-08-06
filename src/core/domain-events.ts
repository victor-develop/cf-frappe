import { FrameworkError } from "./errors.js";
import { cloneJsonValue, isJsonValue } from "./json.js";
import type { DomainEvent, NewDomainEvent } from "./types.js";

export type CurrentWorkflowTransitionPayload = Extract<
  DomainEvent["payload"],
  { readonly kind: "WorkflowTransitioned" }
>;

export interface DomainEventWorkflowTransition {
  readonly workflow: string;
  readonly stateField: string;
  readonly action: string;
  readonly from: string;
  readonly to: string;
}

export interface DomainEventWorkflowIdentity {
  readonly workflowName?: string;
  readonly workflowAction?: string;
  readonly workflowTransitions?: readonly DomainEventWorkflowTransition[];
}

export function sequenceEvents(
  expectedVersion: number,
  events: readonly NewDomainEvent[]
): readonly DomainEvent[] {
  return events.map((event, index) =>
    cloneDomainEvent({
      ...event,
      sequence: expectedVersion + index + 1
    })
  );
}

export function cloneDomainEvent<TEvent extends DomainEvent>(event: TEvent): TEvent {
  return {
    ...event,
    payload: cloneDomainEventObject(event.payload, "payload") as TEvent["payload"],
    metadata: cloneDomainEventObject(event.metadata, "metadata") as TEvent["metadata"]
  };
}

export function domainEventPayloadKind(event: DomainEvent): DomainEvent["payload"]["kind"] {
  return event.payload.kind;
}

export function domainEventWorkflowIdentity(event: DomainEvent): DomainEventWorkflowIdentity {
  if (event.payload.kind === "WorkflowTransitioned") {
    if (!isCurrentWorkflowTransitionPayload(event.payload)) {
      return Object.freeze({});
    }
    const transition = Object.freeze({
      workflow: event.payload.workflow,
      stateField: event.payload.stateField,
      action: event.payload.action,
      from: event.payload.from,
      to: event.payload.to
    });
    return Object.freeze({
      workflowName: event.payload.workflow,
      workflowAction: event.payload.action,
      workflowTransitions: Object.freeze([transition])
    });
  }
  if (event.payload.kind !== "DomainCommandApplied" || event.payload.transitions === undefined ||
    event.payload.transitions.length === 0) {
    return Object.freeze({});
  }
  const transitions = Object.freeze(event.payload.transitions.map((transition) => Object.freeze({ ...transition })));
  const only = transitions.length === 1 ? transitions[0] : undefined;
  return Object.freeze({
    ...(only === undefined ? {} : { workflowName: only.workflow, workflowAction: only.action }),
    workflowTransitions: transitions
  });
}

export function isCurrentWorkflowTransitionPayload(value: unknown): value is CurrentWorkflowTransitionPayload {
  return isRecord(value) &&
    value.kind === "WorkflowTransitioned" &&
    isRequiredString(value.workflow) &&
    isRequiredString(value.stateField) &&
    isRequiredString(value.action) &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    isJsonObject(value.patch);
}

export function hasDomainEventPayloadKind<TValue>(value: TValue): value is TValue & {
  readonly payload: { readonly kind: string };
} {
  return isRecord(value) && isRecord(value.payload) && typeof value.payload.kind === "string";
}

function cloneDomainEventObject(value: unknown, field: "payload" | "metadata"): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw new FrameworkError("EVENT_INVALID", `Domain event ${field} must be a JSON object`, { status: 409 });
  }
  return cloneJsonValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isJsonValue(value);
}
