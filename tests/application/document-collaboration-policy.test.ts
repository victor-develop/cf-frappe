import { defineDocType } from "../../src";
import type { Actor, DocumentSnapshot } from "../../src";
import {
  collaborationCollectionChange,
  ensureSharedGrantIsDelegable,
  normalizeActivity,
  normalizeAssigneeId,
  normalizeCommentText,
  normalizeFollowerId,
  normalizeTag,
  normalizeValidDocumentShareGrant,
  normalizeValidDocumentShareUserId,
  planDocumentActivityPolicy,
  planDocumentAssignmentChangePolicy,
  planDocumentCommentPolicy,
  planDocumentFollowerChangePolicy,
  planDocumentTagChangePolicy
} from "../../src/application/document-collaboration-policy";

const actor: Actor = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text", required: true }]
});

const CustomEventsNote = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text", required: true }],
  events: {
    comment: "NoteCommented",
    activity: "NoteActivitySeen",
    assign: "NoteOwnerAssigned",
    unassign: "NoteOwnerUnassigned",
    tag: "NoteLabelAdded",
    untag: "NoteLabelRemoved",
    follow: "NoteWatched",
    unfollow: "NoteUnwatched"
  }
});

describe("document collaboration policy", () => {
  it("normalizes comment text within the command boundary", () => {
    expect(normalizeCommentText("  hello  ")).toBe("hello");
    expect(() => normalizeCommentText("   ")).toThrow("Comment text is required");
    expect(() => normalizeCommentText("x".repeat(5001))).toThrow("Comment text exceeds 5000 characters");
  });

  it("normalizes activity records with defaults and optional text trimming", () => {
    expect(
      normalizeActivity({
        activityType: "  ",
        subject: "  Sent invoice  ",
        detail: "  Details  ",
        channel: "  email  ",
        externalId: "  msg-1  "
      })
    ).toEqual({
      activityType: "activity",
      subject: "Sent invoice",
      detail: "Details",
      channel: "email",
      externalId: "msg-1"
    });

    expect(() => normalizeActivity({ subject: "   " })).toThrow("Activity subject is required");
    expect(() => normalizeActivity({ activityType: "x".repeat(65), subject: "ok" }))
      .toThrow("Activity type exceeds 64 characters");
  });

  it("plans comment and activity event names with normalized payloads", () => {
    expect(planDocumentCommentPolicy(CustomEventsNote, "  Looks good  ")).toEqual({
      eventType: "NoteCommented",
      payload: { kind: "DocumentCommentAdded", text: "Looks good" }
    });

    expect(
      planDocumentActivityPolicy(Note, {
        activityType: " email ",
        subject: " Sent invoice ",
        detail: "  Details  "
      })
    ).toEqual({
      eventType: "NoteActivityRecorded",
      payload: {
        kind: "DocumentActivityRecorded",
        activityType: "email",
        subject: "Sent invoice",
        detail: "Details"
      }
    });
  });

  it("normalizes assignee, tag, and follower identifiers", () => {
    expect(normalizeAssigneeId(" support@example.com ")).toBe("support@example.com");
    expect(normalizeTag("  Urgent   Customer  ")).toBe("Urgent Customer");
    expect(normalizeFollowerId(" follower@example.com ")).toBe("follower@example.com");

    expect(() => normalizeAssigneeId(" ")).toThrow("Assignee is required");
    expect(() => normalizeTag(" ")).toThrow("Tag is required");
    expect(() => normalizeFollowerId(" ")).toThrow("Follower is required");
  });

  it("plans idempotent collaboration collection changes", () => {
    expect(collaborationCollectionChange(["a@example.com"], "a@example.com", "add")).toEqual({
      value: "a@example.com",
      noop: true
    });
    expect(collaborationCollectionChange(["a@example.com"], "b@example.com", "add")).toEqual({
      value: "b@example.com",
      noop: false
    });
    expect(collaborationCollectionChange(["a@example.com"], "a@example.com", "remove")).toEqual({
      value: "a@example.com",
      noop: false
    });
    expect(collaborationCollectionChange(["a@example.com"], "b@example.com", "remove")).toEqual({
      value: "b@example.com",
      noop: true
    });
  });

  it("plans assignment collection events with custom event names and noop state", () => {
    expect(
      planDocumentAssignmentChangePolicy({
        doctype: CustomEventsNote,
        currentAssignees: ["owner@example.com"],
        assignee: " support@example.com ",
        action: "add"
      })
    ).toEqual({
      value: "support@example.com",
      noop: false,
      eventType: "NoteOwnerAssigned",
      payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" }
    });

    expect(
      planDocumentAssignmentChangePolicy({
        doctype: CustomEventsNote,
        currentAssignees: ["owner@example.com"],
        assignee: "owner@example.com",
        action: "add"
      })
    ).toMatchObject({ value: "owner@example.com", noop: true, eventType: "NoteOwnerAssigned" });
  });

  it("plans tag collection events with normalized labels", () => {
    expect(
      planDocumentTagChangePolicy({
        doctype: Note,
        currentTags: ["Urgent"],
        tag: "  Customer   Followup  ",
        action: "add"
      })
    ).toEqual({
      value: "Customer Followup",
      noop: false,
      eventType: "NoteTagged",
      payload: { kind: "DocumentTagged", tag: "Customer Followup" }
    });

    expect(
      planDocumentTagChangePolicy({
        doctype: CustomEventsNote,
        currentTags: ["Urgent"],
        tag: "Urgent",
        action: "remove"
      })
    ).toEqual({
      value: "Urgent",
      noop: false,
      eventType: "NoteLabelRemoved",
      payload: { kind: "DocumentUntagged", tag: "Urgent" }
    });
  });

  it("plans follower collection events with actor fallback", () => {
    expect(
      planDocumentFollowerChangePolicy({
        doctype: Note,
        actor,
        currentFollowers: [],
        action: "add"
      })
    ).toEqual({
      value: "owner@example.com",
      noop: false,
      eventType: "NoteFollowed",
      payload: { kind: "DocumentFollowed", followerId: "owner@example.com" }
    });

    expect(
      planDocumentFollowerChangePolicy({
        doctype: CustomEventsNote,
        actor,
        currentFollowers: ["follower@example.com"],
        follower: " follower@example.com ",
        action: "remove"
      })
    ).toEqual({
      value: "follower@example.com",
      noop: false,
      eventType: "NoteUnwatched",
      payload: { kind: "DocumentUnfollowed", followerId: "follower@example.com" }
    });
  });

  it("canonicalizes share grants before DocumentService writes events", () => {
    expect(
      normalizeValidDocumentShareGrant({
        userId: " collab@example.com ",
        permissions: ["write", "share", "read"]
      })
    ).toEqual({
      userId: "collab@example.com",
      permissions: ["read", "share", "update"]
    });

    expect(normalizeValidDocumentShareUserId(" collab@example.com ")).toBe("collab@example.com");
    expect(() => normalizeValidDocumentShareGrant({ userId: " ", permissions: ["read"] }))
      .toThrow("Share user is required");
    expect(() => normalizeValidDocumentShareGrant({ userId: "collab@example.com", permissions: [] }))
      .toThrow("Share permissions are required");
    expect(() => normalizeValidDocumentShareGrant({ userId: "collab@example.com", permissions: ["admin"] }))
      .toThrow("Share permissions are invalid: admin");
  });

  it("blocks delegated share grants outside the actor's current shared permissions", () => {
    const grant = normalizeValidDocumentShareGrant({
      userId: "collab@example.com",
      permissions: ["read", "update"]
    });

    expect(() =>
      ensureSharedGrantIsDelegable(actor, Note, snapshot(), ["read"], grant)
    ).toThrow("cannot grant update on Note/NOTE-1");

    expect(() =>
      ensureSharedGrantIsDelegable(actor, Note, snapshot(), ["read", "update"], grant)
    ).not.toThrow();
  });
});

function snapshot(): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: Note.name,
    name: "NOTE-1",
    version: 1,
    docstatus: "draft",
    data: { title: "A" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
