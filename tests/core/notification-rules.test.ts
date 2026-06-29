import {
  foldNotificationRules,
  normalizeNotificationRule,
  notificationRuleEmailNotificationsFromDomainEvent,
  notificationRuleUserNotificationsFromDomainEvent,
  type DomainEvent,
  type DocumentSnapshot,
  type NotificationRuleDefinition
} from "../../src";
import { noteDocType, now, owner } from "../helpers";

describe("notification rules", () => {
  it("folds saved and cleared notification rule metadata events", () => {
    const rule = normalizeNotificationRule(noteDocType, {
      name: "Managers on updates",
      events: ["DocumentUpdated"],
      recipients: [{ kind: "user", userId: "manager@example.com" }]
    });
    const state = foldNotificationRules("acme", "Note", [
      ruleEvent(1, "evt_save", {
        kind: "NotificationRuleSaved",
        doctypeName: "Note",
        rule
      }, { source: "seed" }),
      ruleEvent(2, "evt_other", {
        kind: "NotificationRuleSaved",
        doctypeName: "Task",
        rule: { ...rule, name: "Task rule" }
      }),
      ruleEvent(3, "evt_clear", {
        kind: "NotificationRuleCleared",
        doctypeName: "Note",
        ruleName: "Managers on updates"
      })
    ]);

    expect(state).toMatchObject({
      tenantId: "acme",
      doctypeName: "Note",
      version: 3,
      rules: []
    });
    const saved = foldNotificationRules("acme", "Note", [
      ruleEvent(1, "evt_save", {
        kind: "NotificationRuleSaved",
        doctypeName: "Note",
        rule
      }, { source: "seed" })
    ]);
    expect(saved.rules[0]).toMatchObject({
      rule: { name: "Managers on updates" },
      metadata: { source: "seed" }
    });
  });

  it("normalizes and validates supported event kinds and recipient targets", () => {
    const normalized = normalizeNotificationRule(noteDocType, {
      name: "  Owner and support  ",
      enabled: true,
      events: ["DocumentCreated", "DocumentUpdated"],
      recipients: [
        { kind: "documentOwner" },
        { kind: "field", field: "created_by" },
        { kind: "user", userId: " support@example.com " }
      ],
      channels: ["email", "inbox"],
      condition: { field: "priority", value: "High" },
      subject: "  {{ doctype }} {{ name }} changed  ",
      excludeActor: false
    });

    expect(normalized).toEqual({
      name: "Owner and support",
      enabled: true,
      events: ["DocumentCreated", "DocumentUpdated"],
      recipients: [
        { kind: "documentOwner" },
        { kind: "field", field: "created_by" },
        { kind: "user", userId: "support@example.com" }
      ],
      channels: ["email", "inbox"],
      condition: { field: "priority", value: "High" },
      subject: "{{ doctype }} {{ name }} changed",
      excludeActor: false
    });
    expect(() =>
      normalizeNotificationRule(noteDocType, {
        name: "Bad event",
        events: ["UserNotificationRead" as never],
        recipients: [{ kind: "user", userId: "support@example.com" }]
      })
    ).toThrow(/not supported/);
    expect(() =>
      normalizeNotificationRule(noteDocType, {
        name: "Bad field",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "field", field: "count" }]
      })
    ).toThrow(/must store user ids/);
    expect(() =>
      normalizeNotificationRule(noteDocType, {
        name: "Bad channel",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "support@example.com" }],
        channels: ["sms" as never]
      })
    ).toThrow(/channel 'sms' is not supported/);
    expect(() =>
      normalizeNotificationRule(noteDocType, {
        name: "Bad condition",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "support@example.com" }],
        condition: { field: "metadata", value: "x" }
      })
    ).toThrow("Filter field 'metadata' is not defined on Note");
  });

  it("evaluates matching rules into deduplicated user notification payloads", () => {
    const event = documentEvent("evt_update", "DocumentUpdated");
    const snapshot = noteSnapshot({ created_by: owner.id, reviewer: "reviewer@example.com" });
    const rules: readonly NotificationRuleDefinition[] = [
      normalizeNotificationRule(
        {
          ...noteDocType,
          fields: [...noteDocType.fields, { name: "reviewer", type: "text" }]
        },
        {
          name: "Review alert",
          events: ["DocumentUpdated"],
          recipients: [
            { kind: "documentOwner" },
            { kind: "field", field: "reviewer" },
            { kind: "user", userId: "reviewer@example.com" }
          ],
          subject: "{{ actor }} changed {{ doctype }} {{ name }}"
        }
      ),
      {
        name: "Disabled",
        enabled: false,
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "disabled@example.com" }]
      }
    ];

    const notifications = notificationRuleUserNotificationsFromDomainEvent({ event, snapshot, rules });

    expect(notifications).toEqual([
      expect.objectContaining({
        eventId: "evt_update",
        recipientId: "reviewer@example.com",
        ruleName: "Review alert",
        subject: "owner@example.com changed Note My Note"
      })
    ]);
  });

  it("applies notification rule conditions to post-commit snapshots", () => {
    const event = documentEvent("evt_update", "DocumentUpdated");
    const rule = normalizeNotificationRule(noteDocType, {
      name: "High priority alert",
      events: ["DocumentUpdated"],
      recipients: [{ kind: "user", userId: "manager@example.com" }],
      condition: { field: "priority", value: "High" }
    });

    expect(
      notificationRuleUserNotificationsFromDomainEvent({
        event,
        snapshot: noteSnapshot({ priority: "Medium" }),
        rules: [rule]
      })
    ).toEqual([]);
    expect(
      notificationRuleUserNotificationsFromDomainEvent({
        event,
        snapshot: noteSnapshot({ priority: "High" }),
        rules: [rule]
      })
    ).toEqual([
      expect.objectContaining({
        recipientId: "manager@example.com",
        ruleName: "High priority alert"
      })
    ]);
  });

  it("evaluates email-channel rules into deduplicated email payloads without inbox payloads", () => {
    const event = documentEvent("evt_update", "DocumentUpdated");
    const snapshot = noteSnapshot({ created_by: owner.id, reviewer: "reviewer@example.com" });
    const rule = normalizeNotificationRule(
      {
        ...noteDocType,
        fields: [...noteDocType.fields, { name: "reviewer", type: "text" }]
      },
      {
        name: "Email review alert",
        events: ["DocumentUpdated"],
        recipients: [
          { kind: "field", field: "reviewer" },
          { kind: "user", userId: "reviewer@example.com" }
        ],
        channels: ["email"],
        subject: "{{ actor }} changed {{ doctype }} {{ name }}"
      }
    );

    expect(notificationRuleUserNotificationsFromDomainEvent({ event, snapshot, rules: [rule] })).toEqual([]);
    expect(notificationRuleEmailNotificationsFromDomainEvent({ event, snapshot, rules: [rule] })).toEqual([
      {
        kind: "DocumentEmailNotification",
        eventId: "evt_update",
        eventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        tenantId: "acme",
        doctype: "Note",
        documentName: "My Note",
        actorId: owner.id,
        recipientId: "reviewer@example.com",
        subject: "owner@example.com changed Note My Note",
        text: [
          "owner@example.com changed Note My Note",
          "",
          "Document: Note My Note",
          "Event: DocumentUpdated",
          "Actor: owner@example.com",
          "Rule: Email review alert"
        ].join("\n"),
        ruleName: "Email review alert"
      }
    ]);
  });

  it("derives rule notification payload kinds from source event identity", () => {
    const event = documentEvent("evt_update", "DocumentUpdated");
    const snapshot = noteSnapshot({ created_by: owner.id });
    const rule = normalizeNotificationRule(noteDocType, {
      name: "Owner alerts",
      events: ["DocumentUpdated"],
      recipients: [{ kind: "documentOwner" }],
      channels: ["inbox", "email"],
      excludeActor: false
    });

    expect(notificationRuleUserNotificationsFromDomainEvent({ event, snapshot, rules: [rule] })).toMatchObject([
      {
        eventId: "evt_update",
        eventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        recipientId: owner.id
      }
    ]);
    expect(notificationRuleEmailNotificationsFromDomainEvent({ event, snapshot, rules: [rule] })).toMatchObject([
      {
        eventId: "evt_update",
        eventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        recipientId: owner.id
      }
    ]);
  });

  it("derives rendered email event labels from source event identity", () => {
    const event = documentEvent("evt_submit", "DocumentSubmitted");
    const snapshot = noteSnapshot({ created_by: owner.id });
    const rule = normalizeNotificationRule(noteDocType, {
      name: "Submission email",
      events: ["DocumentSubmitted"],
      recipients: [{ kind: "user", userId: "reviewer@example.com" }],
      channels: ["email"]
    });

    expect(notificationRuleEmailNotificationsFromDomainEvent({ event, snapshot, rules: [rule] })).toMatchObject([
      {
        payloadKind: "DocumentSubmitted",
        text: expect.stringContaining("Event: DocumentSubmitted")
      }
    ]);
  });
});

function ruleEvent(
  sequence: number,
  id: string,
  payload: Extract<DomainEvent["payload"], { readonly kind: "NotificationRuleSaved" | "NotificationRuleCleared" }>,
  metadata: DomainEvent["metadata"] = {}
): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:__NotificationRules:rules",
    sequence,
    type: payload.kind,
    doctype: "__NotificationRules",
    documentName: "Note:Managers on updates",
    actorId: "admin@example.com",
    occurredAt: now,
    payload,
    metadata
  };
}

function documentEvent(id: string, kind: "DocumentUpdated" | "DocumentSubmitted"): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Note:My Note",
    sequence: 2,
    type: kind === "DocumentUpdated" ? "NoteUpdated" : "NoteSubmitted",
    doctype: "Note",
    documentName: "My Note",
    actorId: owner.id,
    occurredAt: now,
    payload: kind === "DocumentUpdated" ? { kind, patch: { body: "Updated" } } : { kind },
    metadata: {}
  };
}

function noteSnapshot(data: Record<string, string>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "My Note",
    version: 2,
    docstatus: "draft",
    data: {
      title: "My Note",
      priority: "Medium",
      ...data
    },
    createdAt: now,
    updatedAt: now
  };
}
