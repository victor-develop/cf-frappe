import {
  DEFAULT_TENANT_ID,
  type Actor
} from "../core/types.js";

export function resolveTenant(actor: Actor, explicitTenantId?: string): string {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}
