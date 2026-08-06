import { describe, expect, it } from "vitest";

import {
  domainEventWorkflowIdentity,
  isCurrentWorkflowTransitionPayload
} from "../../src/core/domain-events.js";
import type { DomainEvent } from "../../src/core/types.js";

describe("domain event workflow identity", () => {
  it("projects no identity, one transition identity, and composite transition identity", () => {
    const lifecycle = {
      workflow: "lifecycle",
      stateField: "lifecycle_state",
      action: "finish",
      from: "Open",
      to: "Done"
    };
    const review = {
      workflow: "review",
      stateField: "review_state",
      action: "approve",
      from: "Pending",
      to: "Approved"
    };

    expect(domainEventWorkflowIdentity(event({ kind: "DocumentUpdated", patch: {} }))).toEqual({});
    expect(domainEventWorkflowIdentity(event({
      kind: "WorkflowTransitioned",
      ...lifecycle,
      patch: { lifecycle_state: "Done" }
    }))).toEqual({
      workflowName: "lifecycle",
      workflowAction: "finish",
      workflowTransitions: [lifecycle]
    });
    expect(domainEventWorkflowIdentity(event({
      kind: "DomainCommandApplied",
      command: "noop",
      input: {},
      patch: {},
      transitions: []
    }))).toEqual({});
    expect(domainEventWorkflowIdentity(event({
      kind: "DomainCommandApplied",
      command: "finish",
      input: {},
      patch: {},
      transitions: [lifecycle]
    }))).toEqual({
      workflowName: "lifecycle",
      workflowAction: "finish",
      workflowTransitions: [lifecycle]
    });
    expect(domainEventWorkflowIdentity(event({
      kind: "DomainCommandApplied",
      command: "release",
      input: {},
      patch: {},
      transitions: [lifecycle, review]
    }))).toEqual({ workflowTransitions: [lifecycle, review] });
  });

  it("rejects pre-cutover workflow payload identity", () => {
    const legacy = {
      kind: "WorkflowTransitioned",
      action: "finish",
      from: "Open",
      to: "Done",
      patch: { lifecycle_state: "Done" }
    };

    expect(isCurrentWorkflowTransitionPayload(legacy)).toBe(false);
    expect(domainEventWorkflowIdentity(event(legacy as never))).toEqual({});
    expect(isCurrentWorkflowTransitionPayload({
      ...legacy,
      workflow: "lifecycle",
      stateField: "lifecycle_state"
    })).toBe(true);
  });
});

function event(payload: DomainEvent["payload"]): DomainEvent {
  return {
    id: "evt-1",
    tenantId: "acme",
    stream: "acme:Task:TASK-1",
    sequence: 1,
    type: payload.kind,
    doctype: "Task",
    documentName: "TASK-1",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
