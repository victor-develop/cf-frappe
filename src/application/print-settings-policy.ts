import { FrameworkError, badRequest, conflict, notFound, permissionDenied } from "../core/errors.js";
import {
  normalizePrintSettingsPatch,
  type PrintSettingsInput,
  type PrintSettingsPatch,
  type PrintSettingsState
} from "../core/print-settings.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type TenantId
} from "../core/types.js";

export function resolvePrintSettingsTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage print settings for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizePrintSettingsAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage print settings`);
  }
  return resolvePrintSettingsTenant(command);
}

export function ensurePrintSettingsServiceAvailable<T>(printSettings: T | undefined): asserts printSettings is T {
  if (printSettings === undefined) {
    throw notFound("Print settings are not enabled");
  }
}

export function normalizePrintSettingsPatchInput(
  input: PrintSettingsInput | Record<string, unknown>
): PrintSettingsPatch {
  try {
    return normalizePrintSettingsPatch(input as Record<string, unknown>);
  } catch (error) {
    if (error instanceof FrameworkError) {
      throw error;
    }
    throw badRequest(error instanceof Error ? error.message : "Print settings are invalid");
  }
}

export type PrintSettingsPatchChangeDecision =
  | { readonly status: "write" }
  | { readonly status: "noop" };

export function planPrintSettingsPatchChange(
  patch: PrintSettingsPatch
): PrintSettingsPatchChangeDecision {
  return Object.keys(patch).length === 0 ? { status: "noop" } : { status: "write" };
}

export function ensurePrintSettingsExpectedVersion(
  state: PrintSettingsState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected print settings at version ${expectedVersion}, found ${state.version}`);
  }
}
