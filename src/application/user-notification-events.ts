import type { DocTypeName, DocumentName } from "../core/types.js";

export type UserNotificationEventPayload =
  | {
      readonly kind: "UserNotificationRecorded";
      readonly notificationId: string;
      readonly sourceEventId: string;
      readonly eventType: string;
      readonly payloadKind: string;
      readonly recipientId: string;
      readonly doctype: DocTypeName;
      readonly documentName: DocumentName;
      readonly actorId: string;
      readonly subject?: string;
      readonly ruleName?: string;
    }
  | {
      readonly kind: "UserNotificationRead";
      readonly notificationId: string;
    }
  | {
      readonly kind: "UserNotificationDismissed";
      readonly notificationId: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserNotificationRecorded: Extract<
      UserNotificationEventPayload,
      { readonly kind: "UserNotificationRecorded" }
    >;
    readonly UserNotificationRead: Extract<
      UserNotificationEventPayload,
      { readonly kind: "UserNotificationRead" }
    >;
    readonly UserNotificationDismissed: Extract<
      UserNotificationEventPayload,
      { readonly kind: "UserNotificationDismissed" }
    >;
  }
}
