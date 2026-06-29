import {
  emailAddressPayload,
  emailDeliveryClaimTimeoutMs,
  emailNotificationErrorMessage,
  emailNotificationQueuedPayloadInput,
  failedEmailNotificationDelivery,
  isSkippedEmailNotificationQueueResult,
  looksLikeEmailAddress,
  missingEmailRecipientReason,
  queueResultFromOutboxRecord,
  queuedEmailNotificationResult,
  sentEmailNotificationDelivery,
  skippedEmailNotificationQueueResult,
  type DocumentEmailNotificationQueueResult,
  type EmailOutboxRecord,
  type EmailOutboxRecordEntry
} from "../../src";

describe("email notification service policy", () => {
  it("normalizes delivery claim timeouts", () => {
    expect(emailDeliveryClaimTimeoutMs(undefined)).toBe(300_000);
    expect(emailDeliveryClaimTimeoutMs(60)).toBe(60_000);
    expect(emailDeliveryClaimTimeoutMs(0)).toBe(0);
  });

  it("builds email address payloads without empty optional names", () => {
    expect(emailAddressPayload({ email: "sender@example.com" })).toEqual({ email: "sender@example.com" });
    expect(emailAddressPayload({ email: "sender@example.com", name: "Sender" })).toEqual({
      email: "sender@example.com",
      name: "Sender"
    });
  });

  it("builds queued outbox payload support data from notification metadata", () => {
    expect(emailNotificationQueuedPayloadInput({
      messageId: "evt_update:rule:Email%20owners:email:user_123",
      notification: {
        kind: "DocumentEmailNotification",
        eventId: "evt_update",
        eventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        tenantId: "acme",
        doctype: "Note",
        documentName: "My Note",
        actorId: "owner@example.com",
        recipientId: "user_123",
        subject: "Note changed",
        text: "Body",
        ruleName: "Email owners"
      },
      from: { email: "notifications@example.com", name: "cf-frappe" },
      to: { email: "reviewer@example.com" }
    })).toEqual({
      from: { email: "notifications@example.com", name: "cf-frappe" },
      to: { email: "reviewer@example.com" },
      headers: {
        "X-CF-Frappe-Event": "evt_update",
        "X-CF-Frappe-Rule": "Email owners"
      }
    });
  });

  it("projects queued and skipped queue results", () => {
    expect(queuedEmailNotificationResult({
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note changed"
    })).toEqual({
      status: "queued",
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note changed"
    });
    expect(skippedEmailNotificationQueueResult({
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      reason: missingEmailRecipientReason("user_123")
    })).toEqual({
      status: "skipped",
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      reason: "No deliverable email address for user 'user_123'"
    });
  });

  it("projects replayable queue results from existing outbox records", () => {
    expect(queueResultFromOutboxRecord(record({ status: "queued" }))).toEqual({
      status: "queued",
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note changed"
    });
    expect(queueResultFromOutboxRecord(skippedRecord())).toEqual({
      status: "skipped",
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      reason: "No deliverable email address for user 'user_123'"
    });
    expect(queueResultFromOutboxRecord(record({ status: "sent" }))).toBeUndefined();
  });

  it("projects sent and failed delivery results from claimed outbox records", () => {
    const claim = record({ status: "claimed", claimId: "claim-1", claimedAt: "2026-01-01T00:00:00.000Z" });

    expect(sentEmailNotificationDelivery({ messageId: claim.messageId, claim, sent: { id: "cf-msg-1" } })).toEqual({
      status: "sent",
      messageId: "message-1",
      providerMessageId: "cf-msg-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note changed"
    });
    expect(failedEmailNotificationDelivery({ messageId: claim.messageId, claim, error: "provider rejected" })).toEqual({
      status: "failed",
      messageId: "message-1",
      eventId: "evt_update",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note changed",
      error: "provider rejected"
    });
  });

  it("narrows skipped queue results for delivery result reuse", () => {
    const deliveries: readonly DocumentEmailNotificationQueueResult[] = [
      skippedEmailNotificationQueueResult({
        messageId: "message-1",
        eventId: "evt_update",
        ruleName: "Email owners",
        recipientId: "user_123",
        reason: "No deliverable email address for user 'user_123'"
      }),
      queuedEmailNotificationResult({
        messageId: "message-2",
        eventId: "evt_update",
        ruleName: "Email owners",
        recipientId: "user_456",
        to: "reviewer@example.com",
        subject: "Note changed"
      })
    ];

    expect(deliveries.filter(isSkippedEmailNotificationQueueResult)).toEqual([
      expect.objectContaining({ status: "skipped", messageId: "message-1" })
    ]);
  });

  it("classifies fallback email addresses and error messages", () => {
    expect(looksLikeEmailAddress("reviewer@example.com")).toBe(true);
    expect(looksLikeEmailAddress("not an email")).toBe(false);
    expect(emailNotificationErrorMessage(new Error("provider down"))).toBe("provider down");
    expect(emailNotificationErrorMessage("plain failure")).toBe("plain failure");
  });
});

function record(overrides: Partial<EmailOutboxRecord> = {}): EmailOutboxRecord {
  return {
    messageId: "message-1",
    status: "queued",
    sourceEventId: "evt_update",
    sourceEventType: "NoteUpdated",
    payloadKind: "DocumentUpdated",
    ruleName: "Email owners",
    recipientId: "user_123",
    from: { email: "notifications@example.com" },
    to: { email: "reviewer@example.com" },
    subject: "Note changed",
    text: "Body",
    ...overrides
  };
}

function skippedRecord(): EmailOutboxRecordEntry {
  return {
    messageId: "message-1",
    status: "skipped",
    sourceEventId: "evt_update",
    sourceEventType: "NoteUpdated",
    payloadKind: "DocumentUpdated",
    ruleName: "Email owners",
    recipientId: "user_123"
  };
}
