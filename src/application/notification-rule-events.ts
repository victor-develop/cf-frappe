import type { DocTypeName, NotificationRuleDefinition } from "../core/types.js";

export type NotificationRuleEventPayload =
  | {
      readonly kind: "NotificationRuleSaved";
      readonly doctypeName: DocTypeName;
      readonly rule: NotificationRuleDefinition;
    }
  | {
      readonly kind: "NotificationRuleCleared";
      readonly doctypeName: DocTypeName;
      readonly ruleName: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly NotificationRuleSaved: Extract<
      NotificationRuleEventPayload,
      { readonly kind: "NotificationRuleSaved" }
    >;
    readonly NotificationRuleCleared: Extract<
      NotificationRuleEventPayload,
      { readonly kind: "NotificationRuleCleared" }
    >;
  }
}
