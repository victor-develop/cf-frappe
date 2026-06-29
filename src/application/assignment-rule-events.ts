import { foldAssignmentRules, type AssignmentRuleState } from "../core/assignment-rules.js";
import type {
  Actor,
  AssignmentRuleDefinition,
  DocTypeName,
  DocumentData,
  DomainEvent,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../core/types.js";

export type AssignmentRuleEventPayload =
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

export const ASSIGNMENT_RULE_PAYLOAD_KINDS = Object.freeze([
  "AssignmentRuleSaved",
  "AssignmentRuleCleared"
] as const);

export interface AssignmentRuleEventOptions<TPayload extends AssignmentRuleEventPayload> {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actor: Actor;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}

export function assignmentRuleEvent<TPayload extends AssignmentRuleEventPayload>(
  options: AssignmentRuleEventOptions<TPayload>
): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: options.payload.kind,
    doctype: "__AssignmentRules",
    documentName: assignmentRuleDocumentName(options.payload),
    actorId: options.actor.id,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function assignmentRuleDocumentName(payload: AssignmentRuleEventPayload): string {
  return `${payload.doctypeName}:${assignmentRuleNameForPayload(payload)}`;
}

export function assignmentRuleNameForPayload(payload: AssignmentRuleEventPayload): string {
  if (payload.kind === "AssignmentRuleSaved") {
    return payload.rule.name;
  }
  return payload.ruleName;
}

export function assignmentRuleEventsVisibleAt(
  events: readonly DomainEvent[],
  occurredAt: string | undefined
): readonly DomainEvent[] {
  return occurredAt === undefined ? events : events.filter((event) => event.occurredAt <= occurredAt);
}

export function replayAssignmentRuleAppend(
  state: AssignmentRuleState,
  previousEvents: readonly DomainEvent[],
  savedEvents: readonly DomainEvent[]
): AssignmentRuleState {
  return foldAssignmentRules(state.tenantId, state.doctypeName, [...previousEvents, ...savedEvents]);
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly AssignmentRuleSaved: Extract<
      AssignmentRuleEventPayload,
      { readonly kind: "AssignmentRuleSaved" }
    >;
    readonly AssignmentRuleCleared: Extract<
      AssignmentRuleEventPayload,
      { readonly kind: "AssignmentRuleCleared" }
    >;
  }
}
