import {
  foldWorkflowDefinition,
  replayWorkflowDefinitionAppend,
  WORKFLOW_DEFINITION_PAYLOAD_KINDS,
  workflowDefinitionClearedPayload,
  workflowDefinitionEvent,
  workflowDefinitionEventType,
  workflowDefinitionSavedPayload,
  workflowEventsVisibleAt
} from "../../src";
import type { WorkflowEventPayload } from "../../src";
import type { DomainEvent, WorkflowDefinition } from "../../src";

const admin = {
  id: "admin@example.com",
  roles: ["System Manager", "User"],
  tenantId: "acme"
};

const workflow: WorkflowDefinition = {
  initialState: "Open",
  states: ["Open", "Closed"],
  transitions: [{ action: "approve", from: "Open", to: "Closed", roles: ["User"], eventType: "NoteApproved" }]
};

describe("workflow events", () => {
  it("derives workflow definition event types from payload identity", () => {
    expect(workflowDefinitionEventType({
      kind: "WorkflowDefinitionSaved",
      doctypeName: "Note",
      workflow
    })).toBe("WorkflowDefinitionSaved");
    expect(workflowDefinitionEventType({
      kind: "WorkflowDefinitionCleared",
      doctypeName: "Note"
    })).toBe("WorkflowDefinitionCleared");
  });

  it("builds saved workflow definition payloads", () => {
    expect(workflowPayload(workflowDefinitionSavedPayload({
      doctypeName: "Note",
      workflow
    }))).toEqual({
      kind: "WorkflowDefinitionSaved",
      doctypeName: "Note",
      workflow
    });
  });

  it("builds cleared workflow definition payloads", () => {
    expect(workflowPayload(workflowDefinitionClearedPayload({ doctypeName: "Note" }))).toEqual({
      kind: "WorkflowDefinitionCleared",
      doctypeName: "Note"
    });
  });

  it("creates typed workflow definition events from payload identity", () => {
    expect(workflowDefinitionEvent({
      id: "evt_workflow",
      tenantId: "acme",
      stream: "acme:__WorkflowDefinitions",
      actor: admin,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: {
        kind: "WorkflowDefinitionSaved",
        doctypeName: "Note",
        workflow
      }
    })).toMatchObject({
      id: "evt_workflow",
      type: "WorkflowDefinitionSaved",
      doctype: "__Workflows",
      documentName: "Note",
      actorId: admin.id,
      payload: { kind: "WorkflowDefinitionSaved", doctypeName: "Note" },
      metadata: {}
    });
  });

  it("replays appended events against the previous stream prefix", () => {
    const previous = [savedEvent(1, workflow)];
    const state = foldWorkflowDefinition("acme", "Note", previous);
    const replayed = replayWorkflowDefinitionAppend(state, previous, [clearedEvent(2)]);

    expect(replayed).toMatchObject({ tenantId: "acme", doctypeName: "Note", version: 2 });
    expect(replayed.workflow).toBeUndefined();
  });

  it("filters workflow events by occurrence time for temporal reads", () => {
    const events = [
      savedEvent(1, workflow, "2026-01-01T00:00:00.000Z"),
      clearedEvent(2, "2026-01-01T00:05:00.000Z")
    ];

    expect(workflowEventsVisibleAt(events, "2026-01-01T00:01:00.000Z").map((event) => event.sequence)).toEqual([1]);
    expect(workflowEventsVisibleAt(events, undefined).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("exposes the bounded workflow payload kind set", () => {
    expect(WORKFLOW_DEFINITION_PAYLOAD_KINDS).toEqual([
      "WorkflowDefinitionSaved",
      "WorkflowDefinitionCleared"
    ]);
  });
});

function workflowPayload(payload: WorkflowEventPayload): WorkflowEventPayload {
  return payload;
}

function savedEvent(
  sequence: number,
  definition: WorkflowDefinition,
  occurredAt = "2026-01-01T00:00:00.000Z"
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__WorkflowDefinitions",
    sequence,
    type: "WorkflowDefinitionSaved",
    doctype: "__Workflows",
    documentName: "Note",
    actorId: admin.id,
    occurredAt,
    payload: {
      kind: "WorkflowDefinitionSaved",
      doctypeName: "Note",
      workflow: definition
    },
    metadata: {}
  };
}

function clearedEvent(sequence: number, occurredAt = "2026-01-01T00:05:00.000Z"): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__WorkflowDefinitions",
    sequence,
    type: "WorkflowDefinitionCleared",
    doctype: "__Workflows",
    documentName: "Note",
    actorId: admin.id,
    occurredAt,
    payload: {
      kind: "WorkflowDefinitionCleared",
      doctypeName: "Note"
    },
    metadata: {}
  };
}
