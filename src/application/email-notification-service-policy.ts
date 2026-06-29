import type { DocumentEmailNotificationPayload } from "../core/notification-rules.js";
import type { EmailAddress, EmailSendResult } from "../ports/email.js";
import type {
  EmailNotificationAddressPayload,
  EmailOutboxRecord,
  EmailOutboxRecordEntry
} from "./email-notification-events.js";

export const DEFAULT_EMAIL_DELIVERY_CLAIM_TIMEOUT_SECONDS = 300;

export type DocumentEmailNotificationDelivery =
  | {
      readonly status: "sent";
      readonly messageId: string;
      readonly providerMessageId?: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly to: string;
      readonly subject: string;
    }
  | {
      readonly status: "failed";
      readonly messageId: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly to: string;
      readonly subject: string;
      readonly error: string;
    }
  | {
      readonly status: "skipped";
      readonly messageId: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly reason: string;
    };

export type DocumentEmailNotificationQueueResult =
  | {
      readonly status: "queued";
      readonly messageId: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly to: string;
      readonly subject: string;
    }
  | Extract<DocumentEmailNotificationDelivery, { readonly status: "skipped" }>;

export function emailDeliveryClaimTimeoutMs(timeoutSeconds: number | undefined): number {
  return (timeoutSeconds ?? DEFAULT_EMAIL_DELIVERY_CLAIM_TIMEOUT_SECONDS) * 1000;
}

export function missingEmailRecipientReason(recipientId: string): string {
  return `No deliverable email address for user '${recipientId}'`;
}

export function emailAddressPayload(address: EmailAddress): EmailNotificationAddressPayload {
  return address.name === undefined
    ? { email: address.email }
    : { email: address.email, name: address.name };
}

export function queueResultFromOutboxRecord(
  record: EmailOutboxRecordEntry
): DocumentEmailNotificationQueueResult | undefined {
  if (record.status === "sent") {
    return undefined;
  }
  if (record.status === "skipped") {
    return skippedEmailNotificationQueueResult({
      messageId: record.messageId,
      eventId: record.sourceEventId,
      ruleName: record.ruleName,
      recipientId: record.recipientId,
      reason: record.reason ?? missingEmailRecipientReason(record.recipientId)
    });
  }
  return queuedEmailNotificationResult({
    messageId: record.messageId,
    eventId: record.sourceEventId,
    ruleName: record.ruleName,
    recipientId: record.recipientId,
    to: record.to.email,
    subject: record.subject
  });
}

export function queuedEmailNotificationResult(input: {
  readonly messageId: string;
  readonly eventId: string;
  readonly ruleName: string;
  readonly recipientId: string;
  readonly to: string;
  readonly subject: string;
}): Extract<DocumentEmailNotificationQueueResult, { readonly status: "queued" }> {
  return {
    status: "queued",
    messageId: input.messageId,
    eventId: input.eventId,
    ruleName: input.ruleName,
    recipientId: input.recipientId,
    to: input.to,
    subject: input.subject
  };
}

export function skippedEmailNotificationQueueResult(input: {
  readonly messageId: string;
  readonly eventId: string;
  readonly ruleName: string;
  readonly recipientId: string;
  readonly reason: string;
}): Extract<DocumentEmailNotificationDelivery, { readonly status: "skipped" }> {
  return {
    status: "skipped",
    messageId: input.messageId,
    eventId: input.eventId,
    ruleName: input.ruleName,
    recipientId: input.recipientId,
    reason: input.reason
  };
}

export function sentEmailNotificationDelivery(input: {
  readonly messageId: string;
  readonly claim: EmailOutboxRecord;
  readonly sent: EmailSendResult;
}): Extract<DocumentEmailNotificationDelivery, { readonly status: "sent" }> {
  return {
    status: "sent",
    messageId: input.messageId,
    ...(input.sent.id === undefined ? {} : { providerMessageId: input.sent.id }),
    eventId: input.claim.sourceEventId,
    ruleName: input.claim.ruleName,
    recipientId: input.claim.recipientId,
    to: input.claim.to.email,
    subject: input.claim.subject
  };
}

export function failedEmailNotificationDelivery(input: {
  readonly messageId: string;
  readonly claim: EmailOutboxRecord;
  readonly error: string;
}): Extract<DocumentEmailNotificationDelivery, { readonly status: "failed" }> {
  return {
    status: "failed",
    messageId: input.messageId,
    eventId: input.claim.sourceEventId,
    ruleName: input.claim.ruleName,
    recipientId: input.claim.recipientId,
    to: input.claim.to.email,
    subject: input.claim.subject,
    error: input.error
  };
}

export function emailNotificationQueuedPayloadInput(input: {
  readonly messageId: string;
  readonly notification: DocumentEmailNotificationPayload;
  readonly from: EmailAddress;
  readonly to: EmailAddress;
}): {
  readonly from: EmailNotificationAddressPayload;
  readonly to: EmailNotificationAddressPayload;
  readonly headers: Readonly<Record<string, string>>;
} {
  return {
    from: emailAddressPayload(input.from),
    to: emailAddressPayload(input.to),
    headers: {
      "X-CF-Frappe-Event": input.notification.eventId,
      "X-CF-Frappe-Rule": input.notification.ruleName
    }
  };
}

export function isSkippedEmailNotificationQueueResult(
  delivery: DocumentEmailNotificationQueueResult
): delivery is Extract<DocumentEmailNotificationDelivery, { readonly status: "skipped" }> {
  return delivery.status === "skipped";
}

export function looksLikeEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function emailNotificationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
