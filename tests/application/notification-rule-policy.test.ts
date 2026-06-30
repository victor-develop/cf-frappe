import {
  authorizeNotificationRuleAdministration,
  enabledNotificationRules,
  ensureNotificationRuleExpectedVersion,
  ensureNotificationRuleServiceAvailable,
  findNotificationRuleEntry,
  normalizeRequiredNotificationRuleText,
  notificationRulesEqual,
  planNotificationRuleClear,
  planNotificationRuleSave,
  requireNotificationRuleEntry,
  resolveNotificationRuleTenant
} from "../../src/application/notification-rule-policy.js";
import { SYSTEM_MANAGER_ROLE, type NotificationRuleDefinition } from "../../src/core/types.js";
import type { NotificationRuleState } from "../../src/core/notification-rules.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

const enabledRule = {
  name: "Managers on updates",
  events: ["DocumentUpdated"],
  recipients: [{ kind: "user", userId: "manager@example.com" }],
  channels: ["inbox"]
} satisfies NotificationRuleDefinition;

const disabledRule = {
  name: "Email on create",
  events: ["DocumentCreated"],
  recipients: [{ kind: "user", userId: "email@example.com" }],
  channels: ["email"],
  enabled: false
} satisfies NotificationRuleDefinition;

describe("notification rule policy", () => {
  it("guards Desk notification-rule service availability", () => {
    expect(() => ensureNotificationRuleServiceAvailable({ list: async () => [] })).not.toThrow();

    let error: unknown;
    try {
      ensureNotificationRuleServiceAvailable(undefined);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      message: "Notification rules are not enabled",
      status: 404
    });
  });

  it("resolves notification rule tenants within the actor tenant boundary", () => {
    expect(resolveNotificationRuleTenant({ actor: admin })).toBe("acme");
    expect(resolveNotificationRuleTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolveNotificationRuleTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage notification rules for tenant 'globex'"
    );
  });

  it("authorizes only configured notification rule administrators", () => {
    expect(authorizeNotificationRuleAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizeNotificationRuleAdministration({
        actor: { id: "notify@example.com", roles: ["Notification Admin"], tenantId: "acme" },
        adminRoles: ["Notification Admin"]
      })
    ).toBe("acme");
    expect(() =>
      authorizeNotificationRuleAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage notification rules");
  });

  it("guards expected notification rule versions", () => {
    expect(() => ensureNotificationRuleExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensureNotificationRuleExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensureNotificationRuleExpectedVersion(state(2), 1)).toThrow(
      "Expected notification rules at version 1, found 2"
    );
  });

  it("normalizes required notification rule text", () => {
    expect(normalizeRequiredNotificationRuleText(" Managers on updates ", "Notification rule name"))
      .toBe("Managers on updates");
    expect(() => normalizeRequiredNotificationRuleText(" ", "Notification rule name")).toThrow(
      "Notification rule name is required"
    );
    expect(() => normalizeRequiredNotificationRuleText(1 as unknown as string, "Notification rule name")).toThrow(
      "Notification rule name must be a string"
    );
  });

  it("finds entries and projects enabled notification rules", () => {
    expect(findNotificationRuleEntry(state(1), "Managers on updates")).toMatchObject({
      rule: { name: "Managers on updates" }
    });
    expect(findNotificationRuleEntry(state(1), "Missing")).toBeUndefined();
    expect(enabledNotificationRules(state(1))).toEqual([enabledRule]);
  });

  it("requires notification rule entries with stable not-found semantics", () => {
    expect(requireNotificationRuleEntry(state(1), "Managers on updates")).toMatchObject({ enabled: true });

    let error: unknown;
    try {
      requireNotificationRuleEntry(state(1), "Missing");
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "NOTIFICATION_RULE_NOT_FOUND",
      message: "Notification rule 'Missing' was not found",
      status: 404
    });
  });

  it("plans notification rule saves without emitting redundant catalog events", () => {
    const existing = findNotificationRuleEntry(state(1), "Managers on updates");

    expect(planNotificationRuleSave(existing, enabledRule)).toEqual({ status: "noop" });
    expect(planNotificationRuleSave(existing, { ...enabledRule, subject: "Changed" })).toEqual({
      status: "append"
    });
    expect(planNotificationRuleSave(undefined, enabledRule)).toEqual({ status: "append" });
  });

  it("plans notification rule clears without emitting missing-rule events", () => {
    expect(planNotificationRuleClear(findNotificationRuleEntry(state(1), "Managers on updates"))).toEqual({
      status: "append"
    });
    expect(planNotificationRuleClear(findNotificationRuleEntry(state(1), "Missing"))).toEqual({ status: "noop" });
  });

  it("compares normalized notification rules structurally", () => {
    expect(notificationRulesEqual(enabledRule, { ...enabledRule })).toBe(true);
    expect(notificationRulesEqual(enabledRule, { ...enabledRule, subject: "Changed" })).toBe(false);
  });
});

function state(version: number): NotificationRuleState {
  return {
    tenantId: "acme",
    doctypeName: "Note",
    version,
    rules: [
      {
        tenantId: "acme",
        doctypeName: "Note",
        rule: enabledRule,
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        metadata: {}
      },
      {
        tenantId: "acme",
        doctypeName: "Note",
        rule: disabledRule,
        enabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        metadata: {}
      }
    ]
  };
}
