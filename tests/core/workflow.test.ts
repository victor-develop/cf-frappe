import { describe, expect, it } from "vitest";

import {
  allowedWorkflowTransitions,
  applyNamedWorkflowDefinitionToDocType,
  compileWorkflowTransitionPolicies,
  defineDocType,
  evaluateNamedWorkflowTransition,
  foldNamedWorkflowDefinition,
  isNamedWorkflowStatePayloadKind,
  isWorkflowStateField,
  namedWorkflowByName,
  namedWorkflowStateEventType,
  namedWorkflowStream,
  normalizeNamedWorkflowDefinition,
  normalizeNamedWorkflows,
  workflowStateFieldNames,
  type DocumentSnapshot,
  type DomainEvent,
  type NamedWorkflowDefinition,
  type NamedWorkflowStateEventPayload
} from "../../src";
import { beforeField } from "../predicate-fixtures.js";

const base = defineDocType({
  name: "Task",
  fields: [
    { name: "lifecycle_state", type: "select", options: ["Open", "Done"] },
    { name: "review_state", type: "select", options: ["Pending", "Approved"] },
    { name: "count", type: "integer" }
  ]
});

const lifecycle: NamedWorkflowDefinition = {
  name: "lifecycle",
  label: "Lifecycle",
  stateField: "lifecycle_state",
  initialState: "Open",
  states: ["Open", "Done"],
  transitions: [{ action: "finish", from: "Open", to: "Done", roles: ["User"] }]
};

const review: NamedWorkflowDefinition = {
  name: "review",
  stateField: "review_state",
  initialState: "Pending",
  states: ["Pending", "Approved"],
  transitions: [{
    action: "approve",
    from: "Pending",
    to: "Approved",
    roles: ["Reviewer"],
    allowWhen: beforeField("lifecycle_state", "Done"),
    eventType: "TaskApproved"
  }]
};

describe("named workflows", () => {
  it("normalizes, freezes, resolves, and compiles multiple workflow dimensions", () => {
    const workflows = normalizeNamedWorkflows(base, [lifecycle, review])!;
    const doctype = Object.freeze({ ...base, workflows });

    expect(workflows).toEqual([lifecycle, review]);
    expect(Object.isFrozen(workflows)).toBe(true);
    expect(Object.isFrozen(workflows?.[1]?.transitions[0]?.allowWhen)).toBe(true);
    expect(namedWorkflowByName(doctype, "review")?.stateField).toBe("review_state");
    expect(workflowStateFieldNames(doctype)).toEqual(["lifecycle_state", "review_state"]);
    expect(compileWorkflowTransitionPolicies(review)).toEqual([{
      name: "review.approve",
      field: "review_state",
      action: "approve",
      from: "Pending",
      to: "Approved",
      roles: ["Reviewer"],
      allowWhen: review.transitions[0]?.allowWhen,
      eventType: "TaskApproved"
    }]);
  });

  it("rejects duplicate workflow names and state-field ownership", () => {
    expect(() => normalizeNamedWorkflows(base, [lifecycle, { ...review, name: "lifecycle" }]))
      .toThrow("Workflow name 'lifecycle' is duplicated");
    expect(() => normalizeNamedWorkflows(base, [lifecycle, {
      ...lifecycle,
      name: "review",
      label: "Review"
    }]))
      .toThrow("is owned by more than one workflow");
  });

  it("rejects invalid definitions without legacy defaults", () => {
    expect(() => normalizeNamedWorkflows(base, {} as never)).toThrow("must be an array");
    expect(() => normalizeNamedWorkflowDefinition(base, null as never)).toThrow("must be an object");
    expect(() => normalizeNamedWorkflowDefinition(base, { ...lifecycle, transitions: {} as never }))
      .toThrow("transitions must be an array");
    expect(() => normalizeNamedWorkflowDefinition(base, { ...lifecycle, name: "bad name" }))
      .toThrow("stable identifier");
    expect(() => normalizeNamedWorkflowDefinition(base, { ...lifecycle, stateField: "missing" }))
      .toThrow("is not defined");
    expect(() => normalizeNamedWorkflowDefinition(base, { ...lifecycle, stateField: "count" }))
      .toThrow("string-compatible");
    expect(() => normalizeNamedWorkflowDefinition(base, { ...lifecycle, initialState: "Missing" }))
      .toThrow("is not listed in states");
    expect(() => normalizeNamedWorkflowDefinition(base, { ...lifecycle, transitions: [] }))
      .toThrow("must define at least one transition");
    expect(() => normalizeNamedWorkflowDefinition(base, {
      ...lifecycle,
      transitions: [...lifecycle.transitions, ...lifecycle.transitions]
    })).toThrow("is duplicated for state");
  });

  it("compiles minimal transition policies and resolves empty workflow ownership", () => {
    const minimal: NamedWorkflowDefinition = {
      ...lifecycle,
      transitions: [{ action: "finish", from: "Open", to: "Done" }]
    };

    expect(compileWorkflowTransitionPolicies(minimal)).toEqual([{
      name: "lifecycle.finish",
      field: "lifecycle_state",
      action: "finish",
      from: "Open",
      to: "Done"
    }]);
    expect(workflowStateFieldNames(base)).toEqual([]);
  });

  it("enforces configurable workflow and transition bounds", () => {
    expect(() => normalizeNamedWorkflows(base, [lifecycle, review], { maxWorkflows: 1 }))
      .toThrow("cannot define more than 1 workflows");
    expect(() => normalizeNamedWorkflowDefinition(base, {
      ...lifecycle,
      transitions: [
        ...lifecycle.transitions,
        { action: "reopen", from: "Done", to: "Open" }
      ]
    }, { maxTransitionsPerWorkflow: 1 })).toThrow("cannot define more than 1 transitions");
    expect(() => normalizeNamedWorkflows(base, [lifecycle], { maxWorkflows: 0 }))
      .toThrow("must be a positive integer");
  });

  it("filters available actions by state, role, and shared predicate semantics", () => {
    const pending = snapshot({ lifecycle_state: "Done", review_state: "Pending" });
    const blocked = snapshot({ lifecycle_state: "Open", review_state: "Pending" });

    expect(allowedWorkflowTransitions({
      actor: { id: "reviewer", roles: ["Reviewer"] },
      document: pending,
      workflow: review
    }).map((transition) => transition.action)).toEqual(["approve"]);
    expect(allowedWorkflowTransitions({
      actor: { id: "reviewer", roles: ["Reviewer"] },
      document: blocked,
      workflow: review
    })).toEqual([]);
    expect(allowedWorkflowTransitions({
      actor: { id: "user", roles: ["User"] },
      document: pending,
      workflow: review
    })).toEqual([]);

    expect(evaluateNamedWorkflowTransition({
      actor: { id: "reviewer", roles: ["Reviewer"] },
      document: pending,
      workflow: review
    }, "approve")).toMatchObject({ status: "allowed", from: "Pending" });
    expect(evaluateNamedWorkflowTransition({
      actor: { id: "reviewer", roles: ["Reviewer"] },
      document: blocked,
      workflow: review
    }, "approve")).toMatchObject({ status: "condition-denied", from: "Pending" });
    expect(evaluateNamedWorkflowTransition({
      actor: { id: "user", roles: ["User"] },
      document: pending,
      workflow: review
    }, "approve")).toMatchObject({ status: "role-denied", from: "Pending" });
    expect(evaluateNamedWorkflowTransition({
      actor: { id: "reviewer", roles: ["Reviewer"] },
      document: snapshot({ lifecycle_state: "Done", review_state: "Approved" }),
      workflow: review
    }, "approve")).toEqual({ status: "state-denied", from: "Approved" });
    expect(evaluateNamedWorkflowTransition({
      actor: { id: "reviewer", roles: ["Reviewer"] },
      document: pending,
      workflow: review
    }, "missing")).toEqual({ status: "action-not-found", from: "Pending" });
  });

  it("folds and applies resource-local runtime definitions and clear markers", () => {
    const saved = workflowEvent(2, { kind: "NamedWorkflowSaved", doctypeName: "Task", workflowName: "review", workflow: review });
    const unrelated = workflowEvent(1, {
      kind: "NamedWorkflowSaved",
      doctypeName: "Task",
      workflowName: "other",
      workflow: { ...review, name: "other" }
    });
    const state = foldNamedWorkflowDefinition("acme", "Task", "review", [saved, unrelated]);
    const withStatic = Object.freeze({ ...base, workflows: Object.freeze([lifecycle]) });

    expect(state).toMatchObject({ workflowName: "review", version: 2, cleared: false, workflow: review });
    expect(applyNamedWorkflowDefinitionToDocType(withStatic, state).workflows).toEqual([lifecycle, review]);

    const cleared = foldNamedWorkflowDefinition("acme", "Task", "review", [
      saved,
      workflowEvent(3, { kind: "NamedWorkflowCleared", doctypeName: "Task", workflowName: "review" })
    ]);
    expect(applyNamedWorkflowDefinitionToDocType(
      Object.freeze({ ...base, workflows: Object.freeze([lifecycle, review]) }),
      cleared
    ).workflows).toEqual([lifecycle]);
  });

  it("uses named payload kinds and resource-local stream identities", () => {
    expect(namedWorkflowStream("acme", "Task", "review")).toBe("acme:__NamedWorkflows:Task%3Areview");
    expect(isNamedWorkflowStatePayloadKind("NamedWorkflowSaved")).toBe(true);
    expect(isNamedWorkflowStatePayloadKind("WorkflowDefinitionSaved")).toBe(false);
    expect(namedWorkflowStateEventType({
      kind: "NamedWorkflowCleared",
      doctypeName: "Task",
      workflowName: "review"
    })).toBe("NamedWorkflowCleared");
    expect(isWorkflowStateField(base.fields[0]!)).toBe(true);
    expect(isWorkflowStateField(base.fields[2]!)).toBe(false);
  });
});

function snapshot(data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Task",
    name: "TASK-1",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function workflowEvent(sequence: number, payload: NamedWorkflowStateEventPayload): DomainEvent {
  return {
    id: `evt-${String(sequence)}`,
    tenantId: "acme",
    stream: namedWorkflowStream("acme", "Task", payload.workflowName),
    sequence,
    type: payload.kind,
    doctype: "__NamedWorkflows",
    documentName: `Task:${payload.workflowName}`,
    actorId: "admin",
    occurredAt: `2026-01-01T00:00:0${String(sequence)}.000Z`,
    payload,
    metadata: {}
  };
}
