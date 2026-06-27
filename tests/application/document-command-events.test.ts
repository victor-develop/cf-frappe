import { describe, expect, it } from "vitest";

import {
  domainCommandAppliedPayload,
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
});

function commandPayload(payload: DocumentCommandEventPayload): DocumentCommandEventPayload {
  return payload;
}
