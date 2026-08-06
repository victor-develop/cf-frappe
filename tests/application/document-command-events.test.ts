import { describe, expect, it } from "vitest";

import {
  DOCUMENT_COMMAND_PAYLOAD_KINDS,
  domainCommandAppliedPayload,
  isDocumentCommandEvent,
  isDocumentCommandPayloadKind,
  workflowTransitionEventType,
  workflowTransitionedPayload,
  type DocumentCommandEventPayload
} from "../../src";
import type { DomainEvent } from "../../src";

describe("document command events", () => {
  it("builds workflow transition payloads", () => {
    expect(
      commandPayload(
        workflowTransitionedPayload({
          workflow: "lifecycle",
          stateField: "workflow_state",
          action: "close",
          from: "Open",
          to: "Closed",
          patch: { workflow_state: "Closed" }
        })
      )
    ).toEqual({
      kind: "WorkflowTransitioned",
      workflow: "lifecycle",
      stateField: "workflow_state",
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
      patch: { status: "Approved" },
      transitions: []
    });
  });

  it("derives workflow transition event types", () => {
    expect(workflowTransitionEventType({
      doctypeName: "Note",
      workflow: "lifecycle",
      action: "close"
    })).toBe("NoteLifecycleClose");
    expect(workflowTransitionEventType({
      doctypeName: "Expense Claim",
      workflow: "approval",
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

  it("narrows document command events by payload kind when event type names are custom", () => {
    const transitioned = event(
      workflowTransitionedPayload({
        workflow: "approval",
        stateField: "workflow_state",
        action: "approve",
        from: "Open",
        to: "Approved",
        patch: { workflow_state: "Approved" }
      }),
      "ExpenseApproved"
    );

    expect(isDocumentCommandPayloadKind("WorkflowTransitioned")).toBe(true);
    expect(isDocumentCommandPayloadKind("DocumentDeleted")).toBe(false);
    expect(isDocumentCommandEvent(transitioned)).toBe(true);
    expect(isDocumentCommandEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });
});

function commandPayload(payload: DocumentCommandEventPayload): DocumentCommandEventPayload {
  return payload;
}

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_command",
    tenantId: "acme",
    stream: "acme:Expense%20Claim:EXP-1",
    sequence: 1,
    type,
    doctype: "Expense Claim",
    documentName: "EXP-1",
    actorId: "approver@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
