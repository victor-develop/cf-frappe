import { describe, expect, it } from "vitest";

import {
  DOCUMENT_COLLABORATION_PAYLOAD_KINDS,
  documentActivityRecordedPayload,
  documentAssignmentPayload,
  documentCommentAddedPayload,
  documentCollaborationEventType,
  documentFollowerPayload,
  documentTagPayload,
  type DocumentCollaborationEventPayload
} from "../../src";

describe("document collaboration events", () => {
  it("builds comment payloads", () => {
    expect(collaborationPayload(documentCommentAddedPayload("Looks good"))).toEqual({
      kind: "DocumentCommentAdded",
      text: "Looks good"
    });
  });

  it("builds activity payloads without undefined optional fields", () => {
    expect(
      documentActivityRecordedPayload({
        activityType: "email",
        subject: "Sent invoice"
      })
    ).toEqual({
      kind: "DocumentActivityRecorded",
      activityType: "email",
      subject: "Sent invoice"
    });
  });

  it("builds activity payloads with optional delivery metadata", () => {
    expect(
      documentActivityRecordedPayload({
        activityType: "email",
        subject: "Sent invoice",
        detail: "Message body",
        channel: "gmail",
        externalId: "msg-1"
      })
    ).toEqual({
      kind: "DocumentActivityRecorded",
      activityType: "email",
      subject: "Sent invoice",
      detail: "Message body",
      channel: "gmail",
      externalId: "msg-1"
    });
  });

  it("builds assignment payloads", () => {
    expect(documentAssignmentPayload("DocumentAssigned", "owner@example.com")).toEqual({
      kind: "DocumentAssigned",
      assigneeId: "owner@example.com"
    });
    expect(documentAssignmentPayload("DocumentUnassigned", "owner@example.com")).toEqual({
      kind: "DocumentUnassigned",
      assigneeId: "owner@example.com"
    });
  });

  it("builds tag payloads", () => {
    expect(documentTagPayload("DocumentTagged", "Urgent")).toEqual({
      kind: "DocumentTagged",
      tag: "Urgent"
    });
    expect(documentTagPayload("DocumentUntagged", "Urgent")).toEqual({
      kind: "DocumentUntagged",
      tag: "Urgent"
    });
  });

  it("builds follower payloads", () => {
    expect(documentFollowerPayload("DocumentFollowed", "owner@example.com")).toEqual({
      kind: "DocumentFollowed",
      followerId: "owner@example.com"
    });
    expect(documentFollowerPayload("DocumentUnfollowed", "owner@example.com")).toEqual({
      kind: "DocumentUnfollowed",
      followerId: "owner@example.com"
    });
  });

  it("derives default event types from collaboration payload identity", () => {
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentCommentAdded" })).toBe("TaskCommentAdded");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentActivityRecorded" })).toBe("TaskActivityRecorded");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentAssigned" })).toBe("TaskAssigned");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentUnassigned" })).toBe("TaskUnassigned");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentTagged" })).toBe("TaskTagged");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentUntagged" })).toBe("TaskUntagged");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentFollowed" })).toBe("TaskFollowed");
    expect(documentCollaborationEventType({ doctypeName: "Task", kind: "DocumentUnfollowed" })).toBe("TaskUnfollowed");
  });

  it("uses DocType event overrides for collaboration event types", () => {
    expect(documentCollaborationEventType({
      doctypeName: "Task",
      kind: "DocumentAssigned",
      assignEventType: "TaskDelegated"
    })).toBe("TaskDelegated");
    expect(documentCollaborationEventType({
      doctypeName: "Task",
      kind: "DocumentUntagged",
      untagEventType: "TaskLabelRemoved"
    })).toBe("TaskLabelRemoved");
    expect(documentCollaborationEventType({
      doctypeName: "Task",
      kind: "DocumentActivityRecorded",
      activityEventType: "TaskAuditActivity"
    })).toBe("TaskAuditActivity");
  });

  it("exposes the bounded document collaboration payload kind set", () => {
    expect(DOCUMENT_COLLABORATION_PAYLOAD_KINDS).toEqual([
      "DocumentCommentAdded",
      "DocumentActivityRecorded",
      "DocumentAssigned",
      "DocumentUnassigned",
      "DocumentTagged",
      "DocumentUntagged",
      "DocumentFollowed",
      "DocumentUnfollowed"
    ]);
  });
});

function collaborationPayload(payload: DocumentCollaborationEventPayload): DocumentCollaborationEventPayload {
  return payload;
}
