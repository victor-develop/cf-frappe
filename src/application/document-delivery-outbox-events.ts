import type { DocumentData, DocumentName, DocTypeName } from "../core/types.js";

export type DocumentDeliveryOutboxTarget = "notification" | "realtime" | "email";

export type DocumentDeliveryOutboxEventPayload =
  | {
      readonly kind: "DocumentDeliveryOutboxEnqueued";
      readonly outboxId: string;
      readonly target: DocumentDeliveryOutboxTarget;
      readonly sourceEventId: string;
      readonly sourceEventType: string;
      readonly payloadKind: string;
      readonly doctype: DocTypeName;
      readonly documentName: DocumentName;
      readonly actorId: string;
      readonly payload?: DocumentData;
    }
  | {
      readonly kind: "DocumentDeliveryOutboxClaimed";
      readonly outboxId: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "DocumentDeliveryOutboxDelivered";
      readonly outboxId: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "DocumentDeliveryOutboxFailed";
      readonly outboxId: string;
      readonly claimId: string;
      readonly error: string;
      readonly retryAt?: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly DocumentDeliveryOutboxEnqueued: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxEnqueued" }
    >;
    readonly DocumentDeliveryOutboxClaimed: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxClaimed" }
    >;
    readonly DocumentDeliveryOutboxDelivered: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxDelivered" }
    >;
    readonly DocumentDeliveryOutboxFailed: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxFailed" }
    >;
  }
}
