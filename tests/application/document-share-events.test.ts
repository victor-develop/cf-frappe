import { describe, expect, it } from "vitest";

import {
  documentSharedPayload,
  documentShareRevokedPayload,
  type DocumentShareEventPayload
} from "../../src";

describe("document share events", () => {
  it("builds share-granted payloads", () => {
    expect(
      sharePayload(
        documentSharedPayload({
          userId: "collab@example.com",
          permissions: ["read", "share", "update"]
        })
      )
    ).toEqual({
      kind: "DocumentShared",
      userId: "collab@example.com",
      permissions: ["read", "share", "update"]
    });
  });

  it("builds share-revoked payloads", () => {
    expect(sharePayload(documentShareRevokedPayload("collab@example.com"))).toEqual({
      kind: "DocumentShareRevoked",
      userId: "collab@example.com"
    });
  });
});

function sharePayload(payload: DocumentShareEventPayload): DocumentShareEventPayload {
  return payload;
}
