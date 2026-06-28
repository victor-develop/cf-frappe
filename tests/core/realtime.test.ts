import {
  canSubscribeToRealtimeTopic,
  DOCUMENT_FIELD_EDIT_EVENT_TYPE,
  DOCUMENT_FIELD_EDIT_MESSAGE_TYPE,
  DOCUMENT_SHARED_DRAFT_EVENT_TYPE,
  DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE,
  documentRealtimeTopic,
  doctypeRealtimeTopic,
  parseRealtimeTopic,
  realtimeEventFromDocumentFieldEdit,
  realtimeEventFromDocumentSharedDraft,
  realtimeEventFromDomainEvent,
  realtimeUserNotificationsFromDomainEvent,
  tenantRealtimeTopic,
  userRealtimeTopic
} from "../../src";
import { manager, now, owner } from "../helpers";
import type { DocumentData, DocumentSnapshot, DomainEvent, JsonValue } from "../../src";

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

  it("snapshots domain events and document snapshots inside document realtime payloads", () => {
    const event: DomainEvent = {
      id: "evt-snapshot",
      tenantId: "acme",
      stream: "acme:Note:One",
      sequence: 1,
      type: "NoteUpdated",
      doctype: "Note",
      documentName: "One",
      actorId: "owner@example.com",
      occurredAt: now,
      payload: { kind: "DocumentUpdated", patch: { title: "One", tags: ["first"] } },
      metadata: { source: "desk", nested: { attempt: 1 } }
    };
    const snapshot: DocumentSnapshot = {
      tenantId: "acme",
      doctype: "Note",
      name: "One",
      version: 2,
      docstatus: "draft",
      data: { title: "One", nested: { count: 1 } },
      createdAt: now,
      updatedAt: now
    };

    const realtime = realtimeEventFromDomainEvent(event, snapshot);

    (((event.payload as DocumentData).patch as DocumentData).tags as JsonValue[]).push("caller");
    ((event.metadata as DocumentData).nested as DocumentData).attempt = 2;
    (snapshot.data.nested as DocumentData).count = 2;

    expect(realtime.payload).toMatchObject({
      event: {
        payload: { kind: "DocumentUpdated", patch: { title: "One", tags: ["first"] } },
        metadata: { source: "desk", nested: { attempt: 1 } }
      },
      snapshot: { data: { title: "One", nested: { count: 1 } } }
    });

    const payload = realtime.payload as DocumentData;
    const payloadEvent = payload.event as DocumentData;
    const payloadSnapshot = payload.snapshot as DocumentData;
    ((((payloadEvent.payload as DocumentData).patch as DocumentData).tags as JsonValue[])).push("returned");
    ((payloadSnapshot.data as DocumentData).nested as DocumentData).count = 3;

    expect(event).toMatchObject({
      payload: { kind: "DocumentUpdated", patch: { title: "One", tags: ["first", "caller"] } },
      metadata: { source: "desk", nested: { attempt: 2 } }
    });
    expect(snapshot).toMatchObject({
      data: { title: "One", nested: { count: 2 } }
    });
  });

  it("models transient document field edit intent as a document-scoped realtime event", () => {
    expect(
      realtimeEventFromDocumentFieldEdit({
        id: "edit-1",
        topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
        connection: {
          connectionId: "conn-1",
          tenantId: "acme",
          userId: "owner@example.com"
        },
        message: {
          type: DOCUMENT_FIELD_EDIT_MESSAGE_TYPE,
          field: " title ",
          editing: true,
          value: "Draft title"
        },
        occurredAt: now
      })
    ).toEqual({
      id: "edit-1",
      type: DOCUMENT_FIELD_EDIT_EVENT_TYPE,
      topics: ["document:acme:Task:TASK-1"],
      tenantId: "acme",
      occurredAt: now,
      payload: {
        kind: DOCUMENT_FIELD_EDIT_EVENT_TYPE,
        tenantId: "acme",
        doctype: "Task",
        name: "TASK-1",
        field: "title",
        editing: true,
        value: "Draft title",
        connectionId: "conn-1",
        actorId: "owner@example.com"
      }
    });

    expect(
      realtimeEventFromDocumentFieldEdit({
        id: "edit-2",
        topic: doctypeRealtimeTopic("acme", "Task"),
        connection: { connectionId: "conn-1" },
        message: { type: DOCUMENT_FIELD_EDIT_MESSAGE_TYPE, field: "title" },
        occurredAt: now
      })
    ).toBeNull();
    expect(
      realtimeEventFromDocumentFieldEdit({
        id: "edit-3",
        topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
        connection: { connectionId: "conn-1" },
        message: { type: DOCUMENT_FIELD_EDIT_MESSAGE_TYPE, field: "" },
        occurredAt: now
      })
    ).toBeNull();
  });

  it("snapshots transient field-edit values inside document realtime payloads", () => {
    const value = { nested: { count: 1 } };
    const event = realtimeEventFromDocumentFieldEdit({
      id: "edit-snapshot",
      topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
      connection: {
        connectionId: "conn-1",
        tenantId: "acme",
        userId: "owner@example.com"
      },
      message: {
        type: DOCUMENT_FIELD_EDIT_MESSAGE_TYPE,
        field: "payload",
        value
      },
      occurredAt: now
    })!;

    value.nested.count = 2;

    expect(event.payload).toMatchObject({
      value: { nested: { count: 1 } }
    });

    (((event.payload as DocumentData).value as DocumentData).nested as DocumentData).count = 3;
    expect(value).toEqual({ nested: { count: 2 } });
  });

  it("models transient shared draft patches as document-scoped collaboration events", () => {
    expect(
      realtimeEventFromDocumentSharedDraft({
        id: "draft-1",
        topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
        connection: {
          connectionId: "conn-1",
          tenantId: "acme",
          userId: "owner@example.com"
        },
        message: {
          type: DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE,
          baseVersion: 3,
          patch: { " title ": "Draft title", priority: "High" },
          unset: [" obsolete "],
          actorId: "spoof@example.com"
        },
        occurredAt: now
      })
    ).toEqual({
      id: "draft-1",
      type: DOCUMENT_SHARED_DRAFT_EVENT_TYPE,
      topics: ["document:acme:Task:TASK-1"],
      tenantId: "acme",
      occurredAt: now,
      payload: {
        kind: DOCUMENT_SHARED_DRAFT_EVENT_TYPE,
        tenantId: "acme",
        doctype: "Task",
        name: "TASK-1",
        baseVersion: 3,
        patch: { title: "Draft title", priority: "High" },
        unset: ["obsolete"],
        connectionId: "conn-1",
        actorId: "owner@example.com"
      }
    });

    expect(
      realtimeEventFromDocumentSharedDraft({
        id: "draft-2",
        topic: doctypeRealtimeTopic("acme", "Task"),
        connection: { connectionId: "conn-1" },
        message: { type: DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE, patch: { title: "Draft" } },
        occurredAt: now
      })
    ).toBeNull();
    expect(
      realtimeEventFromDocumentSharedDraft({
        id: "draft-3",
        topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
        connection: { connectionId: "conn-1" },
        message: { type: DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE, baseVersion: -1, patch: { title: "Draft" } },
        occurredAt: now
      })
    ).toBeNull();
    expect(
      realtimeEventFromDocumentSharedDraft({
        id: "draft-4",
        topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
        connection: { connectionId: "conn-1" },
        message: { type: DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE, patch: { title: "Draft" }, unset: ["title"] },
        occurredAt: now
      })
    ).toBeNull();
  });

  it("snapshots transient shared draft patches inside document realtime payloads", () => {
    const patch = { " payload ": { nested: { count: 1 } } };
    const unset = [" obsolete "];
    const event = realtimeEventFromDocumentSharedDraft({
      id: "draft-snapshot",
      topic: documentRealtimeTopic("acme", "Task", "TASK-1"),
      connection: {
        connectionId: "conn-1",
        tenantId: "acme",
        userId: "owner@example.com"
      },
      message: {
        type: DOCUMENT_SHARED_DRAFT_MESSAGE_TYPE,
        patch,
        unset
      },
      occurredAt: now
    })!;

    patch[" payload "].nested.count = 2;
    unset.push("later");

    expect(event.payload).toMatchObject({
      patch: { payload: { nested: { count: 1 } } },
      unset: ["obsolete"]
    });

    const payload = event.payload as DocumentData;
    (((payload.patch as DocumentData).payload as DocumentData).nested as DocumentData).count = 3;
    (payload.unset as JsonValue[]).push("returned");
    expect(patch).toEqual({ " payload ": { nested: { count: 2 } } });
    expect(unset).toEqual([" obsolete ", "later"]);
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
      },
      {
        type: "NoteShared",
        payload: { kind: "DocumentShared", userId: "collab@example.com", permissions: ["read"] },
        recipientId: "collab@example.com"
      },
      {
        type: "NoteShareRevoked",
        payload: { kind: "DocumentShareRevoked", userId: "collab@example.com" },
        recipientId: "collab@example.com"
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
