import type { AssignmentRuleDefinition, DocTypeName } from "../core/types.js";

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
