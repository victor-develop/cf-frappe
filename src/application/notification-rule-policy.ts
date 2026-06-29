import {
  type NotificationRuleEntry,
  type NotificationRuleState
} from "../core/notification-rules.js";
import { conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type NotificationRuleDefinition,
  type TenantId
} from "../core/types.js";

export function resolveNotificationRuleTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage notification rules for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizeNotificationRuleAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage notification rules`);
  }
  return resolveNotificationRuleTenant(command);
}

export function ensureNotificationRuleExpectedVersion(
  state: NotificationRuleState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected notification rules at version ${expectedVersion}, found ${state.version}`);
  }
}

export function normalizeRequiredNotificationRuleText(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("NOTIFICATION_RULE_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new FrameworkError("NOTIFICATION_RULE_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

export function notificationRulesEqual(
  left: NotificationRuleDefinition,
  right: NotificationRuleDefinition
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function findNotificationRuleEntry(
  state: NotificationRuleState,
  ruleName: string
): NotificationRuleEntry | undefined {
  return state.rules.find((entry) => entry.rule.name === ruleName);
}

export function enabledNotificationRules(state: NotificationRuleState): readonly NotificationRuleDefinition[] {
  return state.rules
    .filter((entry) => entry.enabled)
    .map((entry) => entry.rule);
}
