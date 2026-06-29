import { describe, expect, it } from "vitest";

import {
  DOCUMENT_COMMAND_PAYLOAD_KINDS,
  domainCommandAppliedPayload,
  workflowTransitionEventType,
  workflowTransitionedPayload,
  type DocumentCommandEventPayload
} from "../../src";

describe("document command events", () => {
  it("builds workflow transition payloads", () => {
    expect(
      commandPayload(
        workflowTransitionedPayload({
          action: "close",
          from: "Open",
          to: "Closed",
          patch: { workflow_state: "Closed" }
        })
      )
    ).toEqual({
      kind: "WorkflowTransitioned",
      action: "close",
      from: "Open",
      to: "Closed",
      patch: { workflow_state: "Closed" }
    });
  });

  it("builds domain command payloads", () => {
    expect(
      commandPayload(
        domainCommandAppliedPayload({
          command: "approve",
          input: { comment: "ok" },
          patch: { status: "Approved" }
        })
      )
    ).toEqual({
      kind: "DomainCommandApplied",
      command: "approve",
      input: { comment: "ok" },
      patch: { status: "Approved" }
    });
  });

  it("derives workflow transition event types", () => {
    expect(workflowTransitionEventType({
      doctypeName: "Note",
      action: "close"
    })).toBe("NoteClose");
    expect(workflowTransitionEventType({
      doctypeName: "Expense Claim",
      action: "approve",
      transitionEventType: "ExpenseApproved"
    })).toBe("ExpenseApproved");
  });

  it("exposes the bounded document command payload kind set", () => {
    expect(DOCUMENT_COMMAND_PAYLOAD_KINDS).toEqual([
      "WorkflowTransitioned",
      "DomainCommandApplied"
    ]);
  });
});

function commandPayload(payload: DocumentCommandEventPayload): DocumentCommandEventPayload {
  return payload;
}
