import { describe, expect, it } from "vitest";

import {
  authorizeWorkflowAdministration,
  ensureWorkflowExpectedVersion,
  ensureWorkflowRolesKnown,
  ensureWorkflowServiceAvailable,
  planWorkflowDefinitionClear,
  planWorkflowDefinitionSave,
  resolveWorkflowTenant,
  workflowDefinitionsEqual
} from "../../src/application/workflow-policy.js";
import { SYSTEM_MANAGER_ROLE, type NamedWorkflowDefinition } from "../../src/core/types.js";
import type { NamedWorkflowDefinitionState } from "../../src/core/workflow.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

const workflow = {
  name: "lifecycle",
  stateField: "workflow_state",
  initialState: "Open",
  states: ["Open", "Closed"],
  transitions: [{ action: "close", from: "Open", to: "Closed", roles: ["User"] }]
} satisfies NamedWorkflowDefinition;

describe("workflow policy", () => {
  it("guards Desk workflow service availability", () => {
    expect(() => ensureWorkflowServiceAvailable({ list: async () => [] })).not.toThrow();
    expect(() => ensureWorkflowServiceAvailable(undefined)).toThrow("Workflows are not enabled");
  });

  it("resolves tenant scope and rejects cross-tenant administration", () => {
    expect(resolveWorkflowTenant({ actor: admin })).toBe("acme");
    expect(resolveWorkflowTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveWorkflowTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage workflows for tenant 'globex'"
    );
  });

  it("authorizes only configured workflow administrators", () => {
    expect(authorizeWorkflowAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(authorizeWorkflowAdministration({
      actor: { id: "workflow@example.com", roles: ["Workflow Manager"], tenantId: "acme" },
      adminRoles: ["Workflow Manager"]
    })).toBe("acme");
    expect(() => authorizeWorkflowAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] }))
      .toThrow("cannot manage workflows");
  });

  it("guards resource-local expected versions", () => {
    expect(() => ensureWorkflowExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureWorkflowExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureWorkflowExpectedVersion(state(2), 1)).toThrow(
      "Expected workflow 'Task.lifecycle' at version 1, found 2"
    );
  });

  it("plans saves and clears without redundant events", () => {
    expect(workflowDefinitionsEqual(undefined, workflow)).toBe(false);
    expect(workflowDefinitionsEqual({ ...workflow }, workflow)).toBe(true);
    expect(workflowDefinitionsEqual({ ...workflow, initialState: "Closed" }, workflow)).toBe(false);
    expect(planWorkflowDefinitionSave(undefined, workflow)).toEqual({ status: "append" });
    expect(planWorkflowDefinitionSave({ ...workflow }, workflow)).toEqual({ status: "noop" });
    expect(planWorkflowDefinitionClear(state(1))).toEqual({ status: "append" });
    expect(planWorkflowDefinitionClear({
      tenantId: "acme",
      doctypeName: "Task",
      workflowName: "lifecycle",
      version: 1,
      cleared: true
    })).toEqual({ status: "noop" });
  });

  it("requires every transition role to be known and enabled", () => {
    expect(() => ensureWorkflowRolesKnown(workflow, new Map([["User", "enabled"]]))).not.toThrow();
    expect(() => ensureWorkflowRolesKnown(workflow, new Map([["User", "disabled"]])))
      .toThrow("Workflow role 'User' is disabled");
    expect(() => ensureWorkflowRolesKnown(workflow, new Map()))
      .toThrow("Workflow role 'User' is not defined");
  });
});

function state(version: number): NamedWorkflowDefinitionState {
  return {
    tenantId: "acme",
    doctypeName: "Task",
    workflowName: "lifecycle",
    version,
    cleared: false,
    workflow
  };
}
