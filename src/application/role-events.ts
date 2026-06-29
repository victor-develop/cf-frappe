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

export interface RoleCreatedPayloadInput {
  readonly role: string;
  readonly enabled: boolean;
  readonly description?: string;
}

export interface RoleDescriptionChangedPayloadInput {
  readonly role: string;
  readonly description?: string;
}

export interface RoleStatusPayloadInput {
  readonly role: string;
}

export interface RoleStatusChangedPayloadInput extends RoleStatusPayloadInput {
  readonly enabled: boolean;
}

export function roleCreatedPayload(
  input: RoleCreatedPayloadInput
): Extract<RoleEventPayload, { readonly kind: "RoleCreated" }> {
  return {
    kind: "RoleCreated",
    role: input.role,
    enabled: input.enabled,
    ...(input.description === undefined ? {} : { description: input.description })
  };
}

export function roleDescriptionChangedPayload(
  input: RoleDescriptionChangedPayloadInput
): Extract<RoleEventPayload, { readonly kind: "RoleDescriptionChanged" }> {
  return {
    kind: "RoleDescriptionChanged",
    role: input.role,
    ...(input.description === undefined ? {} : { description: input.description })
  };
}

export function roleEnabledPayload(
  input: RoleStatusPayloadInput
): Extract<RoleEventPayload, { readonly kind: "RoleEnabled" }> {
  return {
    kind: "RoleEnabled",
    role: input.role
  };
}

export function roleDisabledPayload(
  input: RoleStatusPayloadInput
): Extract<RoleEventPayload, { readonly kind: "RoleDisabled" }> {
  return {
    kind: "RoleDisabled",
    role: input.role
  };
}

export function roleStatusChangedPayload(
  input: RoleStatusChangedPayloadInput
): Extract<RoleEventPayload, { readonly kind: "RoleEnabled" | "RoleDisabled" }> {
  return input.enabled ? roleEnabledPayload(input) : roleDisabledPayload(input);
}

export function roleEventType(payload: RoleEventPayload): RoleEventPayload["kind"] {
  return payload.kind;
}

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
