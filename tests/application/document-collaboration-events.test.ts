import { describe, expect, it } from "vitest";

import {
  documentActivityRecordedPayload,
  documentAssignmentPayload,
  documentCommentAddedPayload,
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
});

function collaborationPayload(payload: DocumentCollaborationEventPayload): DocumentCollaborationEventPayload {
  return payload;
}
