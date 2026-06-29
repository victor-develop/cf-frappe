import {
  claimedDeliveryId,
  emailNotificationEventType,
  emailNotificationMessageId,
  foldEmailOutbox,
  isStaleEmailClaim,
  requireAppendedEmailOutboxEvent
} from "../../src";
import type { DomainEvent, EmailNotificationEventPayload } from "../../src";

describe("email notification events", () => {
  it("folds queued, claimed, failed, and sent outbox records by sequence", () => {
    const messageId = emailNotificationMessageId("evt_update", "Email owners", "reviewer@example.com");
    const state = foldEmailOutbox("acme", [
      failedEvent(3, messageId, "claim_first", "temporary provider outage"),
      queuedEvent(1, messageId),
      claimedEvent(4, messageId, "claim_retry", "2026-01-01T00:05:00.000Z"),
      sentEvent(5, messageId, "claim_retry", "cf-msg-1"),
      claimedEvent(2, messageId, "claim_first", "2026-01-01T00:01:00.000Z")
    ]);

    expect(state.version).toBe(5);
    expect(state.messages.get(messageId)).toMatchObject({
      status: "sent",
      claimId: "claim_retry",
      claimedAt: "2026-01-01T00:05:00.000Z",
      providerMessageId: "cf-msg-1",
      error: "temporary provider outage"
    });
  });

  it("ignores completion events that do not match the active claim", () => {
    const messageId = emailNotificationMessageId("evt_update", "Email owners", "reviewer@example.com");
    const state = foldEmailOutbox("acme", [
      queuedEvent(1, messageId),
      claimedEvent(2, messageId, "claim_active", "2026-01-01T00:01:00.000Z"),
      sentEvent(3, messageId, "claim_other", "cf-msg-other")
    ]);

    expect(state.messages.get(messageId)).toMatchObject({
      status: "claimed",
      claimId: "claim_active"
    });
    expect(state.messages.get(messageId)).not.toHaveProperty("providerMessageId");
  });

  it("derives ids and guards append, claim, and stale-claim invariants", () => {
    const messageId = emailNotificationMessageId("evt_update", "Email owners", "reviewer+ops@example.com");
    expect(messageId).toBe("evt_update:rule:Email%20owners:email:reviewer%2Bops%40example.com");
    expect(() => requireAppendedEmailOutboxEvent(undefined, "acme", messageId, "EmailNotificationQueued")).toThrow(
      `Email outbox append for '${messageId}' in tenant 'acme' did not return 'EmailNotificationQueued'`
    );
    expect(() => claimedDeliveryId({
      ...queuedRecord(messageId),
      status: "claimed",
      claimedAt: "2026-01-01T00:00:00.000Z"
    }, messageId)).toThrow(`Claimed email outbox message '${messageId}' has no claim id`);
    expect(isStaleEmailClaim({
      ...queuedRecord(messageId),
      status: "claimed",
      claimId: "claim_active",
      claimedAt: "2026-01-01T00:00:00.000Z"
    }, "2026-01-01T00:05:00.000Z", 300_000)).toBe(true);
  });

  it("derives email notification event types from payload identity", () => {
    const messageId = emailNotificationMessageId("evt_update", "Email owners", "reviewer@example.com");
    expect(emailNotificationEventType(queuedPayload(messageId))).toBe("EmailNotificationQueued");
    expect(emailNotificationEventType({
      kind: "EmailNotificationDeliveryClaimed",
      messageId,
      claimId: "claim_1"
    })).toBe("EmailNotificationDeliveryClaimed");
    expect(emailNotificationEventType({
      kind: "EmailNotificationSent",
      messageId,
      claimId: "claim_1",
      providerMessageId: "cf-msg-1"
    })).toBe("EmailNotificationSent");
    expect(emailNotificationEventType({
      kind: "EmailNotificationFailed",
      messageId,
      claimId: "claim_1",
      error: "temporary provider outage"
    })).toBe("EmailNotificationFailed");
    expect(emailNotificationEventType({
      kind: "EmailNotificationSkipped",
      messageId,
      sourceEventId: "evt_update",
      sourceEventType: "NoteUpdated",
      payloadKind: "DocumentUpdated",
      ruleName: "Email owners",
      recipientId: "reviewer@example.com",
      reason: "recipient has no email address"
    })).toBe("EmailNotificationSkipped");
  });
});

function queuedEvent(sequence: number, messageId: string): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: `acme:__EmailOutbox:${messageId}`,
    sequence,
    type: "EmailNotificationQueued",
    doctype: "__EmailOutbox",
    documentName: messageId,
    actorId: "system:email-outbox",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: queuedPayload(messageId),
    metadata: {}
  };
}

function queuedPayload(
  messageId: string
): Extract<EmailNotificationEventPayload, { readonly kind: "EmailNotificationQueued" }> {
  return {
    kind: "EmailNotificationQueued",
    messageId,
    sourceEventId: "evt_update",
    sourceEventType: "NoteUpdated",
    payloadKind: "DocumentUpdated",
    ruleName: "Email owners",
    recipientId: "reviewer@example.com",
    from: { email: "notifications@example.com" },
    to: { email: "reviewer@example.com" },
    subject: "Note My Note changed",
    text: "Note My Note changed"
  };
}

function claimedEvent(sequence: number, messageId: string, claimId: string, occurredAt: string): DomainEvent {
  return stateEvent(sequence, messageId, {
    kind: "EmailNotificationDeliveryClaimed",
    messageId,
    claimId
  }, occurredAt);
}

function failedEvent(sequence: number, messageId: string, claimId: string, error: string): DomainEvent {
  return stateEvent(sequence, messageId, {
    kind: "EmailNotificationFailed",
    messageId,
    claimId,
    error
  }, "2026-01-01T00:03:00.000Z");
}

function sentEvent(sequence: number, messageId: string, claimId: string, providerMessageId: string): DomainEvent {
  return stateEvent(sequence, messageId, {
    kind: "EmailNotificationSent",
    messageId,
    claimId,
    providerMessageId
  }, "2026-01-01T00:06:00.000Z");
}

function stateEvent(sequence: number, messageId: string, payload: DomainEvent["payload"], occurredAt: string): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: `acme:__EmailOutbox:${messageId}`,
    sequence,
    type: payload.kind,
    doctype: "__EmailOutbox",
    documentName: messageId,
    actorId: "system:email-outbox",
    occurredAt,
    payload,
    metadata: {}
  };
}

function queuedRecord(messageId: string) {
  return {
    messageId,
    sourceEventId: "evt_update",
    sourceEventType: "NoteUpdated",
    payloadKind: "DocumentUpdated",
    ruleName: "Email owners",
    recipientId: "reviewer@example.com",
    from: { email: "notifications@example.com" },
    to: { email: "reviewer@example.com" },
    subject: "Note My Note changed",
    text: "Note My Note changed"
  };
}
