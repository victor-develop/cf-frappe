export type RoleEventPayload =
  | {
      readonly kind: "RoleCreated";
      readonly role: string;
      readonly enabled: boolean;
      readonly description?: string;
    }
  | {
      readonly kind: "RoleDescriptionChanged";
      readonly role: string;
      readonly description?: string;
    }
  | {
      readonly kind: "RoleEnabled";
      readonly role: string;
    }
  | {
      readonly kind: "RoleDisabled";
      readonly role: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly RoleCreated: Extract<RoleEventPayload, { readonly kind: "RoleCreated" }>;
    readonly RoleDescriptionChanged: Extract<
      RoleEventPayload,
      { readonly kind: "RoleDescriptionChanged" }
    >;
    readonly RoleEnabled: Extract<RoleEventPayload, { readonly kind: "RoleEnabled" }>;
    readonly RoleDisabled: Extract<RoleEventPayload, { readonly kind: "RoleDisabled" }>;
  }
}
