import {
  assignmentRuleClearedPayload,
  assignmentRuleDocumentName,
  assignmentRuleEnabledPayload,
  assignmentRuleEvent,
  assignmentRuleEventType,
  assignmentRuleEventsVisibleAt,
  assignmentRuleNameForPayload,
  assignmentRuleSavedPayload,
  ASSIGNMENT_RULE_PAYLOAD_KINDS,
  foldAssignmentRules,
  replayAssignmentRuleAppend
} from "../../src";
import type { AssignmentRuleDefinition, AssignmentRuleEventPayload, DomainEvent } from "../../src";

const admin = {
  id: "admin@example.com",
  roles: ["System Manager", "User"],
  tenantId: "acme"
};

const rule: AssignmentRuleDefinition = {
  name: "High priority triage",
  events: ["DocumentCreated"],
  assignees: [{ kind: "user", userId: "manager@example.com" }]
};

describe("assignment rule events", () => {
  it("derives assignment rule event types from payload identity", () => {
    expect(assignmentRuleEventType({
      kind: "AssignmentRuleSaved",
      doctypeName: "Ticket",
      rule
    })).toBe("AssignmentRuleSaved");
    expect(assignmentRuleEventType({
      kind: "AssignmentRuleCleared",
      doctypeName: "Ticket",
      ruleName: "High priority triage"
    })).toBe("AssignmentRuleCleared");
  });

  it("builds saved assignment rule payloads", () => {
    expect(assignmentRulePayload(assignmentRuleSavedPayload({
      doctypeName: "Ticket",
      rule
    }))).toEqual({
      kind: "AssignmentRuleSaved",
      doctypeName: "Ticket",
      rule
    });
  });

  it("builds cleared assignment rule payloads", () => {
    expect(assignmentRulePayload(assignmentRuleClearedPayload({
      doctypeName: "Ticket",
      ruleName: "High priority triage"
    }))).toEqual({
      kind: "AssignmentRuleCleared",
      doctypeName: "Ticket",
      ruleName: "High priority triage"
    });
  });

  it("builds saved assignment rule payloads with enabled overrides", () => {
    expect(assignmentRulePayload(assignmentRuleEnabledPayload({
      doctypeName: "Ticket",
      rule,
      enabled: false
    }))).toEqual({
      kind: "AssignmentRuleSaved",
      doctypeName: "Ticket",
      rule: { ...rule, enabled: false }
    });
  });

  it("creates typed assignment rule events from payload identity", () => {
    expect(assignmentRuleEvent({
      id: "evt_rule",
      tenantId: "acme",
      stream: "acme:__AssignmentRules",
      actor: admin,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: {
        kind: "AssignmentRuleSaved",
        doctypeName: "Ticket",
        rule
      }
    })).toMatchObject({
      id: "evt_rule",
      type: "AssignmentRuleSaved",
      doctype: "__AssignmentRules",
      documentName: "Ticket:High priority triage",
      actorId: admin.id,
      payload: { kind: "AssignmentRuleSaved", doctypeName: "Ticket" },
      metadata: {}
    });
  });

  it("derives document and rule names from saved and cleared payloads", () => {
    const savedPayload = { kind: "AssignmentRuleSaved" as const, doctypeName: "Ticket", rule };
    const clearedPayload = {
      kind: "AssignmentRuleCleared" as const,
      doctypeName: "Ticket",
      ruleName: "High priority triage"
    };

    expect(assignmentRuleNameForPayload(savedPayload)).toBe("High priority triage");
    expect(assignmentRuleNameForPayload(clearedPayload)).toBe("High priority triage");
    expect(assignmentRuleDocumentName(clearedPayload)).toBe("Ticket:High priority triage");
  });

  it("replays appended events against the previous stream prefix", () => {
    const previous = [savedEvent(1, rule)];
    const state = foldAssignmentRules("acme", "Ticket", previous);
    const replayed = replayAssignmentRuleAppend(state, previous, [clearedEvent(2)]);

    expect(replayed).toMatchObject({ tenantId: "acme", doctypeName: "Ticket", version: 2, rules: [] });
  });

  it("filters assignment rule events by occurrence time for delivery-time reads", () => {
    const events = [
      savedEvent(1, rule, "2026-01-01T00:00:00.000Z"),
      clearedEvent(2, "2026-01-01T00:05:00.000Z")
    ];

    expect(assignmentRuleEventsVisibleAt(events, "2026-01-01T00:01:00.000Z").map((event) => event.sequence)).toEqual([1]);
    expect(assignmentRuleEventsVisibleAt(events, undefined).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("exposes the bounded assignment rule payload kind set", () => {
    expect(ASSIGNMENT_RULE_PAYLOAD_KINDS).toEqual([
      "AssignmentRuleSaved",
      "AssignmentRuleCleared"
    ]);
  });
});

function assignmentRulePayload(payload: AssignmentRuleEventPayload): AssignmentRuleEventPayload {
  return payload;
}

function savedEvent(
  sequence: number,
  definition: AssignmentRuleDefinition,
  occurredAt = "2026-01-01T00:00:00.000Z"
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__AssignmentRules",
    sequence,
    type: "AssignmentRuleSaved",
    doctype: "__AssignmentRules",
    documentName: "Ticket:High priority triage",
    actorId: admin.id,
    occurredAt,
    payload: {
      kind: "AssignmentRuleSaved",
      doctypeName: "Ticket",
      rule: definition
    },
    metadata: {}
  };
}

function clearedEvent(sequence: number, occurredAt = "2026-01-01T00:05:00.000Z"): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__AssignmentRules",
    sequence,
    type: "AssignmentRuleCleared",
    doctype: "__AssignmentRules",
    documentName: "Ticket:High priority triage",
    actorId: admin.id,
    occurredAt,
    payload: {
      kind: "AssignmentRuleCleared",
      doctypeName: "Ticket",
      ruleName: "High priority triage"
    },
    metadata: {}
  };
}
