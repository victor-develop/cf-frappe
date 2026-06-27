export type DocumentCollaborationEventPayload =
  | {
      readonly kind: "DocumentCommentAdded";
      readonly text: string;
    }
  | {
      readonly kind: "DocumentActivityRecorded";
      readonly activityType: string;
      readonly subject: string;
      readonly detail?: string;
      readonly channel?: string;
      readonly externalId?: string;
    }
  | {
      readonly kind: "DocumentAssigned";
      readonly assigneeId: string;
    }
  | {
      readonly kind: "DocumentUnassigned";
      readonly assigneeId: string;
    }
  | {
      readonly kind: "DocumentTagged";
      readonly tag: string;
    }
  | {
      readonly kind: "DocumentUntagged";
      readonly tag: string;
    }
  | {
      readonly kind: "DocumentFollowed";
      readonly followerId: string;
    }
  | {
      readonly kind: "DocumentUnfollowed";
      readonly followerId: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly DocumentCommentAdded: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentCommentAdded" }
    >;
    readonly DocumentActivityRecorded: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentActivityRecorded" }
    >;
    readonly DocumentAssigned: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentAssigned" }
    >;
    readonly DocumentUnassigned: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentUnassigned" }
    >;
    readonly DocumentTagged: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentTagged" }
    >;
    readonly DocumentUntagged: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentUntagged" }
    >;
    readonly DocumentFollowed: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentFollowed" }
    >;
    readonly DocumentUnfollowed: Extract<
      DocumentCollaborationEventPayload,
      { readonly kind: "DocumentUnfollowed" }
    >;
  }
}
