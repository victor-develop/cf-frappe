import type { DomainEvent, TenantId } from "../core/types.js";

export interface EmailNotificationAddressPayload {
  readonly email: string;
  readonly name?: string;
}

export type EmailNotificationEventPayload =
  | {
      readonly kind: "EmailNotificationQueued";
      readonly messageId: string;
      readonly sourceEventId: string;
      readonly sourceEventType: string;
      readonly payloadKind: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly from: EmailNotificationAddressPayload;
      readonly to: EmailNotificationAddressPayload;
      readonly subject: string;
      readonly text: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "EmailNotificationSent";
      readonly messageId: string;
      readonly claimId: string;
      readonly providerMessageId?: string;
    }
  | {
      readonly kind: "EmailNotificationDeliveryClaimed";
      readonly messageId: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "EmailNotificationFailed";
      readonly messageId: string;
      readonly claimId: string;
      readonly error: string;
    }
  | {
      readonly kind: "EmailNotificationSkipped";
      readonly messageId: string;
      readonly sourceEventId: string;
      readonly sourceEventType: string;
      readonly payloadKind: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly reason: string;
    };

export const EMAIL_OUTBOX_PAYLOAD_KINDS = Object.freeze([
  "EmailNotificationQueued",
  "EmailNotificationSent",
  "EmailNotificationDeliveryClaimed",
  "EmailNotificationFailed",
  "EmailNotificationSkipped"
] as const);

export interface QueuedEmailMessage {
  readonly messageId: string;
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly payloadKind: string;
  readonly ruleName: string;
  readonly recipientId: string;
  readonly from: EmailNotificationAddressPayload;
  readonly to: EmailNotificationAddressPayload;
  readonly subject: string;
  readonly text: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface EmailOutboxRecord extends QueuedEmailMessage {
  readonly status: "claimed" | "failed" | "queued" | "sent";
  readonly claimId?: string;
  readonly claimedAt?: string;
  readonly providerMessageId?: string;
  readonly error?: string;
}

export interface SkippedEmailOutboxRecord {
  readonly messageId: string;
  readonly status: "skipped";
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly payloadKind: string;
  readonly ruleName: string;
  readonly recipientId: string;
  readonly reason?: string;
}

export type EmailOutboxRecordEntry = EmailOutboxRecord | SkippedEmailOutboxRecord;

export interface EmailOutboxState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly messages: ReadonlyMap<string, EmailOutboxRecordEntry>;
}

export function emailNotificationMessageId(eventId: string, ruleName: string, recipientId: string): string {
  return `${eventId}:rule:${encodeURIComponent(ruleName)}:email:${encodeURIComponent(recipientId)}`;
}

export function foldEmailOutbox(tenantId: TenantId, events: readonly DomainEvent[]): EmailOutboxState {
  const messages = new Map<string, EmailOutboxRecordEntry>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    switch (event.payload.kind) {
      case "EmailNotificationQueued":
        messages.set(event.payload.messageId, {
          messageId: event.payload.messageId,
          status: "queued",
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          ruleName: event.payload.ruleName,
          recipientId: event.payload.recipientId,
          from: event.payload.from,
          to: event.payload.to,
          subject: event.payload.subject,
          text: event.payload.text,
          ...(event.payload.headers === undefined ? {} : { headers: event.payload.headers })
        });
        break;
      case "EmailNotificationSent": {
        const existing = messages.get(event.payload.messageId);
        if (existing !== undefined && existing.status === "claimed" && existing.claimId === event.payload.claimId) {
          messages.set(event.payload.messageId, {
            ...existing,
            status: "sent",
            ...(event.payload.providerMessageId === undefined ? {} : { providerMessageId: event.payload.providerMessageId }),
            ...(existing.error === undefined ? {} : { error: existing.error })
          });
        }
        break;
      }
      case "EmailNotificationDeliveryClaimed": {
        const existing = messages.get(event.payload.messageId);
        if (existing !== undefined && existing.status !== "skipped" && existing.status !== "sent") {
          messages.set(event.payload.messageId, {
            ...existing,
            status: "claimed",
            claimId: event.payload.claimId,
            claimedAt: event.occurredAt
          });
        }
        break;
      }
      case "EmailNotificationFailed": {
        const existing = messages.get(event.payload.messageId);
        if (existing !== undefined && existing.status === "claimed" && existing.claimId === event.payload.claimId) {
          messages.set(event.payload.messageId, {
            ...existing,
            status: "failed",
            error: event.payload.error
          });
        }
        break;
      }
      case "EmailNotificationSkipped":
        messages.set(event.payload.messageId, {
          messageId: event.payload.messageId,
          status: "skipped",
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          ruleName: event.payload.ruleName,
          recipientId: event.payload.recipientId,
          reason: event.payload.reason
        });
        break;
    }
  }
  return { tenantId, version, messages };
}

export function requireAppendedEmailOutboxEvent(
  event: DomainEvent | undefined,
  tenantId: TenantId,
  messageId: string,
  payloadKind: EmailNotificationEventPayload["kind"]
): DomainEvent {
  if (event === undefined) {
    throw new Error(
      `Email outbox append for '${messageId}' in tenant '${tenantId}' did not return '${payloadKind}'`
    );
  }
  return event;
}

export function claimedDeliveryId(record: EmailOutboxRecord, messageId: string): string {
  if (record.claimId === undefined) {
    throw new Error(`Claimed email outbox message '${messageId}' has no claim id`);
  }
  return record.claimId;
}

export function isStaleEmailClaim(record: EmailOutboxRecord, now: string, claimTimeoutMs: number): boolean {
  if (record.claimedAt === undefined) {
    return false;
  }
  const claimedAt = Date.parse(record.claimedAt);
  const current = Date.parse(now);
  return !Number.isNaN(claimedAt) && !Number.isNaN(current) && current - claimedAt >= claimTimeoutMs;
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly EmailNotificationQueued: Extract<
      EmailNotificationEventPayload,
      { readonly kind: "EmailNotificationQueued" }
    >;
    readonly EmailNotificationSent: Extract<
      EmailNotificationEventPayload,
      { readonly kind: "EmailNotificationSent" }
    >;
    readonly EmailNotificationDeliveryClaimed: Extract<
      EmailNotificationEventPayload,
      { readonly kind: "EmailNotificationDeliveryClaimed" }
    >;
    readonly EmailNotificationFailed: Extract<
      EmailNotificationEventPayload,
      { readonly kind: "EmailNotificationFailed" }
    >;
    readonly EmailNotificationSkipped: Extract<
      EmailNotificationEventPayload,
      { readonly kind: "EmailNotificationSkipped" }
    >;
  }
}
