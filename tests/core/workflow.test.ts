import {
  allowedWorkflowTransitions,
  applyWorkflowDefinitionToDocType,
  currentWorkflowState,
  defineDocType,
  foldWorkflowDefinition,
  normalizeWorkflowDefinition,
  workflowDefinitionsStream
} from "../../src";
import type { DocumentSnapshot, DomainEvent, DocumentEventPayload, WorkflowDefinition } from "../../src";

const workflow: WorkflowDefinition = {
  stateField: "state",
  initialState: "Open",
  states: ["Open", "Review", "Closed"],
  transitions: [
    { action: "review", from: "Open", to: "Review", roles: ["Reviewer"] },
    { action: "close", from: "Review", to: "Closed", roles: ["Closer"] },
    { action: "skip", from: "Open", to: "Closed" }
  ]
};

const document: DocumentSnapshot = {
  tenantId: "acme",
  doctype: "Task",
  name: "TASK-1",
  version: 1,
  docstatus: "draft",
  data: { state: "Open" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("workflow helpers", () => {
  it("selects role-allowed transitions for the current workflow state", () => {
    expect(currentWorkflowState(workflow, document)).toBe("Open");
    expect(
      allowedWorkflowTransitions({
        actor: { id: "reviewer@example.com", roles: ["Reviewer"], tenantId: "acme" },
        workflow,
        document
      }).map((transition) => transition.action)
    ).toEqual(["review", "skip"]);
  });

  it("falls back to the initial workflow state when the document has no state field", () => {
    expect(currentWorkflowState(workflow, { ...document, data: {} })).toBe("Open");
  });

  it("folds saved and cleared workflow definition events into an override state", () => {
    const doctype = defineDocType({
      name: "Workflow Note",
      fields: [{ name: "workflow_state", type: "select" }],
      workflow
    });
    const override: WorkflowDefinition = {
      initialState: "Open",
      states: ["Open", "Approved"],
      transitions: [{ action: "approve", from: "Open", to: "Approved", roles: ["Approver"] }]
    };
    const saved = workflowDefinitionEvent(1, {
      kind: "WorkflowDefinitionSaved",
      doctypeName: "Workflow Note",
      workflow: override
    });
    const cleared = workflowDefinitionEvent(2, {
      kind: "WorkflowDefinitionCleared",
      doctypeName: "Workflow Note"
    });

    const savedState = foldWorkflowDefinition("acme", "Workflow Note", [saved]);
    const clearedState = foldWorkflowDefinition("acme", "Workflow Note", [saved, cleared]);

    expect(savedState).toMatchObject({ tenantId: "acme", doctypeName: "Workflow Note", version: 1, workflow: override });
    expect(applyWorkflowDefinitionToDocType(doctype, savedState).workflow).toEqual(override);
    expect(clearedState).toMatchObject({ tenantId: "acme", doctypeName: "Workflow Note", version: 2 });
    expect(clearedState.workflow).toBeUndefined();
    expect(applyWorkflowDefinitionToDocType(doctype, clearedState).workflow).toEqual(workflow);
  });

  it("normalizes workflow definitions and rejects malformed transitions", () => {
    const doctype = defineDocType({
      name: "Workflow Note",
      fields: [{ name: "workflow_state", type: "select", options: ["Open", "Approved"] }]
    });

    expect(
      normalizeWorkflowDefinition(doctype, {
        stateField: " workflow_state ",
        initialState: " Open ",
        states: [" Open ", "Approved"],
        transitions: [
          {
            action: " approve ",
            from: " Open ",
            to: " Approved ",
            roles: [" Approver "],
            eventType: " NoteApproved "
          }
        ]
      })
    ).toEqual({
      initialState: "Open",
      states: ["Open", "Approved"],
      transitions: [
        { action: "approve", from: "Open", to: "Approved", roles: ["Approver"], eventType: "NoteApproved" }
      ]
    });

    expect(() =>
      normalizeWorkflowDefinition(doctype, {
        initialState: "Open",
        states: ["Open", "Open"],
        transitions: [{ action: "approve", from: "Open", to: "Approved" }]
      })
    ).toThrow("Workflow states contains duplicate 'Open'");
    expect(() =>
      normalizeWorkflowDefinition(doctype, {
        stateField: "missing_state",
        initialState: "Open",
        states: ["Open", "Approved"],
        transitions: [{ action: "approve", from: "Open", to: "Approved" }]
      })
    ).toThrow("Workflow state field 'missing_state' is not defined on Workflow Note");
    expect(() =>
      normalizeWorkflowDefinition(doctype, {
        initialState: "Open",
        states: ["Open"],
        transitions: [{ action: "approve", from: "Open", to: "Approved" }]
      })
    ).toThrow("Workflow transition 1 to state 'Approved' is not listed in states");
    expect(() =>
      normalizeWorkflowDefinition(doctype, {
        initialState: "Open",
        states: ["Open", "Approved"],
        transitions: [
          { action: "approve", from: "Open", to: "Approved" },
          { action: "approve", from: "Open", to: "Open" }
        ]
      })
    ).toThrow("Workflow transition action 'approve' is duplicated for state 'Open'");
  });

  it("rejects workflow states that the state field cannot store", () => {
    const numericState = defineDocType({
      name: "Numeric Workflow Note",
      fields: [{ name: "workflow_state", type: "integer" }]
    });
    const narrowSelectState = defineDocType({
      name: "Narrow Workflow Note",
      fields: [{ name: "workflow_state", type: "select", options: ["Open"] }]
    });

    expect(() =>
      normalizeWorkflowDefinition(numericState, {
        initialState: "Open",
        states: ["Open", "Closed"],
        transitions: [{ action: "close", from: "Open", to: "Closed" }]
      })
    ).toThrow("Workflow state field 'workflow_state' must be a string-compatible field");
    expect(() =>
      normalizeWorkflowDefinition(narrowSelectState, {
        initialState: "Open",
        states: ["Open", "Closed"],
        transitions: [{ action: "close", from: "Open", to: "Closed" }]
      })
    ).toThrow("Workflow state field 'workflow_state' options must include 'Closed'");
  });
});

function workflowDefinitionEvent(
  sequence: number,
  payload: Extract<DocumentEventPayload, { readonly kind: "WorkflowDefinitionSaved" | "WorkflowDefinitionCleared" }>
): DomainEvent {
  return {
    id: `evt-${sequence}`,
    tenantId: "acme",
    stream: workflowDefinitionsStream("acme"),
    sequence,
    type: payload.kind,
    doctype: "__Workflows",
    documentName: payload.doctypeName,
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
