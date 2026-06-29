import { domainEventPayloadKind } from "../core/domain-events.js";
import type { DocTypeName, DomainEvent } from "../core/types.js";

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

export type DocumentCollaborationPayloadKind = DocumentCollaborationEventPayload["kind"];

export const DOCUMENT_COLLABORATION_PAYLOAD_KINDS = Object.freeze([
  "DocumentCommentAdded",
  "DocumentActivityRecorded",
  "DocumentAssigned",
  "DocumentUnassigned",
  "DocumentTagged",
  "DocumentUntagged",
  "DocumentFollowed",
  "DocumentUnfollowed"
] as const satisfies readonly DocumentCollaborationPayloadKind[]);

const DOCUMENT_COLLABORATION_PAYLOAD_KIND_SET = new Set<string>(DOCUMENT_COLLABORATION_PAYLOAD_KINDS);

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

export interface DocumentCollaborationEventTypeOptions {
  readonly doctypeName: DocTypeName;
  readonly kind: DocumentCollaborationEventPayload["kind"];
  readonly commentEventType?: string | undefined;
  readonly activityEventType?: string | undefined;
  readonly assignEventType?: string | undefined;
  readonly unassignEventType?: string | undefined;
  readonly tagEventType?: string | undefined;
  readonly untagEventType?: string | undefined;
  readonly followEventType?: string | undefined;
  readonly unfollowEventType?: string | undefined;
}

export function documentCollaborationEventType(
  options: DocumentCollaborationEventTypeOptions
): string {
  switch (options.kind) {
    case "DocumentCommentAdded":
      return options.commentEventType ?? `${options.doctypeName}CommentAdded`;
    case "DocumentActivityRecorded":
      return options.activityEventType ?? `${options.doctypeName}ActivityRecorded`;
    case "DocumentAssigned":
      return options.assignEventType ?? `${options.doctypeName}Assigned`;
    case "DocumentUnassigned":
      return options.unassignEventType ?? `${options.doctypeName}Unassigned`;
    case "DocumentTagged":
      return options.tagEventType ?? `${options.doctypeName}Tagged`;
    case "DocumentUntagged":
      return options.untagEventType ?? `${options.doctypeName}Untagged`;
    case "DocumentFollowed":
      return options.followEventType ?? `${options.doctypeName}Followed`;
    case "DocumentUnfollowed":
      return options.unfollowEventType ?? `${options.doctypeName}Unfollowed`;
  }
}

export function isDocumentCollaborationPayloadKind(kind: string): kind is DocumentCollaborationPayloadKind {
  return DOCUMENT_COLLABORATION_PAYLOAD_KIND_SET.has(kind);
}

export function isDocumentCollaborationEvent(
  event: DomainEvent
): event is DomainEvent<DocumentCollaborationEventPayload> {
  return isDocumentCollaborationPayloadKind(domainEventPayloadKind(event));
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
