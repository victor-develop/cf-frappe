import type { DomainEvent, TenantId } from "./types";

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
