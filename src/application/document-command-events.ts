import { domainEventPayloadKind } from "../core/domain-events.js";
import type { DocTypeName, DocumentData, DomainEvent } from "../core/types.js";

export type DocumentCommandEventPayload =
  | {
      readonly kind: "WorkflowTransitioned";
      readonly action: string;
      readonly from: string;
      readonly to: string;
      readonly patch: DocumentData;
    }
  | {
      readonly kind: "DomainCommandApplied";
      readonly command: string;
      readonly input: DocumentData;
      readonly patch: DocumentData;
    };

export type DocumentCommandPayloadKind = DocumentCommandEventPayload["kind"];

export const DOCUMENT_COMMAND_PAYLOAD_KINDS = Object.freeze([
  "WorkflowTransitioned",
  "DomainCommandApplied"
] as const satisfies readonly DocumentCommandPayloadKind[]);

const DOCUMENT_COMMAND_PAYLOAD_KIND_SET = new Set<string>(DOCUMENT_COMMAND_PAYLOAD_KINDS);

export interface WorkflowTransitionPayloadInput {
  readonly action: string;
  readonly from: string;
  readonly to: string;
  readonly patch: DocumentData;
}

export interface DomainCommandAppliedPayloadInput {
  readonly command: string;
  readonly input: DocumentData;
  readonly patch: DocumentData;
}

export function workflowTransitionedPayload(
  input: WorkflowTransitionPayloadInput
): Extract<DocumentCommandEventPayload, { readonly kind: "WorkflowTransitioned" }> {
  return {
    kind: "WorkflowTransitioned",
    action: input.action,
    from: input.from,
    to: input.to,
    patch: input.patch
  };
}

export function domainCommandAppliedPayload(
  input: DomainCommandAppliedPayloadInput
): Extract<DocumentCommandEventPayload, { readonly kind: "DomainCommandApplied" }> {
  return {
    kind: "DomainCommandApplied",
    command: input.command,
    input: input.input,
    patch: input.patch
  };
}

export interface WorkflowTransitionEventTypeOptions {
  readonly doctypeName: DocTypeName;
  readonly action: string;
  readonly transitionEventType?: string | undefined;
}

export function workflowTransitionEventType(options: WorkflowTransitionEventTypeOptions): string {
  return options.transitionEventType ?? `${options.doctypeName}${capitalizeAction(options.action)}`;
}

export function isDocumentCommandPayloadKind(kind: string): kind is DocumentCommandPayloadKind {
  return DOCUMENT_COMMAND_PAYLOAD_KIND_SET.has(kind);
}

export function isDocumentCommandEvent(event: DomainEvent): event is DomainEvent<DocumentCommandEventPayload> {
  return isDocumentCommandPayloadKind(domainEventPayloadKind(event));
}

function capitalizeAction(action: string): string {
  return `${action[0]?.toUpperCase() ?? ""}${action.slice(1)}`;
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly WorkflowTransitioned: Extract<
      DocumentCommandEventPayload,
      { readonly kind: "WorkflowTransitioned" }
    >;
    readonly DomainCommandApplied: Extract<
      DocumentCommandEventPayload,
      { readonly kind: "DomainCommandApplied" }
    >;
  }
}
