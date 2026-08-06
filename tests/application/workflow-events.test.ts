import { describe, expect, it } from "vitest";

import {
  NAMED_WORKFLOW_PAYLOAD_KINDS,
  foldNamedWorkflowDefinition,
  isNamedWorkflowEvent,
  isNamedWorkflowPayloadKind,
  namedWorkflowClearedPayload,
  namedWorkflowDefinitionEvent,
  namedWorkflowDefinitionEventType,
  namedWorkflowEventsVisibleAt,
  namedWorkflowSavedPayload,
  namedWorkflowStream,
  replayNamedWorkflowAppend,
  type DomainEvent,
  type NamedWorkflowDefinition
} from "../../src";

const workflow: NamedWorkflowDefinition = {
  name: "review",
  stateField: "review_state",
  initialState: "Pending",
  states: ["Pending", "Approved"],
  transitions: [{ action: "approve", from: "Pending", to: "Approved" }]
};

describe("named workflow events", () => {
  it("builds workflow-qualified saved and cleared payloads", () => {
    expect(namedWorkflowSavedPayload({ doctypeName: "Task", workflow })).toEqual({
      kind: "NamedWorkflowSaved",
      doctypeName: "Task",
      workflowName: "review",
      workflow
    });
    expect(namedWorkflowClearedPayload({ doctypeName: "Task", workflowName: "review" })).toEqual({
      kind: "NamedWorkflowCleared",
      doctypeName: "Task",
      workflowName: "review"
    });
  });

  it("builds resource-local domain events and narrows by payload kind", () => {
    const payload = namedWorkflowSavedPayload({ doctypeName: "Task", workflow });
    const event = namedWorkflowDefinitionEvent({
      id: "evt-1",
      tenantId: "acme",
      stream: namedWorkflowStream("acme", "Task", "review"),
      actor: { id: "admin", roles: ["System Manager"] },
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload,
      metadata: { source: "test" }
    });

    expect(event).toMatchObject({
      type: "NamedWorkflowSaved",
      doctype: "__NamedWorkflows",
      documentName: "Task:review",
      payload,
      metadata: { source: "test" }
    });
    expect(namedWorkflowDefinitionEventType(payload)).toBe("NamedWorkflowSaved");
    expect(isNamedWorkflowEvent({ ...event, sequence: 1 })).toBe(true);
    expect(isNamedWorkflowEvent(otherEvent())).toBe(false);
  });

  it("exposes only the new event contract", () => {
    expect(NAMED_WORKFLOW_PAYLOAD_KINDS).toEqual(["NamedWorkflowSaved", "NamedWorkflowCleared"]);
    expect(isNamedWorkflowPayloadKind("NamedWorkflowCleared")).toBe(true);
    expect(isNamedWorkflowPayloadKind("WorkflowDefinitionCleared")).toBe(false);
  });

  it("filters history by time and replays appended events", () => {
    const saved = savedEvent(1, "2026-01-01T00:00:00.000Z");
    const cleared = clearedEvent(2, "2026-01-02T00:00:00.000Z");
    const state = foldNamedWorkflowDefinition("acme", "Task", "review", [saved]);

    expect(namedWorkflowEventsVisibleAt([saved, cleared], undefined)).toEqual([saved, cleared]);
    expect(namedWorkflowEventsVisibleAt([saved, cleared], "2026-01-01T12:00:00.000Z")).toEqual([saved]);
    expect(replayNamedWorkflowAppend(state, [saved], [cleared])).toMatchObject({
      workflowName: "review",
      version: 2,
      cleared: true
    });
  });
});

function savedEvent(sequence: number, occurredAt: string): DomainEvent {
  return {
    ...namedWorkflowDefinitionEvent({
      id: `evt-${String(sequence)}`,
      tenantId: "acme",
      stream: namedWorkflowStream("acme", "Task", "review"),
      actor: { id: "admin", roles: ["System Manager"] },
      occurredAt,
      payload: namedWorkflowSavedPayload({ doctypeName: "Task", workflow })
    }),
    sequence
  };
}

function clearedEvent(sequence: number, occurredAt: string): DomainEvent {
  return {
    ...namedWorkflowDefinitionEvent({
      id: `evt-${String(sequence)}`,
      tenantId: "acme",
      stream: namedWorkflowStream("acme", "Task", "review"),
      actor: { id: "admin", roles: ["System Manager"] },
      occurredAt,
      payload: namedWorkflowClearedPayload({ doctypeName: "Task", workflowName: "review" })
    }),
    sequence
  };
}

function otherEvent(): DomainEvent {
  return {
    id: "evt-other",
    tenantId: "acme",
    stream: "acme:Task:TASK-1",
    sequence: 1,
    type: "DocumentDeleted",
    doctype: "Task",
    documentName: "TASK-1",
    actorId: "admin",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentDeleted" },
    metadata: {}
  };
}
