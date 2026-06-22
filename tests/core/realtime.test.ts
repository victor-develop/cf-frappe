import {
  canSubscribeToRealtimeTopic,
  documentRealtimeTopic,
  doctypeRealtimeTopic,
  parseRealtimeTopic,
  realtimeEventFromDomainEvent,
  realtimeUserNotificationsFromDomainEvent,
  tenantRealtimeTopic,
  userRealtimeTopic
} from "../../src";
import { manager, now, owner } from "../helpers";
import type { DomainEvent } from "../../src";

describe("realtime topics", () => {
  it("encodes and parses tenant, doctype, and document topics", () => {
    expect(tenantRealtimeTopic("acme")).toBe("tenant:acme");
    expect(doctypeRealtimeTopic("acme", "Sales Invoice")).toBe("doctype:acme:Sales%20Invoice");
    expect(userRealtimeTopic("acme", "owner@example.com")).toBe("user:acme:owner%40example.com");
    expect(documentRealtimeTopic("acme", "Note", "A:B")).toBe("document:acme:Note:A%3AB");
    expect(parseRealtimeTopic("document:acme:Note:A%3AB")).toEqual({
      kind: "document",
      tenantId: "acme",
      doctype: "Note",
      name: "A:B"
    });
    expect(parseRealtimeTopic("user:acme:owner%40example.com")).toEqual({
      kind: "user",
      tenantId: "acme",
      userId: "owner@example.com"
    });
  });

  it("allows subscriptions only within the actor tenant or system manager role", () => {
    expect(canSubscribeToRealtimeTopic(owner, "tenant:acme")).toBe(false);
    expect(canSubscribeToRealtimeTopic(owner, "doctype:acme:Note")).toBe(false);
    expect(canSubscribeToRealtimeTopic(owner, "doctype:other:Note")).toBe(false);
    expect(canSubscribeToRealtimeTopic(owner, "user:acme:owner%40example.com")).toBe(true);
    expect(canSubscribeToRealtimeTopic(owner, "user:acme:manager%40example.com")).toBe(false);
    expect(canSubscribeToRealtimeTopic(owner, "user:other:owner%40example.com")).toBe(false);
    expect(canSubscribeToRealtimeTopic(owner, "document:acme:Note:One")).toBe(true);
    expect(canSubscribeToRealtimeTopic(owner, "tenant:other")).toBe(false);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "tenant:acme")).toBe(true);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "tenant:other")).toBe(false);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "doctype:acme:Note")).toBe(true);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "doctype:other:Note")).toBe(false);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "user:acme:owner%40example.com")).toBe(true);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "user:other:owner%40example.com")).toBe(false);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "document:other:Note:One")).toBe(true);
    expect(canSubscribeToRealtimeTopic(owner, "bad-topic")).toBe(false);
  });

  it("builds document realtime events from domain events", () => {
    const event: DomainEvent = {
      id: "evt1",
      tenantId: "acme",
      stream: "acme:Note:One",
      sequence: 1,
      type: "NoteCreated",
      doctype: "Note",
      documentName: "One",
      actorId: "owner@example.com",
      occurredAt: now,
      payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
      metadata: {}
    };

    expect(realtimeEventFromDomainEvent(event, null)).toMatchObject({
      id: "evt1",
      type: "NoteCreated",
      topics: ["tenant:acme", "doctype:acme:Note", "document:acme:Note:One"],
      tenantId: "acme",
      occurredAt: now
    });
  });

  it("builds redacted user notifications only for user-recipient events", () => {
    const event: DomainEvent = {
      id: "evt2",
      tenantId: "acme",
      stream: "acme:Note:One",
      sequence: 2,
      type: "NoteAssigned",
      doctype: "Note",
      documentName: "One",
      actorId: "owner@example.com",
      occurredAt: now,
      payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" },
      metadata: {}
    };
    const created: DomainEvent = {
      ...event,
      id: "evt3",
      type: "NoteCreated",
      payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" }
    };

    expect(realtimeUserNotificationsFromDomainEvent(created)).toEqual([]);

    const cases: Array<{
      readonly type: string;
      readonly payload: DomainEvent["payload"];
      readonly recipientId: string;
    }> = [
      {
        type: "NoteAssigned",
        payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" },
        recipientId: "support@example.com"
      },
      {
        type: "NoteUnassigned",
        payload: { kind: "DocumentUnassigned", assigneeId: "support@example.com" },
        recipientId: "support@example.com"
      },
      {
        type: "NoteFollowed",
        payload: { kind: "DocumentFollowed", followerId: "owner@example.com" },
        recipientId: "owner@example.com"
      },
      {
        type: "NoteUnfollowed",
        payload: { kind: "DocumentUnfollowed", followerId: "owner@example.com" },
        recipientId: "owner@example.com"
      }
    ];
    for (const item of cases) {
      expect(realtimeUserNotificationsFromDomainEvent({ ...event, type: item.type, payload: item.payload })).toEqual([
        {
          id: `evt2:user:${encodeURIComponent(item.recipientId)}`,
          type: item.type,
          topics: [`user:acme:${encodeURIComponent(item.recipientId)}`],
          tenantId: "acme",
          occurredAt: now,
          payload: {
            kind: "DocumentUserNotification",
            eventId: "evt2",
            eventType: item.type,
            payloadKind: item.payload.kind,
            tenantId: "acme",
            doctype: "Note",
            documentName: "One",
            actorId: "owner@example.com",
            recipientId: item.recipientId
          }
        }
      ]);
    }
    expect(JSON.stringify(realtimeUserNotificationsFromDomainEvent(event)[0]?.payload)).not.toContain("snapshot");
  });
});
