import {
  authorizeWorkflowAdministration,
  ensureWorkflowExpectedVersion,
  ensureWorkflowServiceAvailable,
  planWorkflowDefinitionClear,
  planWorkflowDefinitionSave,
  resolveWorkflowTenant,
  workflowDefinitionsEqual
} from "../../src/application/workflow-policy.js";
import { SYSTEM_MANAGER_ROLE, type WorkflowDefinition } from "../../src/core/types.js";
import type { WorkflowDefinitionState } from "../../src/core/workflow.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

const workflow = {
  initialState: "Open",
  states: ["Open", "Closed"],
  transitions: [{ action: "close", from: "Open", to: "Closed", roles: ["User"] }]
} satisfies WorkflowDefinition;

describe("workflow policy", () => {
  it("guards Desk workflow service availability", () => {
    expect(() => ensureWorkflowServiceAvailable({ list: async () => [] })).not.toThrow();

    let error: unknown;
    try {
      ensureWorkflowServiceAvailable(undefined);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      message: "Workflows are not enabled",
      status: 404
    });
  });

  it("resolves workflow tenants from actors and default actors", () => {
    expect(resolveWorkflowTenant({ actor: admin })).toBe("acme");
    expect(resolveWorkflowTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
  });

  it("rejects cross-tenant workflow administration", () => {
    expect(() => resolveWorkflowTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage workflows for tenant 'globex'"
    );
  });

  it("authorizes only configured workflow administrators", () => {
    expect(authorizeWorkflowAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeWorkflowAdministration({
        actor: { id: "workflow@example.com", roles: ["Workflow Manager"], tenantId: "acme" },
        adminRoles: ["Workflow Manager"]
      })
    ).toBe("acme");
    expect(() =>
      authorizeWorkflowAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage workflows");
  });

  it("guards expected workflow definition versions", () => {
    expect(() => ensureWorkflowExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureWorkflowExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureWorkflowExpectedVersion(state(2), 1)).toThrow(
      "Expected workflow definitions at version 1, found 2"
    );
  });

  it("detects stored workflow definition equality", () => {
    expect(workflowDefinitionsEqual(undefined, workflow)).toBe(false);
    expect(workflowDefinitionsEqual({ ...workflow }, workflow)).toBe(true);
    expect(workflowDefinitionsEqual({ ...workflow, initialState: "Closed" }, workflow)).toBe(false);
  });

  it("plans workflow definition saves without emitting redundant catalog events", () => {
    expect(planWorkflowDefinitionSave(undefined, workflow)).toEqual({ status: "append" });
    expect(planWorkflowDefinitionSave({ ...workflow }, workflow)).toEqual({ status: "noop" });
    expect(planWorkflowDefinitionSave({ ...workflow, initialState: "Closed" }, workflow)).toEqual({
      status: "append"
    });
  });

  it("plans workflow definition clears without emitting missing-definition events", () => {
    expect(planWorkflowDefinitionClear(workflow)).toEqual({ status: "append" });
    expect(planWorkflowDefinitionClear(undefined)).toEqual({ status: "noop" });
  });
});

function state(version: number): WorkflowDefinitionState {
  return {
    tenantId: "acme",
    doctypeName: "Task",
    version,
    workflow
  };
}
