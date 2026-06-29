import {
  emailNotificationDeliveryIdempotencyKey,
  emailNotificationDeliveryRequiredString,
  emailNotificationDeliveryResultJson,
  parseEmailNotificationDeliveryJobMessageId
} from "../../src/application/email-notification-job-policy.js";
import type { DocumentEmailNotificationDelivery } from "../../src/application/email-notification-service.js";

describe("email notification job policy", () => {
  it("normalizes required delivery strings", () => {
    expect(emailNotificationDeliveryRequiredString("  acme  ", "Email notification delivery tenantId")).toBe("acme");
    expect(() => emailNotificationDeliveryRequiredString(" ", "Email notification delivery tenantId")).toThrow(
      "Email notification delivery tenantId is required"
    );
  });

  it("parses delivery job message ids without trimming payload identity", () => {
    expect(parseEmailNotificationDeliveryJobMessageId(" msg_001 ")).toBe(" msg_001 ");
    expect(() => parseEmailNotificationDeliveryJobMessageId("")).toThrow(
      "Email notification delivery job messageId is invalid"
    );
    expect(() => parseEmailNotificationDeliveryJobMessageId(1)).toThrow(
      "Email notification delivery job messageId is invalid"
    );
  });

  it("builds bounded deterministic delivery idempotency keys", () => {
    const key = emailNotificationDeliveryIdempotencyKey("cf-frappe.email-notifications.deliver", "acme", "msg_001");
    const repeated = emailNotificationDeliveryIdempotencyKey(
      "cf-frappe.email-notifications.deliver",
      "acme",
      "msg_001"
    );
    const long = emailNotificationDeliveryIdempotencyKey(
      "cf-frappe.email-notifications.deliver",
      "acme",
      `evt_update:rule:${"VeryLongRuleName".repeat(20)}:email:${"user".repeat(40)}@example.com`
    );

    expect(key).toBe(repeated);
    expect(key).toMatch(/^cf-frappe\.email-notifications\.deliver:[0-9a-f]{32}:[0-9a-f]{32}$/);
    expect(long.length).toBeLessThanOrEqual(256);
    expect(emailNotificationDeliveryIdempotencyKey("job", "acme", "msg-fhepmp5ifx-9eu")).not.toBe(
      emailNotificationDeliveryIdempotencyKey("job", "acme", "msg-sn2vtehoee-x0n")
    );
  });

  it("shapes missing deliveries as not delivered", () => {
    expect(emailNotificationDeliveryResultJson("msg_001", undefined)).toEqual({
      delivered: false,
      messageId: "msg_001"
    });
  });

  it("shapes sent deliveries as job JSON", () => {
    expect(emailNotificationDeliveryResultJson("msg_001", sentDelivery("msg_001"))).toEqual({
      delivered: true,
      status: "sent",
      messageId: "msg_001",
      eventId: "evt_001",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note My Note changed",
      providerMessageId: "cf-msg-1"
    });
    expect(emailNotificationDeliveryResultJson("msg_002", sentDeliveryWithoutProviderMessage("msg_002"))).toEqual(
      {
        delivered: true,
        status: "sent",
        messageId: "msg_002",
        eventId: "evt_001",
        ruleName: "Email owners",
        recipientId: "user_123",
        to: "reviewer@example.com",
        subject: "Note My Note changed"
      }
    );
  });

  it("shapes skipped and failed deliveries as job JSON", () => {
    expect(
      emailNotificationDeliveryResultJson("msg_skip", {
        status: "skipped",
        messageId: "msg_skip",
        eventId: "evt_001",
        ruleName: "Email owners",
        recipientId: "user_123",
        reason: "No recipient email"
      })
    ).toEqual({
      delivered: true,
      status: "skipped",
      messageId: "msg_skip",
      eventId: "evt_001",
      ruleName: "Email owners",
      recipientId: "user_123",
      reason: "No recipient email"
    });
    expect(
      emailNotificationDeliveryResultJson("msg_fail", {
        status: "failed",
        messageId: "msg_fail",
        eventId: "evt_001",
        ruleName: "Email owners",
        recipientId: "user_123",
        to: "reviewer@example.com",
        subject: "Note My Note changed",
        error: "provider unavailable"
      })
    ).toEqual({
      delivered: true,
      status: "failed",
      messageId: "msg_fail",
      eventId: "evt_001",
      ruleName: "Email owners",
      recipientId: "user_123",
      to: "reviewer@example.com",
      subject: "Note My Note changed",
      error: "provider unavailable"
    });
  });
});

function sentDelivery(messageId: string): DocumentEmailNotificationDelivery {
  return {
    status: "sent",
    messageId,
    providerMessageId: "cf-msg-1",
    eventId: "evt_001",
    ruleName: "Email owners",
    recipientId: "user_123",
    to: "reviewer@example.com",
    subject: "Note My Note changed"
  };
}

function sentDeliveryWithoutProviderMessage(messageId: string): DocumentEmailNotificationDelivery {
  return {
    status: "sent",
    messageId,
    eventId: "evt_001",
    ruleName: "Email owners",
    recipientId: "user_123",
    to: "reviewer@example.com",
    subject: "Note My Note changed"
  };
}
