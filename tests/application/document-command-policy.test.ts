import { describe, expect, it } from "vitest";

import {
  canExecuteDomainCommandForRoles,
  ensureDocumentStatus,
  ensureExpectedVersion,
  ensureMergeBaseVersion,
  mergeSnapshotFromDocument,
  normalizeUnsetFields,
  planDocumentCopyPolicy,
  planDocumentDeletePolicy,
  planDocumentStatusChangePolicy,
  planDomainCommandPolicy,
  planWorkflowTransitionPolicy,
  pickCommandFields,
  type Actor,
  type DocTypeDefinition,
  type DocumentSnapshot
} from "../../src";

const actor: Actor = { id: "user@example.com", roles: ["User"], tenantId: "acme" };

const snapshot: DocumentSnapshot = {
  tenantId: "acme",
  doctype: "Note",
  name: "NOTE-1",
  version: 3,
  docstatus: "draft",
  data: { title: "Hello", body: "World", count: 1 },
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T01:00:00.000Z"
};

const copyDoctype: DocTypeDefinition = {
  name: "Note",
  fields: [
    { name: "title", type: "text" },
    { name: "secret", type: "text", noCopy: true },
    { name: "status", type: "text" }
  ]
};

const relatedDocType = () => {
  throw new Error("No related DocTypes in this test");
};

describe("document command policy", () => {
  it("checks optimistic expected versions", () => {
    expect(() => ensureExpectedVersion(snapshot, undefined)).not.toThrow();
    expect(() => ensureExpectedVersion(snapshot, 3)).not.toThrow();
    expect(() => ensureExpectedVersion(snapshot, 2)).toThrow("Expected version 2, found 3");
  });

  it("checks merge base version input", () => {
    expect(() => ensureMergeBaseVersion(0)).not.toThrow();
    expect(() => ensureMergeBaseVersion(2)).not.toThrow();
    expect(() => ensureMergeBaseVersion(-1)).toThrow("baseVersion must be a non-negative integer");
    expect(() => ensureMergeBaseVersion(1.5)).toThrow("baseVersion must be a non-negative integer");
  });

  it("projects documents into merge snapshots", () => {
    expect(mergeSnapshotFromDocument(snapshot)).toEqual({
      version: 3,
      docstatus: "draft",
      data: { title: "Hello", body: "World", count: 1 }
    });
  });

  it("checks allowed document statuses for commands", () => {
    expect(() => ensureDocumentStatus(snapshot, ["draft"], "submit")).not.toThrow();
    expect(() => ensureDocumentStatus({ ...snapshot, docstatus: "submitted" }, ["draft"], "update")).toThrow(
      "Cannot update Note/NOTE-1 while it is submitted"
    );
  });

  it("normalizes unset fields for command payloads", () => {
    expect(normalizeUnsetFields(undefined)).toEqual([]);
    expect(normalizeUnsetFields([" body ", "", "title", "body"])).toEqual(["body", "title"]);
  });

  it("picks configured domain command fields from input data", () => {
    expect(pickCommandFields(undefined, { title: "Hello", body: "World" })).toEqual({
      title: "Hello",
      body: "World"
    });
    expect(pickCommandFields(["body", "missing"], { title: "Hello", body: "World" })).toEqual({
      body: "World"
    });
  });

  it("plans field-picked domain command patches with default execution policy", () => {
    expect(
      planDomainCommandPolicy({
        actor,
        definition: {
          name: "close",
          eventType: "NoteClosed",
          fields: ["title", "missing", "body"]
        },
        document: snapshot,
        input: { title: "Updated", body: undefined, ignored: "nope" },
        now: "2026-06-28T02:00:00.000Z"
      })
    ).toEqual({
      input: { title: "Updated", ignored: "nope" },
      patch: { title: "Updated" },
      permissionAction: "update",
      allowReadOnlyFields: false
    });
  });

  it("plans buildPatch domain command patches from compact input", () => {
    expect(
      planDomainCommandPolicy({
        actor,
        definition: {
          name: "score",
          eventType: "NoteScored",
          permissionAction: "metadata",
          allowReadOnlyFields: true,
          buildPatch: ({ input, now }) => ({
            title: `${String(input.title)} @ ${now}`
          })
        },
        document: snapshot,
        input: { title: "Reviewed", body: undefined },
        now: "2026-06-28T02:00:00.000Z"
      })
    ).toEqual({
      input: { title: "Reviewed" },
      patch: { title: "Reviewed @ 2026-06-28T02:00:00.000Z" },
      permissionAction: "metadata",
      allowReadOnlyFields: true
    });
  });

  it("checks domain command role eligibility as a pure policy", () => {
    expect(canExecuteDomainCommandForRoles(actor, {})).toBe(true);
    expect(canExecuteDomainCommandForRoles(actor, { roles: ["System Manager", "User"] })).toBe(true);
    expect(canExecuteDomainCommandForRoles(actor, { roles: ["System Manager"] })).toBe(false);
  });

  it("plans workflow transition patches and default event types", () => {
    expect(
      planWorkflowTransitionPolicy({
        actor,
        action: "close",
        doctypeName: "Note",
        document: { ...snapshot, data: { ...snapshot.data, workflow_state: "Open" } },
        workflow: {
          initialState: "Open",
          states: ["Open", "Closed"],
          transitions: [{ action: "close", from: "Open", to: "Closed" }]
        }
      })
    ).toEqual({
      from: "Open",
      to: "Closed",
      patch: { workflow_state: "Closed" },
      eventType: "NoteClose"
    });
  });

  it("plans workflow transitions with custom state fields and custom events", () => {
    expect(
      planWorkflowTransitionPolicy({
        actor,
        action: "approve",
        doctypeName: "Expense Claim",
        document: { ...snapshot, data: { ...snapshot.data, status: "Review" } },
        workflow: {
          stateField: "status",
          initialState: "Draft",
          states: ["Draft", "Review", "Approved"],
          transitions: [
            { action: "approve", from: "Review", to: "Approved", roles: ["User"], eventType: "ExpenseApproved" }
          ]
        }
      })
    ).toEqual({
      from: "Review",
      to: "Approved",
      patch: { status: "Approved" },
      eventType: "ExpenseApproved"
    });
  });

  it("rejects workflow transitions that are not allowed from the current state", () => {
    expect(() =>
      planWorkflowTransitionPolicy({
        actor,
        action: "approve",
        doctypeName: "Expense Claim",
        document: { ...snapshot, data: { ...snapshot.data, status: "Review" } },
        workflow: {
          stateField: "status",
          initialState: "Draft",
          states: ["Draft", "Review", "Approved"],
          transitions: [{ action: "approve", from: "Review", to: "Approved", roles: ["System Manager"] }]
        }
      })
    ).toThrow("Transition 'approve' is not allowed from 'Review'");
  });

  it("plans submit status changes with default event names", () => {
    expect(planDocumentStatusChangePolicy({ name: "Note" }, "submit")).toEqual({
      allowedStatus: ["draft"],
      nextStatus: "submitted",
      eventType: "NoteSubmitted",
      payloadKind: "DocumentSubmitted"
    });
  });

  it("plans cancel status changes with custom event names", () => {
    expect(
      planDocumentStatusChangePolicy(
        { name: "Note", events: { cancel: "NoteWasCancelled" } },
        "cancel"
      )
    ).toEqual({
      allowedStatus: ["submitted"],
      nextStatus: "cancelled",
      eventType: "NoteWasCancelled",
      payloadKind: "DocumentCancelled"
    });
  });

  it("plans delete lifecycle changes with default event names", () => {
    expect(planDocumentDeletePolicy({ name: "Note" })).toEqual({
      allowedStatus: ["draft", "cancelled"],
      nextStatus: "deleted",
      eventType: "NoteDeleted",
      payloadKind: "DocumentDeleted"
    });
  });

  it("plans delete lifecycle changes with custom event names", () => {
    expect(planDocumentDeletePolicy({ name: "Note", events: { delete: "NoteWasDeleted" } })).toEqual({
      allowedStatus: ["draft", "cancelled"],
      nextStatus: "deleted",
      eventType: "NoteWasDeleted",
      payloadKind: "DocumentDeleted"
    });
  });

  it("plans duplicate data without copying no-copy fields", () => {
    expect(
      planDocumentCopyPolicy({
        action: "duplicate",
        doctype: copyDoctype,
        existing: {
          ...snapshot,
          data: { title: "Original", secret: "keep-private", status: "Open" }
        },
        data: { title: "Copy", status: undefined },
        metadata: { source: "copy-button" },
        relatedDocType
      })
    ).toEqual({
      data: { title: "Copy", status: "Open" },
      metadata: { source: "copy-button", duplicatedFrom: "NOTE-1", duplicatedFromVersion: 3 }
    });
  });

  it("plans amendment data with amendment provenance", () => {
    expect(
      planDocumentCopyPolicy({
        action: "amend",
        doctype: copyDoctype,
        existing: {
          ...snapshot,
          version: 5,
          data: { title: "Original", secret: "kept", status: "Cancelled" }
        },
        data: { title: "Amended" },
        metadata: { source: "amend-button" },
        relatedDocType
      })
    ).toEqual({
      data: { title: "Amended", secret: "kept", status: "Cancelled" },
      metadata: { source: "amend-button", amendedFrom: "NOTE-1", amendedFromVersion: 5 }
    });
  });
});
