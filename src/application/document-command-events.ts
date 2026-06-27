import type { DocumentData } from "../core/types.js";

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
