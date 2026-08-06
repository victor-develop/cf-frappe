import { conflict, FrameworkError, notFound, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type NamedWorkflowDefinition,
  type TenantId
} from "../core/types.js";
import type { NamedWorkflowDefinitionState } from "../core/workflow.js";

export function ensureWorkflowServiceAvailable<T>(workflows: T | undefined): asserts workflows is T {
  if (workflows === undefined) {
    throw notFound("Workflows are not enabled");
  }
}

export function resolveWorkflowTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage workflows for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizeWorkflowAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage workflows`);
  }
  return resolveWorkflowTenant(command);
}

export function ensureWorkflowExpectedVersion(
  state: NamedWorkflowDefinitionState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(
      `Expected workflow '${state.doctypeName}.${state.workflowName}' at version ${String(expectedVersion)}, ` +
      `found ${String(state.version)}`
    );
  }
}

export function workflowDefinitionsEqual(
  left: NamedWorkflowDefinition | undefined,
  right: NamedWorkflowDefinition
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

export type WorkflowDefinitionChangeDecision =
  | { readonly status: "append" }
  | { readonly status: "noop" };

export function planWorkflowDefinitionSave(
  existing: NamedWorkflowDefinition | undefined,
  workflow: NamedWorkflowDefinition
): WorkflowDefinitionChangeDecision {
  return workflowDefinitionsEqual(existing, workflow) ? { status: "noop" } : { status: "append" };
}

export function planWorkflowDefinitionClear(
  state: NamedWorkflowDefinitionState
): WorkflowDefinitionChangeDecision {
  return state.cleared ? { status: "noop" } : { status: "append" };
}

export function ensureWorkflowRolesKnown(
  workflow: NamedWorkflowDefinition,
  roles: ReadonlyMap<string, "enabled" | "disabled">
): void {
  for (const role of new Set(workflow.transitions.flatMap((transition) => transition.roles ?? []))) {
    const status = roles.get(role);
    if (status === "enabled") {
      continue;
    }
    throw new FrameworkError(
      "WORKFLOW_INVALID",
      status === "disabled" ? `Workflow role '${role}' is disabled` : `Workflow role '${role}' is not defined`,
      { status: 400 }
    );
  }
}
