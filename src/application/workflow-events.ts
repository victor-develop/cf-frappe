import { foldWorkflowDefinition, type WorkflowDefinitionState } from "../core/workflow.js";
import type {
  Actor,
  DocTypeName,
  DocumentData,
  DomainEvent,
  NewDomainEvent,
  StreamName,
  TenantId,
  WorkflowDefinition
} from "../core/types.js";

export type WorkflowEventPayload =
  | {
      readonly kind: "WorkflowDefinitionSaved";
      readonly doctypeName: DocTypeName;
      readonly workflow: WorkflowDefinition;
    }
  | {
      readonly kind: "WorkflowDefinitionCleared";
      readonly doctypeName: DocTypeName;
    };

export const WORKFLOW_DEFINITION_PAYLOAD_KINDS = Object.freeze([
  "WorkflowDefinitionSaved",
  "WorkflowDefinitionCleared"
] as const);

export interface WorkflowDefinitionEventOptions<TPayload extends WorkflowEventPayload> {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actor: Actor;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}

export function workflowDefinitionEvent<TPayload extends WorkflowEventPayload>(
  options: WorkflowDefinitionEventOptions<TPayload>
): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: options.payload.kind,
    doctype: "__Workflows",
    documentName: options.payload.doctypeName,
    actorId: options.actor.id,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function workflowEventsVisibleAt(
  events: readonly DomainEvent[],
  occurredAt: string | undefined
): readonly DomainEvent[] {
  return occurredAt === undefined ? events : events.filter((event) => event.occurredAt <= occurredAt);
}

export function replayWorkflowDefinitionAppend(
  state: WorkflowDefinitionState,
  previousEvents: readonly DomainEvent[],
  savedEvents: readonly DomainEvent[]
): WorkflowDefinitionState {
  return foldWorkflowDefinition(state.tenantId, state.doctypeName, [...previousEvents, ...savedEvents]);
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly WorkflowDefinitionSaved: Extract<
      WorkflowEventPayload,
      { readonly kind: "WorkflowDefinitionSaved" }
    >;
    readonly WorkflowDefinitionCleared: Extract<
      WorkflowEventPayload,
      { readonly kind: "WorkflowDefinitionCleared" }
    >;
  }
}
