import {
  foldNotificationRules,
  normalizeNotificationRule,
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
      }),
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
});

function ruleEvent(
  sequence: number,
  id: string,
  payload: Extract<DomainEvent["payload"], { readonly kind: "NotificationRuleSaved" | "NotificationRuleCleared" }>
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
    metadata: {}
  };
}

function documentEvent(id: string, kind: "DocumentUpdated"): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Note:My Note",
    sequence: 2,
    type: "NoteUpdated",
    doctype: "Note",
    documentName: "My Note",
    actorId: owner.id,
    occurredAt: now,
    payload: { kind, patch: { body: "Updated" } },
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
