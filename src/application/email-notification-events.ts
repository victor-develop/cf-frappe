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
