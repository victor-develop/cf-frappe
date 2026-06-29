import {
  assignmentActorForTenant,
  assignmentRulesEqual,
  authorizeAssignmentRuleAdministration,
  composeAssignmentRules,
  enabledAssignmentRules,
  ensureAssignmentRuleExpectedVersion,
  findAssignmentRuleEntry,
  normalizeRequiredAssignmentRuleText,
  planAssignmentRuleClear,
  planAssignmentRuleSave,
  planAssignmentRuleStatusChange,
  requireAssignmentRuleEntry,
  resolveAssignmentRuleActor,
  resolveAssignmentRuleTenant
} from "../../src/application/assignment-rule-policy.js";
import { SYSTEM_MANAGER_ROLE, type AssignmentRuleDefinition } from "../../src/core/types.js";
import type { AssignmentRuleState } from "../../src/core/assignment-rules.js";
import type { AfterCommitContext } from "../../src/core/document-hooks.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

const runtimeRule = {
  name: "Runtime triage",
  events: ["DocumentCreated"],
  assignees: [{ kind: "user", userId: "manager@example.com" }]
} satisfies AssignmentRuleDefinition;

const metadataRule = {
  name: "Metadata triage",
  events: ["DocumentUpdated"],
  assignees: [{ kind: "user", userId: "reviewer@example.com" }]
} satisfies AssignmentRuleDefinition;

describe("assignment rule policy", () => {
  it("resolves assignment rule tenants within the actor tenant boundary", () => {
    expect(resolveAssignmentRuleTenant({ actor: admin })).toBe("acme");
    expect(resolveAssignmentRuleTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveAssignmentRuleTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage assignment rules for tenant 'globex'"
    );
  });

  it("authorizes only configured assignment rule administrators", () => {
    expect(authorizeAssignmentRuleAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeAssignmentRuleAdministration({
        actor: { id: "automation@example.com", roles: ["Assignment Admin"], tenantId: "acme" },
        adminRoles: ["Assignment Admin"]
      })
    ).toBe("acme");
    expect(() =>
      authorizeAssignmentRuleAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage assignment rules");
  });

  it("guards expected assignment rule versions", () => {
    expect(() => ensureAssignmentRuleExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureAssignmentRuleExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureAssignmentRuleExpectedVersion(state(2), 1)).toThrow(
      "Expected assignment rules at version 1, found 2"
    );
  });

  it("normalizes required assignment rule text", () => {
    expect(normalizeRequiredAssignmentRuleText(" Runtime triage ", "Assignment rule name")).toBe("Runtime triage");
    expect(() => normalizeRequiredAssignmentRuleText(" " as string, "Assignment rule name")).toThrow(
      "Assignment rule name is required"
    );
    expect(() => normalizeRequiredAssignmentRuleText(1 as unknown as string, "Assignment rule name")).toThrow(
      "Assignment rule name must be a string"
    );
  });

  it("finds required entries and projects enabled runtime rules", () => {
    expect(findAssignmentRuleEntry(state(1), "Runtime triage")).toMatchObject({ rule: { name: "Runtime triage" } });
    expect(requireAssignmentRuleEntry(state(1), "Runtime triage")).toMatchObject({ enabled: true });
    expect(() => requireAssignmentRuleEntry(state(1), "Missing")).toThrow(
      "Assignment rule 'Missing' was not found"
    );
    expect(enabledAssignmentRules(state(1))).toEqual([runtimeRule]);
  });

  it("plans assignment rule saves without emitting redundant catalog events", () => {
    const existing = findAssignmentRuleEntry(state(1), "Runtime triage");

    expect(planAssignmentRuleSave(existing, runtimeRule)).toEqual({ status: "noop" });
    expect(planAssignmentRuleSave(existing, { ...runtimeRule, events: ["DocumentUpdated"] })).toEqual({
      status: "append"
    });
    expect(planAssignmentRuleSave(undefined, runtimeRule)).toEqual({ status: "append" });
  });

  it("plans assignment rule clears without emitting missing-rule events", () => {
    expect(planAssignmentRuleClear(findAssignmentRuleEntry(state(1), "Runtime triage"))).toEqual({
      status: "append"
    });
    expect(planAssignmentRuleClear(findAssignmentRuleEntry(state(1), "Missing"))).toEqual({ status: "noop" });
  });

  it("plans assignment rule status changes without emitting redundant catalog events", () => {
    expect(planAssignmentRuleStatusChange(requireAssignmentRuleEntry(state(1), "Runtime triage"), true)).toEqual({
      status: "noop"
    });
    expect(planAssignmentRuleStatusChange(requireAssignmentRuleEntry(state(1), "Runtime triage"), false)).toEqual({
      status: "append"
    });
  });

  it("compares and composes assignment rules with runtime overrides", () => {
    expect(assignmentRulesEqual(runtimeRule, { ...runtimeRule })).toBe(true);
    expect(assignmentRulesEqual(runtimeRule, { ...runtimeRule, name: "Other" })).toBe(false);
    expect(composeAssignmentRules([metadataRule], [runtimeRule])).toEqual([metadataRule, runtimeRule]);
    expect(composeAssignmentRules([{ ...runtimeRule, events: ["DocumentUpdated"] }], [runtimeRule])).toEqual([
      runtimeRule
    ]);
  });

  it("resolves hook actors and constrains assignment actors to the source tenant", async () => {
    expect(resolveAssignmentRuleActor(admin, {} as AfterCommitContext)).toEqual(admin);
    await expect(
      resolveAssignmentRuleActor(async () => owner, {} as AfterCommitContext)
    ).resolves.toEqual(owner);
    expect(assignmentActorForTenant({ id: "system@example.com", roles: [SYSTEM_MANAGER_ROLE] }, "acme"))
      .toMatchObject({ id: "system@example.com", tenantId: "acme" });
    expect(() => assignmentActorForTenant({ ...admin, tenantId: "globex" }, "acme")).toThrow(
      "Assignment rule actor 'admin@example.com' cannot assign documents for tenant 'acme'"
    );
  });
});

function state(version: number): AssignmentRuleState {
  return {
    tenantId: "acme",
    doctypeName: "Ticket",
    version,
    rules: [
      {
        tenantId: "acme",
        doctypeName: "Ticket",
        rule: runtimeRule,
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        metadata: {}
      },
      {
        tenantId: "acme",
        doctypeName: "Ticket",
        rule: { ...metadataRule, enabled: false },
        enabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        metadata: {}
      }
    ]
  };
}
