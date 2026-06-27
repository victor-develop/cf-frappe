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

export type DocumentAssignmentEventKind = Extract<
  DocumentCollaborationEventPayload,
  { readonly assigneeId: string }
>["kind"];

export type DocumentTagEventKind = Extract<
  DocumentCollaborationEventPayload,
  { readonly tag: string }
>["kind"];

export type DocumentFollowerEventKind = Extract<
  DocumentCollaborationEventPayload,
  { readonly followerId: string }
>["kind"];

export interface DocumentActivityPayloadInput {
  readonly activityType: string;
  readonly subject: string;
  readonly detail?: string;
  readonly channel?: string;
  readonly externalId?: string;
}

export function documentCommentAddedPayload(
  text: string
): Extract<DocumentCollaborationEventPayload, { readonly kind: "DocumentCommentAdded" }> {
  return { kind: "DocumentCommentAdded", text };
}

export function documentActivityRecordedPayload(
  activity: DocumentActivityPayloadInput
): Extract<DocumentCollaborationEventPayload, { readonly kind: "DocumentActivityRecorded" }> {
  return {
    kind: "DocumentActivityRecorded",
    activityType: activity.activityType,
    subject: activity.subject,
    ...(activity.detail !== undefined ? { detail: activity.detail } : {}),
    ...(activity.channel !== undefined ? { channel: activity.channel } : {}),
    ...(activity.externalId !== undefined ? { externalId: activity.externalId } : {})
  };
}

export function documentAssignmentPayload(
  kind: DocumentAssignmentEventKind,
  assigneeId: string
): Extract<DocumentCollaborationEventPayload, { readonly assigneeId: string }> {
  return { kind, assigneeId };
}

export function documentTagPayload(
  kind: DocumentTagEventKind,
  tag: string
): Extract<DocumentCollaborationEventPayload, { readonly tag: string }> {
  return { kind, tag };
}

export function documentFollowerPayload(
  kind: DocumentFollowerEventKind,
  followerId: string
): Extract<DocumentCollaborationEventPayload, { readonly followerId: string }> {
  return { kind, followerId };
}

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
