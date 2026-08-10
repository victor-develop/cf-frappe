import { defineDocType } from "../../src/core/schema.js";
import { type AssignmentRuleState } from "../../src/core/assignment-rules.js";
import { type NotificationRuleState } from "../../src/core/notification-rules.js";
import {
  renderAssignmentRuleAdmin,
  renderNotificationRuleAdmin
} from "../../src/adapters/desk/views/admin-rules.js";

const titleNotEmpty = {
  kind: "compare",
  left: { kind: "field", scope: "after", field: "title" },
  operator: "ne",
  right: { kind: "literal", value: "" }
} as const;

const Task = defineDocType({
  name: "Task",
  fields: [
    { name: "title", type: "text" },
    { name: "owner_email", type: "text" }
  ]
});

describe("Desk notification rule admin", () => {
  it("renders a bare state with defaults", () => {
    const html = renderNotificationRuleAdmin({ doctypes: [Task], selectedDoctype: "Task" });
    expect(html).toContain("Notification Rule");
    expect(html).toContain("No notification rules configured.");
    expect(html).toContain('value="DocumentUpdated" checked');
    expect(html).not.toContain('class="error"');
  });

  it("renders a draft with empty recipients using the default field row", () => {
    const html = renderNotificationRuleAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      draftRule: { name: "notify", events: ["DocumentCreated"], recipients: [] },
      error: "Missing recipient"
    });
    expect(html).toContain("Edit Notification Rule");
    expect(html).toContain("Missing recipient");
    expect(html).toContain('value="notify"');
  });

  it("renders stored rules with all recipient kinds, channels, and toggles", () => {
    const state: NotificationRuleState = {
      tenantId: "tenant-a",
      doctypeName: "Task",
      version: 4,
      rules: [
        {
          tenantId: "tenant-a",
          doctypeName: "Task",
          rule: {
            name: "notify-owner",
            enabled: true,
            events: ["DocumentUpdated", "DocumentSubmitted"],
            recipients: [
              { kind: "documentOwner" },
              { kind: "field", field: "owner_email" },
              { kind: "user", userId: "ops@example.com" }
            ],
            channels: ["inbox", "email"],
            condition: titleNotEmpty,
            subject: "{{ name }} changed",
            excludeActor: true
          },
          enabled: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z",
          metadata: {}
        },
        {
          tenantId: "tenant-a",
          doctypeName: "Task",
          rule: { name: "muted", events: ["DocumentDeleted"], recipients: [{ kind: "documentOwner" }] },
          enabled: false,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z",
          metadata: {}
        }
      ]
    };
    const html = renderNotificationRuleAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      selectedRuleName: "notify-owner",
      doctype: Task,
      userSuggestions: ["victor@example.com"],
      state
    });
    expect(html).toContain("documentOwner, field:owner_email, user:ops@example.com");
    expect(html).toContain(">enabled</td>");
    expect(html).toContain(">disabled</td>");
    expect(html).toContain("notification-rules/Task/notify-owner/disable");
    expect(html).toContain("notification-rules/Task/muted/enable");
    expect(html).toContain("rule=notify-owner");
    expect(html).toContain("{{ name }} changed");
    expect(html).toContain("notification-rule-user-suggestions-1");
  });
});

describe("Desk assignment rule admin", () => {
  it("renders a bare state with defaults", () => {
    const html = renderAssignmentRuleAdmin({ doctypes: [Task], selectedDoctype: "Task" });
    expect(html).toContain("Assignment Rule");
    expect(html).toContain("No assignment rules configured.");
    expect(html).toContain('value="DocumentCreated" checked');
  });

  it("renders a draft with empty assignees using the default field row", () => {
    const html = renderAssignmentRuleAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      draftRule: { name: "assign", events: ["DocumentCreated"], assignees: [] },
      error: "Missing assignee"
    });
    expect(html).toContain("Edit Assignment Rule");
    expect(html).toContain("Missing assignee");
  });

  it("renders stored rules with both assignee kinds and toggles", () => {
    const state: AssignmentRuleState = {
      tenantId: "tenant-a",
      doctypeName: "Task",
      version: 2,
      rules: [
        {
          tenantId: "tenant-a",
          doctypeName: "Task",
          rule: {
            name: "route",
            enabled: true,
            events: ["DocumentCreated"],
            assignees: [
              { kind: "field", field: "owner_email" },
              { kind: "user", userId: "ops@example.com" }
            ],
            condition: titleNotEmpty,
            excludeActor: false
          },
          enabled: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z",
          metadata: {}
        },
        {
          tenantId: "tenant-a",
          doctypeName: "Task",
          rule: { name: "paused", events: ["DocumentUpdated"], assignees: [{ kind: "user", userId: "x@example.com" }] },
          enabled: false,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z",
          metadata: {}
        }
      ]
    };
    const html = renderAssignmentRuleAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      selectedRuleName: "route",
      doctype: Task,
      userSuggestions: ["victor@example.com"],
      state,
      draftRule: {
        name: "route",
        events: ["DocumentCreated"],
        assignees: [{ kind: "user", userId: "draft@example.com" }],
        excludeActor: true
      }
    });
    expect(html).toContain("field:owner_email, user:ops@example.com");
    expect(html).toContain("assignment-rules/Task/route/disable");
    expect(html).toContain("assignment-rules/Task/paused/enable");
    expect(html).toContain("rule=route");
    expect(html).toContain("draft@example.com");
    expect(html).toContain("assignment-rule-user-suggestions-1");
  });
});
