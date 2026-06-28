import { describe, expect, it } from "vitest";

import {
  canExecuteDomainCommandForRoles,
  ensureDocumentStatus,
  ensureExpectedVersion,
  ensureMergeBaseVersion,
  mergeSnapshotFromDocument,
  normalizeUnsetFields,
  planDomainCommandPolicy,
  pickCommandFields,
  type Actor,
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
});
