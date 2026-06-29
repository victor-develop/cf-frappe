import {
  documentShareGrantKey,
  invalidDocumentSharePermissions,
  normalizeDocumentShareGrant,
  normalizeDocumentShareUserId,
  type DocumentShareGrant,
  type DocumentSharePermission
} from "../core/document-shares.js";
import { badRequest, permissionDenied } from "../core/errors.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot } from "../core/types.js";
import {
  documentActivityRecordedPayload,
  documentAssignmentPayload,
  documentCommentAddedPayload,
  documentFollowerPayload,
  documentTagPayload,
  type DocumentCollaborationEventPayload
} from "./document-collaboration-events.js";
import {
  documentShareEventType,
  documentSharedPayload,
  documentShareRevokedPayload,
  type DocumentShareEventPayload
} from "./document-share-events.js";

const MAX_COMMENT_TEXT_LENGTH = 5000;
const MAX_ACTIVITY_TYPE_LENGTH = 64;
const MAX_ACTIVITY_SUBJECT_LENGTH = 240;
const MAX_ACTIVITY_DETAIL_LENGTH = 10000;
const MAX_ACTIVITY_CHANNEL_LENGTH = 120;
const MAX_ACTIVITY_EXTERNAL_ID_LENGTH = 256;
const MAX_ASSIGNEE_ID_LENGTH = 320;
const MAX_TAG_LENGTH = 80;
const MAX_FOLLOWER_ID_LENGTH = 320;
const MAX_SHARE_USER_ID_LENGTH = 320;

export interface ActivityInput {
  readonly activityType?: string;
  readonly subject: string;
  readonly detail?: string;
  readonly channel?: string;
  readonly externalId?: string;
}

export interface NormalizedActivity {
  readonly activityType: string;
  readonly subject: string;
  readonly detail?: string;
  readonly channel?: string;
  readonly externalId?: string;
}

export type CollaborationCollectionAction = "add" | "remove";

export interface CollaborationCollectionChange {
  readonly value: string;
  readonly noop: boolean;
}

export interface DocumentCollaborationEventPlan {
  readonly eventType: string;
  readonly payload: DocumentCollaborationEventPayload;
}

export interface DocumentCollaborationCollectionPlan extends DocumentCollaborationEventPlan {
  readonly value: string;
  readonly noop: boolean;
}

export interface DocumentShareEventPlan {
  readonly eventType: string;
  readonly payload: DocumentShareEventPayload;
  readonly noop: boolean;
}

export interface DocumentShareGrantPlan extends DocumentShareEventPlan {
  readonly grant: DocumentShareGrant;
}

export interface DocumentShareRevocationPlan extends DocumentShareEventPlan {
  readonly userId: string;
}

export function collaborationCollectionChange(
  currentValues: readonly string[],
  value: string,
  action: CollaborationCollectionAction
): CollaborationCollectionChange {
  const exists = currentValues.includes(value);
  return {
    value,
    noop: action === "add" ? exists : !exists
  };
}

export function normalizeCommentText(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0) {
    throw badRequest("Comment text is required");
  }
  if (normalized.length > MAX_COMMENT_TEXT_LENGTH) {
    throw badRequest(`Comment text exceeds ${MAX_COMMENT_TEXT_LENGTH} characters`);
  }
  return normalized;
}

export function normalizeActivity(command: ActivityInput): NormalizedActivity {
  const activityType = normalizeOptionalText(command.activityType, {
    defaultValue: "activity",
    field: "Activity type",
    maxLength: MAX_ACTIVITY_TYPE_LENGTH
  }) ?? "activity";
  const subject = normalizeRequiredText(command.subject, "Activity subject", MAX_ACTIVITY_SUBJECT_LENGTH);
  const detail = normalizeOptionalText(command.detail, {
    field: "Activity detail",
    maxLength: MAX_ACTIVITY_DETAIL_LENGTH
  });
  const channel = normalizeOptionalText(command.channel, {
    field: "Activity channel",
    maxLength: MAX_ACTIVITY_CHANNEL_LENGTH
  });
  const externalId = normalizeOptionalText(command.externalId, {
    field: "Activity external id",
    maxLength: MAX_ACTIVITY_EXTERNAL_ID_LENGTH
  });
  return {
    activityType,
    subject,
    ...(detail !== undefined ? { detail } : {}),
    ...(channel !== undefined ? { channel } : {}),
    ...(externalId !== undefined ? { externalId } : {})
  };
}

export function planDocumentCommentPolicy(
  doctype: DocTypeDefinition,
  text: string
): DocumentCollaborationEventPlan {
  return {
    eventType: doctype.events?.comment ?? `${doctype.name}CommentAdded`,
    payload: documentCommentAddedPayload(normalizeCommentText(text))
  };
}

export function planDocumentActivityPolicy(
  doctype: DocTypeDefinition,
  command: ActivityInput
): DocumentCollaborationEventPlan {
  return {
    eventType: doctype.events?.activity ?? `${doctype.name}ActivityRecorded`,
    payload: documentActivityRecordedPayload(normalizeActivity(command))
  };
}

export function planDocumentAssignmentChangePolicy(input: {
  readonly doctype: DocTypeDefinition;
  readonly currentAssignees: readonly string[];
  readonly assignee: string;
  readonly action: CollaborationCollectionAction;
}): DocumentCollaborationCollectionPlan {
  const change = collaborationCollectionChange(
    input.currentAssignees,
    normalizeAssigneeId(input.assignee),
    input.action
  );
  const eventKind = input.action === "add" ? "DocumentAssigned" : "DocumentUnassigned";
  return {
    ...change,
    eventType:
      input.action === "add"
        ? input.doctype.events?.assign ?? `${input.doctype.name}Assigned`
        : input.doctype.events?.unassign ?? `${input.doctype.name}Unassigned`,
    payload: documentAssignmentPayload(eventKind, change.value)
  };
}

export function planDocumentTagChangePolicy(input: {
  readonly doctype: DocTypeDefinition;
  readonly currentTags: readonly string[];
  readonly tag: string;
  readonly action: CollaborationCollectionAction;
}): DocumentCollaborationCollectionPlan {
  const change = collaborationCollectionChange(input.currentTags, normalizeTag(input.tag), input.action);
  const eventKind = input.action === "add" ? "DocumentTagged" : "DocumentUntagged";
  return {
    ...change,
    eventType:
      input.action === "add"
        ? input.doctype.events?.tag ?? `${input.doctype.name}Tagged`
        : input.doctype.events?.untag ?? `${input.doctype.name}Untagged`,
    payload: documentTagPayload(eventKind, change.value)
  };
}

export function planDocumentFollowerChangePolicy(input: {
  readonly doctype: DocTypeDefinition;
  readonly actor: Actor;
  readonly currentFollowers: readonly string[];
  readonly follower?: string | undefined;
  readonly action: CollaborationCollectionAction;
}): DocumentCollaborationCollectionPlan {
  const change = collaborationCollectionChange(
    input.currentFollowers,
    normalizeFollowerId(input.follower ?? input.actor.id),
    input.action
  );
  const eventKind = input.action === "add" ? "DocumentFollowed" : "DocumentUnfollowed";
  return {
    ...change,
    eventType:
      input.action === "add"
        ? input.doctype.events?.follow ?? `${input.doctype.name}Followed`
        : input.doctype.events?.unfollow ?? `${input.doctype.name}Unfollowed`,
    payload: documentFollowerPayload(eventKind, change.value)
  };
}

export function normalizeAssigneeId(assignee: string): string {
  const normalized = assignee.trim();
  if (normalized.length === 0) {
    throw badRequest("Assignee is required");
  }
  if (normalized.length > MAX_ASSIGNEE_ID_LENGTH) {
    throw badRequest(`Assignee exceeds ${MAX_ASSIGNEE_ID_LENGTH} characters`);
  }
  return normalized;
}

export function normalizeTag(tag: string): string {
  const normalized = tag.replaceAll(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    throw badRequest("Tag is required");
  }
  if (normalized.length > MAX_TAG_LENGTH) {
    throw badRequest(`Tag exceeds ${MAX_TAG_LENGTH} characters`);
  }
  return normalized;
}

export function normalizeFollowerId(follower: string): string {
  const normalized = follower.trim();
  if (normalized.length === 0) {
    throw badRequest("Follower is required");
  }
  if (normalized.length > MAX_FOLLOWER_ID_LENGTH) {
    throw badRequest(`Follower exceeds ${MAX_FOLLOWER_ID_LENGTH} characters`);
  }
  return normalized;
}

export function normalizeValidDocumentShareGrant(command: {
  readonly userId: string;
  readonly permissions: readonly string[];
}): DocumentShareGrant {
  const invalidPermissions = invalidDocumentSharePermissions(command.permissions);
  if (invalidPermissions.length > 0) {
    throw badRequest(`Share permissions are invalid: ${invalidPermissions.join(", ")}`);
  }
  const grant = normalizeDocumentShareGrant(command);
  if (grant.userId.length === 0) {
    throw badRequest("Share user is required");
  }
  if (grant.userId.length > MAX_SHARE_USER_ID_LENGTH) {
    throw badRequest(`Share user exceeds ${MAX_SHARE_USER_ID_LENGTH} characters`);
  }
  if (grant.permissions.length === 0) {
    throw badRequest("Share permissions are required");
  }
  return grant;
}

export function planDocumentSharePolicy(input: {
  readonly doctype: DocTypeDefinition;
  readonly currentGrants: readonly DocumentShareGrant[];
  readonly command: {
    readonly userId: string;
    readonly permissions: readonly string[];
  };
}): DocumentShareGrantPlan {
  const grant = normalizeValidDocumentShareGrant(input.command);
  const current = input.currentGrants.find((item) => item.userId === grant.userId);
  return {
    grant,
    noop: current !== undefined && documentShareGrantKey(current) === documentShareGrantKey(grant),
    eventType: documentShareEventType({
      doctypeName: input.doctype.name,
      kind: "DocumentShared",
      shareEventType: input.doctype.events?.share
    }),
    payload: documentSharedPayload({
      userId: grant.userId,
      permissions: grant.permissions
    })
  };
}

export function normalizeValidDocumentShareUserId(userId: string): string {
  const normalized = normalizeDocumentShareUserId(userId);
  if (normalized.length === 0) {
    throw badRequest("Share user is required");
  }
  if (normalized.length > MAX_SHARE_USER_ID_LENGTH) {
    throw badRequest(`Share user exceeds ${MAX_SHARE_USER_ID_LENGTH} characters`);
  }
  return normalized;
}

export function planDocumentShareRevocationPolicy(input: {
  readonly doctype: DocTypeDefinition;
  readonly currentGrants: readonly DocumentShareGrant[];
  readonly userId: string;
}): DocumentShareRevocationPlan {
  const userId = normalizeValidDocumentShareUserId(input.userId);
  return {
    userId,
    noop: input.currentGrants.every((grant) => grant.userId !== userId),
    eventType: documentShareEventType({
      doctypeName: input.doctype.name,
      kind: "DocumentShareRevoked",
      unshareEventType: input.doctype.events?.unshare
    }),
    payload: documentShareRevokedPayload(userId)
  };
}

export function ensureSharedGrantIsDelegable(
  actor: Actor,
  doctype: DocTypeDefinition,
  document: DocumentSnapshot,
  actorPermissions: readonly DocumentSharePermission[],
  grant: DocumentShareGrant
): void {
  const actorPermissionSet = new Set(actorPermissions);
  const blocked = grant.permissions.filter((permission) => !actorPermissionSet.has(permission));
  if (blocked.length > 0) {
    throw permissionDenied(
      `Actor '${actor.id}' cannot grant ${blocked.join(", ")} on ${doctype.name}/${document.name}`
    );
  }
}

function normalizeRequiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
  options: { readonly field: string; readonly maxLength: number; readonly defaultValue?: string }
): string | undefined {
  if (value === undefined) {
    return options.defaultValue;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return options.defaultValue;
  }
  if (normalized.length > options.maxLength) {
    throw badRequest(`${options.field} exceeds ${options.maxLength} characters`);
  }
  return normalized;
}
