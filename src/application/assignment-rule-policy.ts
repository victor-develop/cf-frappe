import {
  type AssignmentRuleEntry,
  type AssignmentRuleState
} from "../core/assignment-rules.js";
import type { AfterCommitContext } from "../core/document-hooks.js";
import { conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type AssignmentRuleDefinition,
  type TenantId
} from "../core/types.js";

export function resolveAssignmentRuleTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage assignment rules for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizeAssignmentRuleAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage assignment rules`);
  }
  return resolveAssignmentRuleTenant(command);
}

export function ensureAssignmentRuleExpectedVersion(
  state: AssignmentRuleState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected assignment rules at version ${expectedVersion}, found ${state.version}`);
  }
}

export function normalizeRequiredAssignmentRuleText(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("ASSIGNMENT_RULE_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new FrameworkError("ASSIGNMENT_RULE_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

export function assignmentRulesEqual(left: AssignmentRuleDefinition, right: AssignmentRuleDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function findAssignmentRuleEntry(
  state: AssignmentRuleState,
  ruleName: string
): AssignmentRuleEntry | undefined {
  return state.rules.find((entry) => entry.rule.name === ruleName);
}

export type AssignmentRuleChangeDecision =
  | { readonly status: "append" }
  | { readonly status: "noop" };

export function planAssignmentRuleSave(
  existing: AssignmentRuleEntry | undefined,
  rule: AssignmentRuleDefinition
): AssignmentRuleChangeDecision {
  return existing !== undefined && assignmentRulesEqual(existing.rule, rule)
    ? { status: "noop" }
    : { status: "append" };
}

export function planAssignmentRuleClear(
  existing: AssignmentRuleEntry | undefined
): AssignmentRuleChangeDecision {
  return existing === undefined ? { status: "noop" } : { status: "append" };
}

export function planAssignmentRuleStatusChange(
  existing: AssignmentRuleEntry,
  enabled: boolean
): AssignmentRuleChangeDecision {
  return existing.enabled === enabled ? { status: "noop" } : { status: "append" };
}

export function requireAssignmentRuleEntry(
  state: AssignmentRuleState,
  ruleName: string
): AssignmentRuleEntry {
  const existing = findAssignmentRuleEntry(state, ruleName);
  if (existing === undefined) {
    throw new FrameworkError(
      "ASSIGNMENT_RULE_NOT_FOUND",
      `Assignment rule '${ruleName}' was not found`,
      { status: 404 }
    );
  }
  return existing;
}

export function enabledAssignmentRules(state: AssignmentRuleState): readonly AssignmentRuleDefinition[] {
  return state.rules
    .filter((entry) => entry.enabled)
    .map((entry) => entry.rule);
}

export function composeAssignmentRules(
  metadataRules: readonly AssignmentRuleDefinition[],
  runtimeRules: readonly AssignmentRuleDefinition[]
): readonly AssignmentRuleDefinition[] {
  if (metadataRules.length === 0) {
    return runtimeRules;
  }
  if (runtimeRules.length === 0) {
    return metadataRules;
  }
  const runtimeNames = new Set(runtimeRules.map((rule) => rule.name));
  return Object.freeze([
    ...metadataRules.filter((rule) => !runtimeNames.has(rule.name)),
    ...runtimeRules
  ]);
}

export function resolveAssignmentRuleActor(
  actor: Actor | ((context: AfterCommitContext) => Actor | Promise<Actor>),
  context: AfterCommitContext
): Actor | Promise<Actor> {
  return typeof actor === "function" ? actor(context) : actor;
}

export function assignmentActorForTenant(actor: Actor, tenantId: TenantId): Actor {
  if (actor.tenantId !== undefined && actor.tenantId !== tenantId) {
    throw permissionDenied(`Assignment rule actor '${actor.id}' cannot assign documents for tenant '${tenantId}'`);
  }
  return { ...actor, tenantId };
}
