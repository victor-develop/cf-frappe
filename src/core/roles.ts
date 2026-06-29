import { domainEventPayloadKind } from "./domain-events.js";
import type { DomainEvent, TenantId } from "./types.js";

export type RoleCatalogStatePayloadKind =
  | "RoleCreated"
  | "RoleDescriptionChanged"
  | "RoleEnabled"
  | "RoleDisabled";

export type RoleCatalogStateEventPayload =
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

export const ROLE_CATALOG_STATE_PAYLOAD_KINDS = Object.freeze([
  "RoleCreated",
  "RoleDescriptionChanged",
  "RoleEnabled",
  "RoleDisabled"
] as const satisfies readonly RoleCatalogStatePayloadKind[]);

const ROLE_CATALOG_STATE_PAYLOAD_KIND_SET = new Set<string>(ROLE_CATALOG_STATE_PAYLOAD_KINDS);

export interface RoleRecord {
  readonly name: string;
  readonly version: number;
  readonly enabled: boolean;
  readonly description?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface RoleCatalogState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly roles: readonly RoleRecord[];
}

export function foldRoleCatalog(tenantId: TenantId, events: readonly DomainEvent[]): RoleCatalogState {
  let version = 0;
  const roles = new Map<string, RoleRecord>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    if (!isRoleCatalogStateEvent(event)) {
      continue;
    }
    switch (event.payload.kind) {
      case "RoleCreated": {
        const name = normalizeRoleName(event.payload.role);
        roles.set(name, {
          name,
          version: event.sequence,
          enabled: event.payload.enabled,
          ...(event.payload.description === undefined ? {} : { description: event.payload.description }),
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt
        });
        break;
      }
      case "RoleDescriptionChanged": {
        const name = normalizeRoleName(event.payload.role);
        const existing = roles.get(name);
        if (!existing) {
          break;
        }
        const { description: _description, ...withoutDescription } = existing;
        roles.set(name, {
          ...withoutDescription,
          version: event.sequence,
          ...(event.payload.description === undefined ? {} : { description: event.payload.description }),
          updatedAt: event.occurredAt
        });
        break;
      }
      case "RoleEnabled":
      case "RoleDisabled": {
        const name = normalizeRoleName(event.payload.role);
        const existing = roles.get(name);
        if (!existing) {
          break;
        }
        roles.set(name, {
          ...existing,
          version: event.sequence,
          enabled: event.payload.kind === "RoleEnabled",
          updatedAt: event.occurredAt
        });
        break;
      }
    }
  }
  return {
    tenantId,
    version,
    roles: [...roles.values()].sort((left, right) => left.name.localeCompare(right.name))
  };
}

export function roleCatalogStateEventType(payload: RoleCatalogStateEventPayload): RoleCatalogStatePayloadKind {
  return payload.kind;
}

export function isRoleCatalogStatePayloadKind(kind: string): kind is RoleCatalogStatePayloadKind {
  return ROLE_CATALOG_STATE_PAYLOAD_KIND_SET.has(kind);
}

function isRoleCatalogStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: RoleCatalogStateEventPayload } {
  return isRoleCatalogStatePayloadKind(domainEventPayloadKind(event));
}

export function normalizeRoleName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeRoleDescription(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}
