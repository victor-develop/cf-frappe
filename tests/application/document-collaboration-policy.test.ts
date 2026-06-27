import { defineDocType } from "../../src";
import type { Actor, DocumentSnapshot } from "../../src";
import {
  ensureSharedGrantIsDelegable,
  normalizeActivity,
  normalizeAssigneeId,
  normalizeCommentText,
  normalizeFollowerId,
  normalizeTag,
  normalizeValidDocumentShareGrant,
  normalizeValidDocumentShareUserId
} from "../../src/application/document-collaboration-policy";

const actor: Actor = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text", required: true }]
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

  it("normalizes assignee, tag, and follower identifiers", () => {
    expect(normalizeAssigneeId(" support@example.com ")).toBe("support@example.com");
    expect(normalizeTag("  Urgent   Customer  ")).toBe("Urgent Customer");
    expect(normalizeFollowerId(" follower@example.com ")).toBe("follower@example.com");

    expect(() => normalizeAssigneeId(" ")).toThrow("Assignee is required");
    expect(() => normalizeTag(" ")).toThrow("Tag is required");
    expect(() => normalizeFollowerId(" ")).toThrow("Follower is required");
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
