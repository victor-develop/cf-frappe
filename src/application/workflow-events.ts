import type { DocTypeName, WorkflowDefinition } from "../core/types.js";

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
