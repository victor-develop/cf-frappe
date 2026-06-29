import {
  foldNotificationRules,
  notificationRuleClearedPayload,
  notificationRuleDocumentName,
  notificationRuleEvent,
  notificationRuleEventType,
  notificationRuleEventsVisibleAt,
  notificationRuleNameForPayload,
  notificationRuleSavedPayload,
  NOTIFICATION_RULE_PAYLOAD_KINDS,
  isNotificationRuleEvent,
  isNotificationRulePayloadKind,
  replayNotificationRuleAppend
} from "../../src";
import type { DomainEvent, NotificationRuleDefinition, NotificationRuleEventPayload } from "../../src";

const admin = {
  id: "admin@example.com",
  roles: ["System Manager", "User"],
  tenantId: "acme"
};

const rule: NotificationRuleDefinition = {
  name: "Managers on updates",
  events: ["DocumentUpdated"],
  recipients: [{ kind: "user", userId: "manager@example.com" }]
};

describe("notification rule events", () => {
  it("derives notification rule event types from payload identity", () => {
    expect(notificationRuleEventType({
      kind: "NotificationRuleSaved",
      doctypeName: "Note",
      rule
    })).toBe("NotificationRuleSaved");
    expect(notificationRuleEventType({
      kind: "NotificationRuleCleared",
      doctypeName: "Note",
      ruleName: "Managers on updates"
    })).toBe("NotificationRuleCleared");
  });

  it("builds saved notification rule payloads", () => {
    expect(notificationRulePayload(notificationRuleSavedPayload({
      doctypeName: "Note",
      rule
    }))).toEqual({
      kind: "NotificationRuleSaved",
      doctypeName: "Note",
      rule
    });
  });

  it("builds cleared notification rule payloads", () => {
    expect(notificationRulePayload(notificationRuleClearedPayload({
      doctypeName: "Note",
      ruleName: "Managers on updates"
    }))).toEqual({
      kind: "NotificationRuleCleared",
      doctypeName: "Note",
      ruleName: "Managers on updates"
    });
  });

  it("creates typed notification rule events from payload identity", () => {
    expect(notificationRuleEvent({
      id: "evt_rule",
      tenantId: "acme",
      stream: "acme:__NotificationRules",
      actor: admin,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: {
        kind: "NotificationRuleSaved",
        doctypeName: "Note",
        rule
      }
    })).toMatchObject({
      id: "evt_rule",
      type: "NotificationRuleSaved",
      doctype: "__NotificationRules",
      documentName: "Note:Managers on updates",
      actorId: admin.id,
      payload: { kind: "NotificationRuleSaved", doctypeName: "Note" },
      metadata: {}
    });
  });

  it("derives document and rule names from saved and cleared payloads", () => {
    const savedPayload = { kind: "NotificationRuleSaved" as const, doctypeName: "Note", rule };
    const clearedPayload = {
      kind: "NotificationRuleCleared" as const,
      doctypeName: "Note",
      ruleName: "Managers on updates"
    };

    expect(notificationRuleNameForPayload(savedPayload)).toBe("Managers on updates");
    expect(notificationRuleNameForPayload(clearedPayload)).toBe("Managers on updates");
    expect(notificationRuleDocumentName(clearedPayload)).toBe("Note:Managers on updates");
  });

  it("replays appended events against the previous stream prefix", () => {
    const previous = [savedEvent(1, rule)];
    const state = foldNotificationRules("acme", "Note", previous);
    const replayed = replayNotificationRuleAppend(state, previous, [clearedEvent(2)]);

    expect(replayed).toMatchObject({ tenantId: "acme", doctypeName: "Note", version: 2, rules: [] });
  });

  it("filters notification rule events by occurrence time for delivery-time reads", () => {
    const events = [
      savedEvent(1, rule, "2026-01-01T00:00:00.000Z"),
      clearedEvent(2, "2026-01-01T00:05:00.000Z")
    ];

    expect(notificationRuleEventsVisibleAt(events, "2026-01-01T00:01:00.000Z").map((event) => event.sequence)).toEqual([1]);
    expect(notificationRuleEventsVisibleAt(events, undefined).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("exposes the bounded notification rule payload kind set", () => {
    expect(NOTIFICATION_RULE_PAYLOAD_KINDS).toEqual([
      "NotificationRuleSaved",
      "NotificationRuleCleared"
    ]);
  });

  it("narrows notification rule events by payload kind when event type names are custom", () => {
    const saved = {
      ...savedEvent(1, rule),
      type: "NoteNotificationConfigured"
    };

    expect(isNotificationRulePayloadKind("NotificationRuleSaved")).toBe(true);
    expect(isNotificationRulePayloadKind("DocumentDeleted")).toBe(false);
    expect(isNotificationRuleEvent(saved)).toBe(true);
    expect(isNotificationRuleEvent(otherEvent({ kind: "DocumentDeleted" }))).toBe(false);
  });
});

function notificationRulePayload(payload: NotificationRuleEventPayload): NotificationRuleEventPayload {
  return payload;
}

function otherEvent(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_other",
    tenantId: "acme",
    stream: "acme:Note:NOTE-1",
    sequence: 1,
    type,
    doctype: "Note",
    documentName: "NOTE-1",
    actorId: admin.id,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}

function savedEvent(
  sequence: number,
  definition: NotificationRuleDefinition,
  occurredAt = "2026-01-01T00:00:00.000Z"
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__NotificationRules",
    sequence,
    type: "NotificationRuleSaved",
    doctype: "__NotificationRules",
    documentName: "Note:Managers on updates",
    actorId: admin.id,
    occurredAt,
    payload: {
      kind: "NotificationRuleSaved",
      doctypeName: "Note",
      rule: definition
    },
    metadata: {}
  };
}

function clearedEvent(sequence: number, occurredAt = "2026-01-01T00:05:00.000Z"): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__NotificationRules",
    sequence,
    type: "NotificationRuleCleared",
    doctype: "__NotificationRules",
    documentName: "Note:Managers on updates",
    actorId: admin.id,
    occurredAt,
    payload: {
      kind: "NotificationRuleCleared",
      doctypeName: "Note",
      ruleName: "Managers on updates"
    },
    metadata: {}
  };
}
