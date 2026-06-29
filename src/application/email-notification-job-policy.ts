import { badRequest, notFound } from "../core/errors.js";
import type { DocumentData } from "../core/types.js";
import type { DocumentEmailNotificationDelivery } from "./email-notification-service.js";

export function ensureEmailNotificationDeliveryServiceAvailable<T>(
  emailNotifications: T | undefined
): asserts emailNotifications is T {
  if (emailNotifications === undefined) {
    throw notFound("Email notification delivery service is not available");
  }
}

export function emailNotificationDeliveryRequiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

export function parseEmailNotificationDeliveryJobMessageId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Email notification delivery job messageId is invalid");
  }
  return value;
}

export function emailNotificationDeliveryIdempotencyKey(
  jobName: string,
  tenantId: string,
  messageId: string
): string {
  return `${jobName}:${stableHash(tenantId)}:${stableHash(messageId)}`;
}

export function emailNotificationDeliveryResultJson(
  messageId: string,
  delivery: DocumentEmailNotificationDelivery | undefined
): DocumentData {
  if (delivery === undefined) {
    return { delivered: false, messageId };
  }
  if (delivery.status === "sent") {
    return {
      delivered: true,
      status: "sent",
      messageId: delivery.messageId,
      eventId: delivery.eventId,
      ruleName: delivery.ruleName,
      recipientId: delivery.recipientId,
      to: delivery.to,
      subject: delivery.subject,
      ...(delivery.providerMessageId === undefined ? {} : { providerMessageId: delivery.providerMessageId })
    };
  }
  if (delivery.status === "skipped") {
    return {
      delivered: true,
      status: "skipped",
      messageId: delivery.messageId,
      eventId: delivery.eventId,
      ruleName: delivery.ruleName,
      recipientId: delivery.recipientId,
      reason: delivery.reason
    };
  }
  return {
    delivered: true,
    status: "failed",
    messageId: delivery.messageId,
    eventId: delivery.eventId,
    ruleName: delivery.ruleName,
    recipientId: delivery.recipientId,
    to: delivery.to,
    subject: delivery.subject,
    error: delivery.error
  };
}

function stableHash(value: string): string {
  const left = fnv1a64(value, 0xcbf29ce484222325n);
  const right = fnv1a64(value, 0x84222325cbf29ce4n);
  return `${left}${right}`;
}

function fnv1a64(value: string, seed: bigint): string {
  let hash = seed;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
