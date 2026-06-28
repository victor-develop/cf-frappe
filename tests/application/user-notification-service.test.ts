import {
  createDocumentNotificationHooks,
  InMemoryEventStore,
  UserNotificationService,
  deterministicIds,
  fixedClock,
  userNotificationsStream
} from "../../src";
import { createServices, data, now, owner } from "../helpers";
import type { DocumentEventPayload, DomainEvent, NewDomainEvent, StreamName, UserNotificationEventPayload } from "../../src";
import type { EventStore } from "../../src/ports/event-store";

describe("UserNotificationService", () => {
  it("registers user notification payloads through the domain event extension map", () => {
    const payload = userNotificationPayload({
      kind: "UserNotificationRecorded",
      notificationId: "evt_assign:user:support%40example.com",
      sourceEventId: "evt_assign",
      eventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      recipientId: "support@example.com",
      doctype: "Note",
      documentName: "My Note",
      actorId: "owner@example.com",
      subject: "owner@example.com assigned you to Note My Note"
    });

    expect(payload.subject).toBe("owner@example.com assigned you to Note My Note");
  });

  it("records redacted user notifications from committed document events", async () => {
    const events = new InMemoryEventStore();
    const notifications = new UserNotificationService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["record-1"])
    });
    const event = assignmentEvent("evt_assign", "support@example.com");

    await expect(notifications.recordFromDomainEvent(event)).resolves.toMatchObject([
      {
        id: "evt_assign:user:support%40example.com",
        tenantId: "acme",
        recipientId: "support@example.com",
        sourceEventId: "evt_assign",
        payloadKind: "DocumentAssigned",
        doctype: "Note",
        documentName: "My Note",
        subject: "owner@example.com assigned you to Note My Note",
        read: false,
        dismissed: false
      }
    ]);
    await expect(notifications.recordFromDomainEvent(event)).resolves.toHaveLength(1);
    await expect(events.readStream(userNotificationsStream("acme", "support@example.com"))).resolves.toHaveLength(1);
  });

  it("fails explicitly when recording append returns no persisted event", async () => {
    const events = new EmptyAppendNotificationEventStore();
    const notifications = new UserNotificationService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["record-1"])
    });

    await expect(notifications.recordFromDomainEvent(assignmentEvent("evt_assign", "support@example.com"))).rejects.toThrow(
      "User notification append for 'evt_assign:user:support%40example.com' and user 'support@example.com' in tenant 'acme' did not return 'UserNotificationRecorded'"
    );
    expect(events.appended).toMatchObject([
      {
        stream: userNotificationsStream("acme", "support@example.com"),
        payload: { kind: "UserNotificationRecorded", notificationId: "evt_assign:user:support%40example.com" }
      }
    ]);
  });

  it("retries user notification appends when another document commit wins the recipient stream", async () => {
    const events = new RacingNotificationEventStore();
    const notifications = new UserNotificationService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["first-attempt", "retry"])
    });

    await expect(notifications.recordFromDomainEvent(assignmentEvent("evt_assign", "support@example.com"))).resolves.toMatchObject([
      { id: "evt_assign:user:support%40example.com" }
    ]);

    const stream = userNotificationsStream("acme", "support@example.com");
    await expect(events.readStream(stream)).resolves.toHaveLength(2);
    await expect(notifications.inbox({ id: "support@example.com", roles: ["User"], tenantId: "acme" }, { includeDismissed: true }))
      .resolves.toMatchObject({
        notifications: expect.arrayContaining([
          expect.objectContaining({ id: "evt_assign:user:support%40example.com" }),
          expect.objectContaining({ id: "evt_other:user:support%40example.com" })
        ])
      });
  });

  it("folds read and dismissed state from the user notification stream", async () => {
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      clock: fixedClock("2026-01-01T01:00:00.000Z"),
      ids: deterministicIds(["record-1", "read-1", "dismiss-1"])
    });
    const support = { id: "support@example.com", roles: ["User"], tenantId: "acme" };
    await notifications.recordFromDomainEvent(assignmentEvent("evt_assign", "support@example.com"));
    const id = "evt_assign:user:support%40example.com";

    await expect(notifications.markRead(support, id)).resolves.toMatchObject({
      id,
      read: true,
      readAt: "2026-01-01T01:00:00.000Z",
      readBy: "support@example.com"
    });
    await expect(notifications.dismiss(support, id)).resolves.toMatchObject({
      id,
      dismissed: true,
      dismissedAt: "2026-01-01T01:00:00.000Z",
      dismissedBy: "support@example.com"
    });
    await expect(notifications.inbox(support)).resolves.toMatchObject({
      unreadCount: 0,
      notifications: []
    });
    await expect(notifications.inbox(support, { includeDismissed: true })).resolves.toMatchObject({
      notifications: [{ id, read: true, dismissed: true }]
    });
  });

  it("fails explicitly when a read notification cannot be replayed after append", async () => {
    const events = new ReplayMissingNotificationEventStore();
    const notifications = new UserNotificationService({
      events,
      clock: fixedClock("2026-01-01T01:00:00.000Z"),
      ids: deterministicIds(["read-1"])
    });
    const support = { id: "support@example.com", roles: ["User"], tenantId: "acme" };
    const id = "evt_assign:user:support%40example.com";

    await expect(notifications.markRead(support, id)).rejects.toThrow(
      "Notification 'evt_assign:user:support%40example.com' for user 'support@example.com' in tenant 'acme' was not found after replay"
    );
    expect(events.appended).toMatchObject([
      {
        stream: userNotificationsStream("acme", "support@example.com"),
        payload: { kind: "UserNotificationRead", notificationId: id }
      }
    ]);
  });

  it("keeps user inboxes private unless inspected by a system manager", async () => {
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      ids: deterministicIds(["record-1"])
    });
    const support = { id: "support@example.com", roles: ["User"], tenantId: "acme" };
    const other = { id: "other@example.com", roles: ["User"], tenantId: "acme" };
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    await notifications.recordFromDomainEvent(assignmentEvent("evt_assign", "support@example.com"));

    await expect(notifications.inbox(other, { userId: "support@example.com" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(notifications.inbox(admin, { userId: "support@example.com" })).resolves.toMatchObject({
      userId: "support@example.com",
      notifications: [{ id: "evt_assign:user:support%40example.com" }]
    });
    await expect(notifications.inbox(support, { unreadOnly: true })).resolves.toMatchObject({
      unreadCount: 1,
      notifications: [{ read: false }]
    });
  });

  it("records notifications through document afterCommit hooks", async () => {
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      ids: deterministicIds(["record-1"])
    });
    const hooks = createDocumentNotificationHooks(notifications);
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Notify" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Notify",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    await expect(notifications.inbox({ id: "support@example.com", roles: ["User"], tenantId: "acme" })).resolves.toMatchObject({
      notifications: [
        {
          sourceEventId: "evt_assign-1",
          documentName: "Notify"
        }
      ]
    });
  });
});

function assignmentEvent(id: string, assigneeId: string): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Note:My Note",
    sequence: 2,
    type: "NoteAssigned",
    doctype: "Note",
    documentName: "My Note",
    actorId: "owner@example.com",
    occurredAt: now,
    payload: { kind: "DocumentAssigned", assigneeId },
    metadata: {}
  };
}

function userNotificationPayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "UserNotificationRecorded" }>
): Extract<UserNotificationEventPayload, { readonly kind: "UserNotificationRecorded" }> {
  return payload;
}

class RacingNotificationEventStore implements EventStore {
  private readonly delegate = new InMemoryEventStore();
  private raced = false;

  async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    if (!this.raced && stream === userNotificationsStream("acme", "support@example.com")) {
      this.raced = true;
      await this.delegate.append(stream, expectedVersion, [concurrentNotificationEvent(stream)]);
    }
    return this.delegate.append(stream, expectedVersion, events);
  }

  readStream(stream: StreamName, options?: Parameters<EventStore["readStream"]>[1]): Promise<readonly DomainEvent[]> {
    return this.delegate.readStream(stream, options);
  }

  currentVersion(stream: StreamName): Promise<number> {
    return this.delegate.currentVersion(stream);
  }
}

class EmptyAppendNotificationEventStore implements EventStore {
  readonly appended: NewDomainEvent[] = [];

  async append(
    _stream: StreamName,
    _expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    this.appended.push(...events);
    return [];
  }

  async readStream(_stream: StreamName): Promise<readonly DomainEvent[]> {
    return [];
  }

  async currentVersion(_stream: StreamName): Promise<number> {
    return 0;
  }
}

class ReplayMissingNotificationEventStore implements EventStore {
  readonly appended: NewDomainEvent[] = [];

  async append(
    _stream: StreamName,
    _expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    this.appended.push(...events);
    return events.map((event, index) => ({
      ...event,
      sequence: index + 2
    }));
  }

  async readStream(stream: StreamName): Promise<readonly DomainEvent[]> {
    if (this.appended.length > 0) {
      return [];
    }
    return [recordedNotificationEvent(stream)];
  }

  async currentVersion(_stream: StreamName): Promise<number> {
    return this.appended.length === 0 ? 1 : 0;
  }
}

function concurrentNotificationEvent(stream: StreamName): NewDomainEvent {
  return {
    id: "evt_concurrent",
    tenantId: "acme",
    stream,
    type: "UserNotificationRecorded",
    doctype: "__UserNotifications",
    documentName: "support@example.com",
    actorId: "manager@example.com",
    occurredAt: now,
    payload: {
      kind: "UserNotificationRecorded",
      notificationId: "evt_other:user:support%40example.com",
      sourceEventId: "evt_other",
      eventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      recipientId: "support@example.com",
      doctype: "Note",
      documentName: "Other Note",
      actorId: "manager@example.com"
    },
    metadata: {}
  };
}

function recordedNotificationEvent(stream: StreamName): DomainEvent {
  return {
    ...concurrentNotificationEvent(stream),
    id: "evt_recorded",
    sequence: 1,
    actorId: "owner@example.com",
    payload: {
      kind: "UserNotificationRecorded",
      notificationId: "evt_assign:user:support%40example.com",
      sourceEventId: "evt_assign",
      eventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      recipientId: "support@example.com",
      doctype: "Note",
      documentName: "My Note",
      actorId: "owner@example.com",
      subject: "owner@example.com assigned you to Note My Note"
    }
  };
}
