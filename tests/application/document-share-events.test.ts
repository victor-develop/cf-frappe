import { describe, expect, it } from "vitest";

import {
  DOCUMENT_SHARE_PAYLOAD_KINDS,
  documentShareEventType,
  documentShareStateFromEvents,
  documentSharedPayload,
  documentShareRevokedPayload,
  type DocumentShareEventPayload
} from "../../src";
import type { DomainEvent } from "../../src";

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

  it("derives default and override event types from share payload identity", () => {
    expect(documentShareEventType({
      doctypeName: "Note",
      kind: "DocumentShared"
    })).toBe("NoteShared");
    expect(documentShareEventType({
      doctypeName: "Note",
      kind: "DocumentShareRevoked"
    })).toBe("NoteShareRevoked");
    expect(documentShareEventType({
      doctypeName: "Note",
      kind: "DocumentShared",
      shareEventType: "NoteDelegated"
    })).toBe("NoteDelegated");
    expect(documentShareEventType({
      doctypeName: "Note",
      kind: "DocumentShareRevoked",
      unshareEventType: "NoteDelegationRevoked"
    })).toBe("NoteDelegationRevoked");
  });

  it("replays document share state from the document event stream", () => {
    const state = documentShareStateFromEvents({
      tenantId: "acme",
      doctype: "Note",
      name: "Shared Note",
      events: [
        updatedEvent(1),
        sharedEvent(2, "collab@example.com", ["share"]),
        sharedEvent(3, "reader@example.com", ["read"])
      ]
    });

    expect(state).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      name: "Shared Note",
      version: 3,
      grants: [
        { userId: "collab@example.com", permissions: ["read", "share"] },
        { userId: "reader@example.com", permissions: ["read"] }
      ]
    });
  });

  it("exposes the bounded document share payload kind set", () => {
    expect(DOCUMENT_SHARE_PAYLOAD_KINDS).toEqual([
      "DocumentShared",
      "DocumentShareRevoked"
    ]);
  });
});

function sharePayload(payload: DocumentShareEventPayload): DocumentShareEventPayload {
  return payload;
}

function updatedEvent(sequence: number): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:Note:Shared%20Note",
    sequence,
    type: "NoteUpdated",
    doctype: "Note",
    documentName: "Shared Note",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentUpdated", patch: { title: "Shared Note" } },
    metadata: {}
  };
}

function sharedEvent(
  sequence: number,
  userId: string,
  permissions: readonly ("read" | "share" | "update")[]
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:Note:Shared%20Note",
    sequence,
    type: "NoteShared",
    doctype: "Note",
    documentName: "Shared Note",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: documentSharedPayload({ userId, permissions }),
    metadata: {}
  };
}
