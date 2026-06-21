import {
  canSubscribeToRealtimeTopic,
  documentRealtimeTopic,
  doctypeRealtimeTopic,
  parseRealtimeTopic,
  realtimeEventFromDomainEvent,
  tenantRealtimeTopic
} from "../../src";
import { manager, now, owner } from "../helpers";
import type { DomainEvent } from "../../src";

describe("realtime topics", () => {
  it("encodes and parses tenant, doctype, and document topics", () => {
    expect(tenantRealtimeTopic("acme")).toBe("tenant:acme");
    expect(doctypeRealtimeTopic("acme", "Sales Invoice")).toBe("doctype:acme:Sales%20Invoice");
    expect(documentRealtimeTopic("acme", "Note", "A:B")).toBe("document:acme:Note:A%3AB");
    expect(parseRealtimeTopic("document:acme:Note:A%3AB")).toEqual({
      kind: "document",
      tenantId: "acme",
      doctype: "Note",
      name: "A:B"
    });
  });

  it("allows subscriptions only within the actor tenant or system manager role", () => {
    expect(canSubscribeToRealtimeTopic(owner, "tenant:acme")).toBe(false);
    expect(canSubscribeToRealtimeTopic(owner, "document:acme:Note:One")).toBe(true);
    expect(canSubscribeToRealtimeTopic(owner, "tenant:other")).toBe(false);
    expect(canSubscribeToRealtimeTopic({ ...manager, roles: ["System Manager"] }, "tenant:other")).toBe(false);
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
});
