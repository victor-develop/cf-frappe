import { allowedWorkflowTransitions, currentWorkflowState } from "../../src";
import type { DocumentSnapshot, WorkflowDefinition } from "../../src";

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
});

