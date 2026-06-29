import {
  foldUserNotifications,
  isUserNotificationEvent,
  isUserNotificationPayloadKind,
  notificationIdentity,
  requireAppendedUserNotificationEvent,
  requireReplayedNotification,
  sortedUserNotifications,
  USER_NOTIFICATION_PAYLOAD_KINDS,
  userNotificationEventType,
  userNotificationSubject
} from "../../src";
import type { DomainEvent } from "../../src";

describe("user notification events", () => {
  it("folds recorded, read, and dismissed events by sequence", () => {
    const state = foldUserNotifications("acme", "support@example.com", [
      readEvent("evt_read", 2, "evt_assign:user:support%40example.com"),
      recordedEvent("evt_assign", 1, {
        notificationId: "evt_assign:user:support%40example.com",
        sourceEventId: "evt_assign",
        documentName: "Alpha Note",
        occurredAt: "2026-01-01T00:00:00.000Z"
      }),
      dismissedEvent("evt_dismiss", 3, "evt_assign:user:support%40example.com")
    ]);

    expect(state.version).toBe(3);
    expect(requireReplayedNotification(state, "evt_assign:user:support%40example.com")).toMatchObject({
      id: "evt_assign:user:support%40example.com",
      read: true,
      readAt: "2026-01-01T00:02:00.000Z",
      readBy: "support@example.com",
      dismissed: true,
      dismissedAt: "2026-01-01T00:03:00.000Z",
      dismissedBy: "support@example.com"
    });
  });

  it("sorts inbox records newest first with deterministic id ties", () => {
    const state = foldUserNotifications("acme", "support@example.com", [
      recordedEvent("evt_old", 1, {
        notificationId: "evt_old:user:support%40example.com",
        sourceEventId: "evt_old",
        documentName: "Old Note",
        occurredAt: "2026-01-01T00:00:00.000Z"
      }),
      recordedEvent("evt_b", 2, {
        notificationId: "evt_b:user:support%40example.com",
        sourceEventId: "evt_b",
        documentName: "Beta Note",
        occurredAt: "2026-01-02T00:00:00.000Z"
      }),
      recordedEvent("evt_c", 3, {
        notificationId: "evt_c:user:support%40example.com",
        sourceEventId: "evt_c",
        documentName: "Gamma Note",
        occurredAt: "2026-01-02T00:00:00.000Z"
      })
    ]);

    expect(sortedUserNotifications(state).map((notification) => notification.id)).toEqual([
      "evt_c:user:support%40example.com",
      "evt_b:user:support%40example.com",
      "evt_old:user:support%40example.com"
    ]);
  });

  it("derives stable identities, subjects, and append invariants", () => {
    expect(notificationIdentity({
      kind: "DocumentUserNotification",
      eventId: "evt_assign",
      eventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      tenantId: "acme",
      recipientId: "support+queue@example.com",
      doctype: "Note",
      documentName: "Alpha Note",
      actorId: "owner@example.com",
      ruleName: "Escalation Rule"
    })).toBe("evt_assign:rule:Escalation%20Rule:user:support%2Bqueue%40example.com");
    expect(userNotificationSubject({
      kind: "UserNotificationRecorded",
      notificationId: "evt_assign:user:support%40example.com",
      sourceEventId: "evt_assign",
      eventType: "NoteAssigned",
      payloadKind: "DocumentShareRevoked",
      recipientId: "support@example.com",
      doctype: "Note",
      documentName: "Alpha Note",
      actorId: "owner@example.com"
    })).toBe("owner@example.com revoked your share on Note Alpha Note");
    expect(() => requireAppendedUserNotificationEvent(
      undefined,
      "acme",
      "support@example.com",
      "evt_assign:user:support%40example.com",
      "UserNotificationRecorded"
    )).toThrow(
      "User notification append for 'evt_assign:user:support%40example.com' and user 'support@example.com' in tenant 'acme' did not return 'UserNotificationRecorded'"
    );
  });

  it("derives user notification event types from payload identity", () => {
    expect(userNotificationEventType({
      kind: "UserNotificationRecorded",
      notificationId: "evt_assign:user:support%40example.com",
      sourceEventId: "evt_assign",
      eventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      recipientId: "support@example.com",
      doctype: "Note",
      documentName: "Alpha Note",
      actorId: "owner@example.com"
    })).toBe("UserNotificationRecorded");
    expect(userNotificationEventType({
      kind: "UserNotificationRead",
      notificationId: "evt_assign:user:support%40example.com"
    })).toBe("UserNotificationRead");
    expect(userNotificationEventType({
      kind: "UserNotificationDismissed",
      notificationId: "evt_assign:user:support%40example.com"
    })).toBe("UserNotificationDismissed");
  });

  it("exposes the bounded user notification payload kind set", () => {
    expect(USER_NOTIFICATION_PAYLOAD_KINDS).toEqual([
      "UserNotificationRecorded",
      "UserNotificationRead",
      "UserNotificationDismissed"
    ]);
  });

  it("narrows user notification events by payload kind when event type names are custom", () => {
    const recorded = {
      ...recordedEvent("evt_assign", 1, {
        notificationId: "evt_assign:user:support%40example.com",
        sourceEventId: "evt_assign",
        documentName: "Alpha Note",
        occurredAt: "2026-01-01T00:00:00.000Z"
      }),
      type: "DeskNotificationCreated"
    };

    expect(isUserNotificationPayloadKind("UserNotificationRecorded")).toBe(true);
    expect(isUserNotificationPayloadKind("DocumentDeleted")).toBe(false);
    expect(isUserNotificationEvent(recorded)).toBe(true);
    expect(isUserNotificationEvent(otherEvent({ kind: "DocumentDeleted" }))).toBe(false);
  });
});

function otherEvent(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_other",
    tenantId: "acme",
    stream: "acme:Note:Alpha Note",
    sequence: 1,
    type,
    doctype: "Note",
    documentName: "Alpha Note",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}

function recordedEvent(
  id: string,
  sequence: number,
  options: {
    readonly notificationId: string;
    readonly sourceEventId: string;
    readonly documentName: string;
    readonly occurredAt: string;
  }
): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:__UserNotifications:support@example.com",
    sequence,
    type: "UserNotificationRecorded",
    doctype: "__UserNotifications",
    documentName: "support@example.com",
    actorId: "owner@example.com",
    occurredAt: options.occurredAt,
    payload: {
      kind: "UserNotificationRecorded",
      notificationId: options.notificationId,
      sourceEventId: options.sourceEventId,
      eventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      recipientId: "support@example.com",
      doctype: "Note",
      documentName: options.documentName,
      actorId: "owner@example.com"
    },
    metadata: {}
  };
}

function readEvent(id: string, sequence: number, notificationId: string): DomainEvent {
  return stateEvent(id, sequence, "UserNotificationRead", notificationId, "2026-01-01T00:02:00.000Z");
}

function dismissedEvent(id: string, sequence: number, notificationId: string): DomainEvent {
  return stateEvent(id, sequence, "UserNotificationDismissed", notificationId, "2026-01-01T00:03:00.000Z");
}

function stateEvent(
  id: string,
  sequence: number,
  kind: "UserNotificationRead" | "UserNotificationDismissed",
  notificationId: string,
  occurredAt: string
): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:__UserNotifications:support@example.com",
    sequence,
    type: kind,
    doctype: "__UserNotifications",
    documentName: "support@example.com",
    actorId: "support@example.com",
    occurredAt,
    payload: {
      kind,
      notificationId
    },
    metadata: {}
  };
}
