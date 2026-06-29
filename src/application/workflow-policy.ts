import { conflict, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type TenantId,
  type WorkflowDefinition
} from "../core/types.js";
import type { WorkflowDefinitionState } from "../core/workflow.js";

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
  state: WorkflowDefinitionState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected workflow definitions at version ${expectedVersion}, found ${state.version}`);
  }
}

export function workflowDefinitionsEqual(
  left: WorkflowDefinition | undefined,
  right: WorkflowDefinition
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
