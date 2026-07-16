import {
  assignedDocumentMatchesAssignee,
  compareAssignedDocumentSummaries,
  documentHistoryAssignmentsResult,
  documentHistoryEventsAtVersion,
  documentHistoryFollowersResult,
  documentHistoryTagsResult,
  documentTimelineEntries,
  documentTimelineEventChanges,
  documentTimelineBaselineEventCount,
  documentTimelineSummary,
  ensureDocumentHistoryServiceAvailable,
  normalizeAssignedDocumentsAssignee,
  normalizeAssignedDocumentsDoctype,
  normalizeAssignedDocumentsLimit,
  normalizeDocumentTimelineBaselineLimit,
  normalizeDocumentTimelineBeforeSequence,
  normalizeDocumentTimelineLimit,
  selectDocumentTimelinePage,
  type AssignedDocumentSummary,
  type DocumentEventPayload,
  type DocumentSnapshot,
  type DomainEvent
} from "../../src";

describe("document history policy", () => {
  it("selects authorized timeline pages in sequence order with older-event cursors", () => {
    const page = selectDocumentTimelinePage({
      events: [
        event(4, "evt-4"),
        event(1, "evt-1"),
        event(5, "evt-5"),
        event(3, "evt-3"),
        event(2, "evt-2")
      ],
      beforeSequence: 4,
      limit: 2
    });

    expect(page.visibleEvents.map((item) => item.sequence)).toEqual([3, 4]);
    expect(page.nextBeforeSequence).toBe(2);
  });

  it("omits older-event cursors when the selected timeline page is exact", () => {
    const page = selectDocumentTimelinePage({
      events: [event(1, "evt-1"), event(2, "evt-2")],
      beforeSequence: 2,
      limit: 10
    });

    expect(page.visibleEvents.map((item) => item.sequence)).toEqual([1, 2]);
    expect(page.nextBeforeSequence).toBeUndefined();
  });

  it("normalizes timeline limits and beforeSequence cursors", () => {
    expect(normalizeDocumentTimelineLimit(undefined)).toBe(50);
    expect(normalizeDocumentTimelineLimit(500)).toBe(200);
    expect(normalizeDocumentTimelineBeforeSequence(undefined, 7)).toBe(7);
    expect(normalizeDocumentTimelineBeforeSequence(10, 7)).toBe(7);
    expect(normalizeDocumentTimelineBeforeSequence(3, 7)).toBe(3);
    expect(() => normalizeDocumentTimelineLimit(0)).toThrow("Timeline limit must be a positive integer");
    expect(() => normalizeDocumentTimelineBeforeSequence(1.5, 7))
      .toThrow("Timeline beforeSequence must be a positive integer");
  });

  it("normalizes diff baseline budgets", () => {
    expect(normalizeDocumentTimelineBaselineLimit(undefined)).toBe(1_000);
    expect(normalizeDocumentTimelineBaselineLimit(0)).toBe(0);
    expect(normalizeDocumentTimelineBaselineLimit(5)).toBe(5);
    expect(() => normalizeDocumentTimelineBaselineLimit(-1))
      .toThrow("Timeline diff baseline event limit must be a non-negative integer");
  });

  it("normalizes assigned-document filters and availability", () => {
    expect(normalizeAssignedDocumentsLimit(undefined)).toBe(50);
    expect(normalizeAssignedDocumentsLimit(500)).toBe(200);
    expect(normalizeAssignedDocumentsLimit(3)).toBe(3);
    expect(() => normalizeAssignedDocumentsLimit(0))
      .toThrow("Assigned documents limit must be a positive integer");
    expect(() => normalizeAssignedDocumentsLimit(1.5))
      .toThrow("Assigned documents limit must be a positive integer");

    expect(normalizeAssignedDocumentsAssignee(undefined, " owner@example.com ")).toBe("owner@example.com");
    expect(normalizeAssignedDocumentsAssignee(" support@example.com ", "owner@example.com")).toBe("support@example.com");
    expect(() => normalizeAssignedDocumentsAssignee("   ", "owner@example.com"))
      .toThrow("Assigned documents assignee is required");

    expect(normalizeAssignedDocumentsDoctype(undefined)).toBeUndefined();
    expect(normalizeAssignedDocumentsDoctype("   ")).toBeUndefined();
    expect(normalizeAssignedDocumentsDoctype(" Note ")).toBe("Note");

    expect(() => ensureDocumentHistoryServiceAvailable(undefined)).toThrow("Assignments are not enabled");
    expect(() => ensureDocumentHistoryServiceAvailable({ listAssignedDocuments: async () => ({}) })).not.toThrow();
  });

  it("matches and sorts assigned document summaries", () => {
    expect(assignedDocumentMatchesAssignee(["amy@example.com"], "amy@example.com")).toBe(true);
    expect(assignedDocumentMatchesAssignee(["amy@example.com"], "zoe@example.com")).toBe(false);

    const sorted = [
      assigned("Task", "B", "Beta", "2026-01-02T00:00:00.000Z"),
      assigned("Note", "Z", "Zeta", "2026-01-02T00:00:00.000Z"),
      assigned("Note", "A", "Alpha", "2026-01-02T00:00:00.000Z"),
      assigned("Note", "Old", "Old", "2026-01-01T00:00:00.000Z")
    ].sort(compareAssignedDocumentSummaries);

    expect(sorted.map((item) => `${item.updatedAt}:${item.doctype}:${item.label}:${item.name}`)).toEqual([
      "2026-01-02T00:00:00.000Z:Note:Alpha:A",
      "2026-01-02T00:00:00.000Z:Note:Zeta:Z",
      "2026-01-02T00:00:00.000Z:Task:Beta:B",
      "2026-01-01T00:00:00.000Z:Note:Old:Old"
    ]);
  });

  it("calculates baseline event counts and rejects exhausted baseline budgets", () => {
    expect(documentTimelineBaselineEventCount(undefined, 3)).toBeUndefined();
    expect(documentTimelineBaselineEventCount(1, 3)).toBeUndefined();
    expect(documentTimelineBaselineEventCount(4, 3)).toBe(3);
    expect(() => documentTimelineBaselineEventCount(5, 3))
      .toThrow("Timeline diff baseline needs 4 prior events, exceeding the configured limit of 3");
  });

  it("projects timeline entries with summaries and payload-kind based changes", () => {
    const entries = documentTimelineEntries([
      event(1, "evt-1", {
        kind: "DocumentCreated",
        docstatus: "draft",
        data: { title: "Timeline", body: "Before", count: 0 }
      }),
      event(2, "evt-2", {
        kind: "DocumentUpdated",
        patch: { body: "After" }
      }, "MisleadingDeleted")
    ], null);

    expect(entries.map(({ sequence, type, kind, summary, changes }) => ({ sequence, type, kind, summary, changes })))
      .toEqual([
        {
          sequence: 1,
          type: "NoteUpdated",
          kind: "DocumentCreated",
          summary: "Created document",
          changes: [
            { field: "docstatus", newValue: "draft" },
            { field: "body", newValue: "Before" },
            { field: "count", newValue: 0 },
            { field: "title", newValue: "Timeline" }
          ]
        },
        {
          sequence: 2,
          type: "MisleadingDeleted",
          kind: "DocumentUpdated",
          summary: "Updated body",
          changes: [{ field: "body", oldValue: "Before", newValue: "After" }]
        }
      ]);
  });

  it("diffs workflow, domain-command, and docstatus payloads", () => {
    const before = snapshot({ workflow_state: "Open", body: "Before" }, "draft", 1);
    const afterWorkflow = snapshot({ workflow_state: "Closed", body: "Before" }, "draft", 2);
    const afterCommand = snapshot({ workflow_state: "Open", body: "After" }, "draft", 2);
    const afterSubmitted = snapshot({ workflow_state: "Open", body: "Before" }, "submitted", 2);

    expect(documentTimelineEventChanges(event(2, "evt-workflow", {
      kind: "WorkflowTransitioned",
      action: "close",
      from: "Open",
      to: "Closed",
      patch: { workflow_state: "Closed" }
    }), before, afterWorkflow)).toEqual([
      { field: "workflow_state", oldValue: "Open", newValue: "Closed" }
    ]);
    expect(documentTimelineEventChanges(event(2, "evt-command", {
      kind: "DomainCommandApplied",
      command: "rewriteBody",
      input: { body: "After" },
      patch: { body: "After" }
    }), before, afterCommand)).toEqual([
      { field: "body", oldValue: "Before", newValue: "After" }
    ]);
    expect(documentTimelineEventChanges(event(2, "evt-submit", { kind: "DocumentSubmitted" }), before, afterSubmitted))
      .toEqual([{ field: "docstatus", oldValue: "draft", newValue: "submitted" }]);
  });

  it("summarizes update, collaboration, workflow, and long text payloads", () => {
    expect(documentTimelineSummary({ kind: "DocumentUpdated", patch: { count: 1 }, unset: ["body"] }))
      .toBe("Updated count; removed body");
    expect(documentTimelineSummary({ kind: "DocumentActivityRecorded", activityType: "email", subject: "  Follow   up  " }))
      .toBe("Email: Follow up");
    expect(documentTimelineSummary({
      kind: "WorkflowTransitioned",
      action: "close",
      from: "Open",
      to: "Closed",
      patch: { workflow_state: "Closed" }
    })).toBe("Closed workflow_state from Open to Closed");
    expect(documentTimelineSummary({ kind: "DocumentCommentAdded", text: "x".repeat(90) }))
      .toBe(`Commented: ${"x".repeat(77)}...`);
  });

  it("projects current assignments from events at the authorized document version", () => {
    const document = snapshot({ title: "Assigned" }, "draft", 3);
    const events = [
      event(1, "assign-1", { kind: "DocumentAssigned", assigneeId: "zoe@example.com" }),
      event(2, "assign-2", { kind: "DocumentAssigned", assigneeId: "amy@example.com" }),
      event(3, "unassign-1", { kind: "DocumentUnassigned", assigneeId: "zoe@example.com" }),
      event(4, "assign-racing", { kind: "DocumentAssigned", assigneeId: "late@example.com" })
    ];

    expect(documentHistoryEventsAtVersion(events, 3).map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(documentHistoryAssignmentsResult(document, events)).toEqual({
      tenantId: "acme",
      doctype: "Note",
      name: "Timeline",
      version: 3,
      docstatus: "draft",
      assignees: ["amy@example.com"]
    });
  });

  it("projects current tags from events at the authorized document version", () => {
    const document = snapshot({ title: "Tagged" }, "draft", 3);
    const events = [
      event(1, "tag-1", { kind: "DocumentTagged", tag: "Urgent" }),
      event(2, "tag-2", { kind: "DocumentTagged", tag: "Customer" }),
      event(3, "untag-1", { kind: "DocumentUntagged", tag: "Urgent" }),
      event(4, "tag-racing", { kind: "DocumentTagged", tag: "Later" })
    ];

    expect(documentHistoryTagsResult(document, events)).toEqual({
      tenantId: "acme",
      doctype: "Note",
      name: "Timeline",
      version: 3,
      docstatus: "draft",
      tags: ["Customer"]
    });
  });

  it("projects current followers from events at the authorized document version", () => {
    const document = snapshot({ title: "Followed" }, "submitted", 3);
    const events = [
      event(1, "follow-1", { kind: "DocumentFollowed", followerId: "owner@example.com" }),
      event(2, "follow-2", { kind: "DocumentFollowed", followerId: "amy@example.com" }),
      event(3, "unfollow-1", { kind: "DocumentUnfollowed", followerId: "owner@example.com" }),
      event(4, "follow-racing", { kind: "DocumentFollowed", followerId: "late@example.com" })
    ];

    expect(documentHistoryFollowersResult(document, events)).toEqual({
      tenantId: "acme",
      doctype: "Note",
      name: "Timeline",
      version: 3,
      docstatus: "submitted",
      followers: ["amy@example.com"]
    });
  });
});

function event(
  sequence: number,
  id: string,
  payload: DocumentEventPayload = { kind: "DocumentUpdated", patch: { count: sequence } },
  type = "NoteUpdated"
): DomainEvent {
  return {
    id,
    stream: "tenant:acme:doctype:Note:document:Timeline",
    sequence,
    type,
    tenantId: "acme",
    doctype: "Note",
    documentName: "Timeline",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}

function snapshot(data: DocumentSnapshot["data"], docstatus: DocumentSnapshot["docstatus"], version: number): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "Timeline",
    version,
    docstatus,
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function assigned(
  doctype: AssignedDocumentSummary["doctype"],
  name: AssignedDocumentSummary["name"],
  label: string,
  updatedAt: string
): AssignedDocumentSummary {
  return {
    tenantId: "acme",
    doctype,
    name,
    label,
    route: `/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    version: 1,
    docstatus: "draft",
    updatedAt,
    assignees: ["amy@example.com"]
  };
}
