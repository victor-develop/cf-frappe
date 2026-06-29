import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  ROLE_CATALOG_STATE_PAYLOAD_KINDS,
  isRoleCatalogStatePayloadKind,
  roleCatalogStateEventType,
  type RoleCatalogStateEventPayload,
  type RoleCatalogStatePayloadKind
} from "../core/roles.js";
import type { DomainEvent } from "../core/types.js";

export type RoleEventPayload = RoleCatalogStateEventPayload;

export type RolePayloadKind = RoleCatalogStatePayloadKind;

export const ROLE_PAYLOAD_KINDS = ROLE_CATALOG_STATE_PAYLOAD_KINDS;

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

export function roleEventType(payload: RoleEventPayload): RolePayloadKind {
  return roleCatalogStateEventType(payload);
}

export function isRolePayloadKind(kind: string): kind is RolePayloadKind {
  return isRoleCatalogStatePayloadKind(kind);
}

export function isRoleEvent(event: DomainEvent): event is DomainEvent<RoleEventPayload> {
  return isRolePayloadKind(domainEventPayloadKind(event));
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
