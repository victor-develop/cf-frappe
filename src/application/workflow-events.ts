import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  NAMED_WORKFLOW_STATE_PAYLOAD_KINDS,
  foldNamedWorkflowDefinition,
  isNamedWorkflowStatePayloadKind,
  namedWorkflowStateEventType,
  type NamedWorkflowDefinitionState,
  type NamedWorkflowStateEventPayload,
  type NamedWorkflowStatePayloadKind
} from "../core/workflow.js";
import type {
  Actor,
  DocTypeName,
  DocumentData,
  DomainEvent,
  NamedWorkflowDefinition,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../core/types.js";

export type NamedWorkflowEventPayload = NamedWorkflowStateEventPayload;
export type NamedWorkflowPayloadKind = NamedWorkflowStatePayloadKind;
export const NAMED_WORKFLOW_PAYLOAD_KINDS = NAMED_WORKFLOW_STATE_PAYLOAD_KINDS;

export type NamedWorkflowFieldOwnershipEventPayload =
  | {
      readonly kind: "NamedWorkflowFieldClaimed";
      readonly doctypeName: DocTypeName;
      readonly stateField: string;
      readonly workflowName: string;
    }
  | {
      readonly kind: "NamedWorkflowFieldReleased";
      readonly doctypeName: DocTypeName;
      readonly stateField: string;
      readonly workflowName: string;
    };

export interface NamedWorkflowFieldOwnershipState {
  readonly tenantId: TenantId;
  readonly doctypeName: DocTypeName;
  readonly stateField: string;
  readonly version: number;
  readonly workflowName?: string;
}

export const NAMED_WORKFLOW_FIELD_OWNERSHIP_PAYLOAD_KINDS = [
  "NamedWorkflowFieldClaimed",
  "NamedWorkflowFieldReleased"
] as const;

export function namedWorkflowSavedPayload(input: {
  readonly doctypeName: DocTypeName;
  readonly workflow: NamedWorkflowDefinition;
}): Extract<NamedWorkflowEventPayload, { readonly kind: "NamedWorkflowSaved" }> {
  return {
    kind: "NamedWorkflowSaved",
    doctypeName: input.doctypeName,
    workflowName: input.workflow.name,
    workflow: input.workflow
  };
}

export function namedWorkflowClearedPayload(input: {
  readonly doctypeName: DocTypeName;
  readonly workflowName: string;
}): Extract<NamedWorkflowEventPayload, { readonly kind: "NamedWorkflowCleared" }> {
  return {
    kind: "NamedWorkflowCleared",
    doctypeName: input.doctypeName,
    workflowName: input.workflowName
  };
}

export function namedWorkflowFieldClaimedPayload(input: {
  readonly doctypeName: DocTypeName;
  readonly stateField: string;
  readonly workflowName: string;
}): Extract<NamedWorkflowFieldOwnershipEventPayload, { readonly kind: "NamedWorkflowFieldClaimed" }> {
  return { kind: "NamedWorkflowFieldClaimed", ...input };
}

export function namedWorkflowFieldReleasedPayload(input: {
  readonly doctypeName: DocTypeName;
  readonly stateField: string;
  readonly workflowName: string;
}): Extract<NamedWorkflowFieldOwnershipEventPayload, { readonly kind: "NamedWorkflowFieldReleased" }> {
  return { kind: "NamedWorkflowFieldReleased", ...input };
}

export function namedWorkflowDefinitionEvent<TPayload extends NamedWorkflowEventPayload>(options: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actor: Actor;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: namedWorkflowDefinitionEventType(options.payload),
    doctype: "__NamedWorkflows",
    documentName: `${options.payload.doctypeName}:${options.payload.workflowName}`,
    actorId: options.actor.id,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function namedWorkflowFieldOwnershipEvent<TPayload extends NamedWorkflowFieldOwnershipEventPayload>(options: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actor: Actor;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: options.payload.kind,
    doctype: "__NamedWorkflowFields",
    documentName: `${options.payload.doctypeName}:${options.payload.stateField}`,
    actorId: options.actor.id,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function namedWorkflowDefinitionEventType(
  payload: NamedWorkflowEventPayload
): NamedWorkflowPayloadKind {
  return namedWorkflowStateEventType(payload);
}

export function isNamedWorkflowPayloadKind(kind: string): kind is NamedWorkflowPayloadKind {
  return isNamedWorkflowStatePayloadKind(kind);
}

export function isNamedWorkflowEvent(event: DomainEvent): event is DomainEvent<NamedWorkflowEventPayload> {
  return isNamedWorkflowPayloadKind(domainEventPayloadKind(event));
}

export function namedWorkflowEventsVisibleAt(
  events: readonly DomainEvent[],
  occurredAt: string | undefined
): readonly DomainEvent[] {
  return occurredAt === undefined ? events : events.filter((event) => event.occurredAt <= occurredAt);
}

export function replayNamedWorkflowAppend(
  state: NamedWorkflowDefinitionState,
  previousEvents: readonly DomainEvent[],
  savedEvents: readonly DomainEvent[]
): NamedWorkflowDefinitionState {
  return foldNamedWorkflowDefinition(
    state.tenantId,
    state.doctypeName,
    state.workflowName,
    [...previousEvents, ...savedEvents]
  );
}

export function foldNamedWorkflowFieldOwnership(
  tenantId: TenantId,
  doctypeName: DocTypeName,
  stateField: string,
  events: readonly DomainEvent[]
): NamedWorkflowFieldOwnershipState {
  let workflowName: string | undefined;
  let version = 0;
  for (const event of events) {
    if (event.payload.kind !== "NamedWorkflowFieldClaimed" &&
      event.payload.kind !== "NamedWorkflowFieldReleased") {
      continue;
    }
    if (event.payload.doctypeName !== doctypeName || event.payload.stateField !== stateField) {
      continue;
    }
    version = Math.max(version, event.sequence);
    if (event.payload.kind === "NamedWorkflowFieldClaimed") {
      workflowName = event.payload.workflowName;
    } else if (workflowName === event.payload.workflowName) {
      workflowName = undefined;
    }
  }
  return Object.freeze({
    tenantId,
    doctypeName,
    stateField,
    version,
    ...(workflowName === undefined ? {} : { workflowName })
  });
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly NamedWorkflowSaved: Extract<
      NamedWorkflowEventPayload,
      { readonly kind: "NamedWorkflowSaved" }
    >;
    readonly NamedWorkflowCleared: Extract<
      NamedWorkflowEventPayload,
      { readonly kind: "NamedWorkflowCleared" }
    >;
    readonly NamedWorkflowFieldClaimed: Extract<
      NamedWorkflowFieldOwnershipEventPayload,
      { readonly kind: "NamedWorkflowFieldClaimed" }
    >;
    readonly NamedWorkflowFieldReleased: Extract<
      NamedWorkflowFieldOwnershipEventPayload,
      { readonly kind: "NamedWorkflowFieldReleased" }
    >;
  }
}
