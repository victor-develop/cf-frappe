import { badRequest } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  foldDocumentAssignments,
  foldDocumentFollowers,
  foldDocumentFrom,
  foldDocumentTags
} from "../core/events.js";
import type {
  DocStatus,
  DocTypeName,
  DocumentData,
  DocumentEventPayload,
  DocumentName,
  DocumentSnapshot,
  DomainEvent,
  JsonValue,
  TenantId
} from "../core/types.js";

export const DEFAULT_TIMELINE_LIMIT = 50;
export const MAX_TIMELINE_LIMIT = 200;
export const DEFAULT_DIFF_BASELINE_EVENT_LIMIT = 1_000;

export interface DocumentTimelineEntry {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: string;
  readonly kind: DocumentEventPayload["kind"];
  readonly actorId: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly changes: readonly DocumentTimelineChange[];
  readonly payload: DocumentEventPayload;
  readonly metadata: DocumentData;
}

export interface DocumentTimelineChange {
  readonly field: string;
  readonly oldValue?: JsonValue;
  readonly newValue?: JsonValue;
}

export interface DocumentAssignments {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly assignees: readonly string[];
}

export interface DocumentTags {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly tags: readonly string[];
}

export interface DocumentFollowers {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly followers: readonly string[];
}

export interface DocumentTimelinePage {
  readonly visibleEvents: readonly DomainEvent[];
  readonly nextBeforeSequence?: number;
}

export function documentTimelineEntries(
  events: readonly DomainEvent[],
  initialSnapshot: DocumentSnapshot | null
): readonly DocumentTimelineEntry[] {
  let before = initialSnapshot;
  const entries: DocumentTimelineEntry[] = [];
  for (const event of events) {
    const after = foldDocumentFrom(before, [event]);
    entries.push({
      eventId: event.id,
      sequence: event.sequence,
      type: event.type,
      kind: domainEventPayloadKind(event),
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      summary: documentTimelineSummary(event.payload),
      changes: documentTimelineEventChanges(event, before, after),
      payload: event.payload,
      metadata: event.metadata
    });
    before = after;
  }
  return entries;
}

export function documentTimelineEventChanges(
  event: DomainEvent,
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null
): readonly DocumentTimelineChange[] {
  if (isTimelineEventPayloadKind(event, "DocumentCreated")) {
    const data = event.payload.data;
    return [
      change("docstatus", undefined, event.payload.docstatus),
      ...Object.keys(data)
        .sort()
        .map((field) => change(field, undefined, data[field]))
    ];
  }
  if (isTimelineEventPayloadKind(event, "DocumentUpdated")) {
    return diffPatch(event.payload.patch, before, after, event.payload.unset);
  }
  if (
    isTimelineEventPayloadKind(event, "WorkflowTransitioned") ||
    isTimelineEventPayloadKind(event, "DomainCommandApplied")
  ) {
    return diffPatch(event.payload.patch, before, after);
  }
  switch (domainEventPayloadKind(event)) {
    case "DocumentDeleted":
    case "DocumentSubmitted":
    case "DocumentCancelled":
      return diffDocstatus(before, after);
    case "DocumentCommentAdded":
    case "DocumentActivityRecorded":
    case "DocumentAssigned":
    case "DocumentUnassigned":
    case "DocumentTagged":
    case "DocumentUntagged":
    case "DocumentFollowed":
    case "DocumentUnfollowed":
    case "DocumentShared":
    case "DocumentShareRevoked":
    case "SavedListFilterSaved":
    case "SavedListFilterDeleted":
    case "SavedReportSaved":
    case "SavedReportDeleted":
    case "UserPermissionAllowed":
    case "UserPermissionRevoked":
    case "UserAccountCreated":
    case "UserAuthProviderLinked":
    case "UserAuthProviderSynced":
    case "UserPasswordChanged":
    case "UserPasswordResetRequested":
    case "UserPasswordResetCompleted":
    case "UserPasswordResetDeliveryFailed":
    case "UserEmailVerificationRequested":
    case "UserEmailVerified":
    case "UserEmailVerificationDeliveryFailed":
    case "UserRolesChanged":
    case "UserAccountEnabled":
    case "UserAccountDisabled":
    case "UserProfileChanged":
    case "PrintSettingsChanged":
    case "UserNotificationRecorded":
    case "UserNotificationRead":
    case "UserNotificationDismissed":
    case "RoleCreated":
    case "RoleDescriptionChanged":
    case "RoleEnabled":
    case "RoleDisabled":
    case "JobScheduleOverrideSet":
    case "JobSchedulePaused":
    case "JobScheduleOverrideCleared":
    case "JobScheduleSaved":
    case "JobScheduleDeleted":
    case "CustomFieldSaved":
    case "CustomFieldDisabled":
    case "FieldPropertyOverrideSaved":
    case "FieldPropertyOverrideCleared":
    case "WorkflowDefinitionSaved":
    case "WorkflowDefinitionCleared":
    case "NotificationRuleSaved":
    case "NotificationRuleCleared":
    case "AssignmentRuleSaved":
    case "AssignmentRuleCleared":
    case "EmailNotificationQueued":
    case "EmailNotificationSent":
    case "EmailNotificationDeliveryClaimed":
    case "EmailNotificationFailed":
    case "EmailNotificationSkipped":
    case "DocumentDeliveryOutboxEnqueued":
    case "DocumentDeliveryOutboxClaimed":
    case "DocumentDeliveryOutboxDelivered":
    case "DocumentDeliveryOutboxFailed":
    case "AutomationRunEnqueued":
    case "AutomationRunClaimed":
    case "AutomationRunDelivered":
    case "AutomationRunFailed":
    case "AutomationRunDeadLettered":
      return [];
  }
  return [];
}

export function documentTimelineSummary(payload: DocumentEventPayload): string {
  switch (payload.kind) {
    case "DocumentCreated":
      return "Created document";
    case "DocumentUpdated":
      return updatedSummary(payload.patch, payload.unset);
    case "DocumentDeleted":
      return "Deleted document";
    case "DocumentSubmitted":
      return "Submitted document";
    case "DocumentCancelled":
      return "Cancelled document";
    case "DocumentCommentAdded":
      return `Commented: ${summarizeText(payload.text)}`;
    case "DocumentActivityRecorded":
      return `${capitalize(payload.activityType)}: ${summarizeText(payload.subject)}`;
    case "DocumentAssigned":
      return `Assigned ${payload.assigneeId}`;
    case "DocumentUnassigned":
      return `Unassigned ${payload.assigneeId}`;
    case "DocumentTagged":
      return `Tagged ${payload.tag}`;
    case "DocumentUntagged":
      return `Untagged ${payload.tag}`;
    case "DocumentFollowed":
      return `Followed by ${payload.followerId}`;
    case "DocumentUnfollowed":
      return `Unfollowed by ${payload.followerId}`;
    case "DocumentShared":
      return `Shared with ${payload.userId} (${payload.permissions.join(", ")})`;
    case "DocumentShareRevoked":
      return `Revoked share for ${payload.userId}`;
    case "SavedListFilterSaved":
      return `Saved list filter ${payload.label}`;
    case "SavedListFilterDeleted":
      return "Deleted list filter";
    case "SavedReportSaved":
      return `Saved report ${payload.label}`;
    case "SavedReportDeleted":
      return "Deleted report";
    case "UserPermissionAllowed":
      return `Allowed ${payload.userId} to access ${payload.targetDoctype}/${payload.targetName}`;
    case "UserPermissionRevoked":
      return `Revoked ${payload.userId} access to ${payload.targetDoctype}/${payload.targetName}`;
    case "UserAccountCreated":
      return `Created user account ${payload.userId}`;
    case "UserAuthProviderLinked":
      return `Linked ${payload.provider} provider for ${payload.userId}`;
    case "UserAuthProviderSynced":
      return `Synced ${payload.provider} provider for ${payload.userId}`;
    case "UserPasswordChanged":
      return `Changed password for ${payload.userId}`;
    case "UserPasswordResetRequested":
      return `Requested password reset for ${payload.userId}`;
    case "UserPasswordResetCompleted":
      return `Reset password for ${payload.userId}`;
    case "UserPasswordResetDeliveryFailed":
      return `Password reset delivery failed for ${payload.userId}`;
    case "UserEmailVerificationRequested":
      return `Requested email verification for ${payload.userId}`;
    case "UserEmailVerified":
      return `Verified email for ${payload.userId}`;
    case "UserEmailVerificationDeliveryFailed":
      return `Email verification delivery failed for ${payload.userId}`;
    case "UserRolesChanged":
      return `Changed roles for ${payload.userId}`;
    case "UserAccountEnabled":
      return `Enabled user account ${payload.userId}`;
    case "UserAccountDisabled":
      return `Disabled user account ${payload.userId}`;
    case "UserProfileChanged":
      return `Changed profile for ${payload.userId}`;
    case "PrintSettingsChanged":
      return "Changed print settings";
    case "UserNotificationRecorded":
      return `Recorded notification ${payload.notificationId}`;
    case "UserNotificationRead":
      return `Read notification ${payload.notificationId}`;
    case "UserNotificationDismissed":
      return `Dismissed notification ${payload.notificationId}`;
    case "RoleCreated":
      return `Created role ${payload.role}`;
    case "RoleDescriptionChanged":
      return `Changed description for role ${payload.role}`;
    case "RoleEnabled":
      return `Enabled role ${payload.role}`;
    case "RoleDisabled":
      return `Disabled role ${payload.role}`;
    case "JobScheduleOverrideSet":
      return `${payload.enabled ? "Enabled" : "Disabled"} job schedule ${payload.scheduleId}`;
    case "JobSchedulePaused":
      return `Paused job schedule ${payload.scheduleId} until ${payload.pausedUntil}`;
    case "JobScheduleOverrideCleared":
      return `Cleared override for job schedule ${payload.scheduleId}`;
    case "JobScheduleSaved":
      return `Saved job schedule ${payload.scheduleId}`;
    case "JobScheduleDeleted":
      return `Deleted job schedule ${payload.scheduleId}`;
    case "CustomFieldSaved":
      return `Saved custom field ${payload.doctypeName}.${payload.field.name}`;
    case "CustomFieldDisabled":
      return `Disabled custom field ${payload.doctypeName}.${payload.fieldName}`;
    case "FieldPropertyOverrideSaved":
      return `Saved field property override for ${payload.doctypeName}.${payload.fieldName}`;
    case "FieldPropertyOverrideCleared":
      return `Cleared field property override for ${payload.doctypeName}.${payload.fieldName}`;
    case "WorkflowDefinitionSaved":
      return `Saved workflow definition for ${payload.doctypeName}`;
    case "WorkflowDefinitionCleared":
      return `Cleared workflow definition for ${payload.doctypeName}`;
    case "NotificationRuleSaved":
      return `Saved notification rule ${payload.doctypeName}.${payload.rule.name}`;
    case "NotificationRuleCleared":
      return `Cleared notification rule ${payload.doctypeName}.${payload.ruleName}`;
    case "AssignmentRuleSaved":
      return `Saved assignment rule ${payload.doctypeName}.${payload.rule.name}`;
    case "AssignmentRuleCleared":
      return `Cleared assignment rule ${payload.doctypeName}.${payload.ruleName}`;
    case "EmailNotificationQueued":
      return `Queued email notification ${payload.messageId}`;
    case "EmailNotificationSent":
      return `Sent email notification ${payload.messageId}`;
    case "EmailNotificationDeliveryClaimed":
      return `Claimed email notification delivery ${payload.messageId}`;
    case "EmailNotificationFailed":
      return `Email notification failed ${payload.messageId}`;
    case "EmailNotificationSkipped":
      return `Skipped email notification ${payload.messageId}`;
    case "DocumentDeliveryOutboxEnqueued":
      return `Queued ${payload.target} delivery ${payload.outboxId}`;
    case "DocumentDeliveryOutboxClaimed":
      return `Claimed document delivery ${payload.outboxId}`;
    case "DocumentDeliveryOutboxDelivered":
      return `Delivered document delivery ${payload.outboxId}`;
    case "DocumentDeliveryOutboxFailed":
      return `Document delivery failed ${payload.outboxId}`;
    case "AutomationRunEnqueued":
      return `Queued automation run ${payload.runId}`;
    case "AutomationRunClaimed":
      return `Claimed automation run ${payload.runId}`;
    case "AutomationRunDelivered":
      return `Delivered automation run ${payload.runId}`;
    case "AutomationRunFailed":
      return `Automation run failed ${payload.runId}`;
    case "AutomationRunDeadLettered":
      return `Automation run dead-lettered ${payload.runId}`;
    case "WorkflowTransitioned":
      return workflowSummary(payload);
    case "DomainCommandApplied":
      return `Applied ${payload.command}`;
  }
}

export function documentHistoryAssignmentsResult(
  document: DocumentSnapshot,
  events: readonly DomainEvent[]
): DocumentAssignments {
  return {
    tenantId: document.tenantId,
    doctype: document.doctype,
    name: document.name,
    version: document.version,
    docstatus: document.docstatus,
    assignees: foldDocumentAssignments(documentHistoryEventsAtVersion(events, document.version))
  };
}

export function documentHistoryTagsResult(
  document: DocumentSnapshot,
  events: readonly DomainEvent[]
): DocumentTags {
  return {
    tenantId: document.tenantId,
    doctype: document.doctype,
    name: document.name,
    version: document.version,
    docstatus: document.docstatus,
    tags: foldDocumentTags(documentHistoryEventsAtVersion(events, document.version))
  };
}

export function documentHistoryFollowersResult(
  document: DocumentSnapshot,
  events: readonly DomainEvent[]
): DocumentFollowers {
  return {
    tenantId: document.tenantId,
    doctype: document.doctype,
    name: document.name,
    version: document.version,
    docstatus: document.docstatus,
    followers: foldDocumentFollowers(documentHistoryEventsAtVersion(events, document.version))
  };
}

export function documentHistoryEventsAtVersion(
  events: readonly DomainEvent[],
  version: number
): readonly DomainEvent[] {
  return events.filter((event) => event.sequence <= version);
}

export function selectDocumentTimelinePage(options: {
  readonly events: readonly DomainEvent[];
  readonly beforeSequence: number;
  readonly limit: number;
}): DocumentTimelinePage {
  const authorizedEvents = options.events
    .filter((event) => event.sequence <= options.beforeSequence)
    .sort(bySequence);
  const hasMore = authorizedEvents.length > options.limit;
  const overflow = hasMore ? authorizedEvents[authorizedEvents.length - options.limit - 1] : undefined;
  const visibleEvents = hasMore
    ? authorizedEvents.slice(authorizedEvents.length - options.limit)
    : authorizedEvents;
  return {
    visibleEvents,
    ...(overflow === undefined ? {} : { nextBeforeSequence: overflow.sequence })
  };
}

export function normalizeDocumentTimelineLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Timeline limit must be a positive integer");
  }
  return Math.min(limit, MAX_TIMELINE_LIMIT);
}

export function normalizeDocumentTimelineBaselineLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DIFF_BASELINE_EVENT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw badRequest("Timeline diff baseline event limit must be a non-negative integer");
  }
  return value;
}

export function normalizeDocumentTimelineBeforeSequence(
  beforeSequence: number | undefined,
  authorizedVersion: number
): number {
  if (beforeSequence === undefined) {
    return authorizedVersion;
  }
  if (!Number.isInteger(beforeSequence) || beforeSequence < 1) {
    throw badRequest("Timeline beforeSequence must be a positive integer");
  }
  return Math.min(beforeSequence, authorizedVersion);
}

export function documentTimelineBaselineEventCount(
  firstVisibleSequence: number | undefined,
  maxDiffBaselineEvents: number
): number | undefined {
  if (firstVisibleSequence === undefined || firstVisibleSequence <= 1) {
    return undefined;
  }
  const baselineEventCount = firstVisibleSequence - 1;
  if (baselineEventCount > maxDiffBaselineEvents) {
    throw badRequest(
      `Timeline diff baseline needs ${baselineEventCount} prior events, exceeding the configured limit of ${maxDiffBaselineEvents}`
    );
  }
  return baselineEventCount;
}

function bySequence(left: DomainEvent, right: DomainEvent): number {
  return left.sequence - right.sequence;
}

function isTimelineEventPayloadKind<TKind extends DocumentEventPayload["kind"]>(
  event: DomainEvent,
  kind: TKind
): event is DomainEvent<Extract<DocumentEventPayload, { readonly kind: TKind }>> {
  return domainEventPayloadKind(event) === kind;
}

function diffPatch(
  patch: DocumentData,
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null,
  unset: readonly string[] = []
): readonly DocumentTimelineChange[] {
  return [...new Set([...Object.keys(patch), ...unset])]
    .sort()
    .map((field) => change(field, before?.data[field], after?.data[field]))
    .filter((item) => !jsonEquals(item.oldValue, item.newValue));
}

function diffDocstatus(
  before: DocumentSnapshot | null,
  after: DocumentSnapshot | null
): readonly DocumentTimelineChange[] {
  const item = change("docstatus", before?.docstatus, after?.docstatus);
  return jsonEquals(item.oldValue, item.newValue) ? [] : [item];
}

function change(field: string, oldValue: JsonValue | undefined, newValue: JsonValue | undefined): DocumentTimelineChange {
  return {
    field,
    ...(oldValue !== undefined ? { oldValue } : {}),
    ...(newValue !== undefined ? { newValue } : {})
  };
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function updatedSummary(patch: DocumentData, unset: readonly string[] = []): string {
  const updated = Object.keys(patch);
  const removed = unset.filter((field) => !updated.includes(field));
  if (updated.length === 0 && removed.length === 0) {
    return "Updated document";
  }
  const parts = [
    ...(updated.length === 0 ? [] : [`Updated ${updated.join(", ")}`]),
    ...(removed.length === 0 ? [] : [`removed ${removed.join(", ")}`])
  ];
  return parts.join("; ");
}

function summarizeText(text: string): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
}

function workflowSummary(payload: Extract<DocumentEventPayload, { readonly kind: "WorkflowTransitioned" }>): string {
  const fields = Object.keys(payload.patch);
  const fieldList = fields.length > 0 ? fields.join(", ") : "workflow";
  return `${pastTense(payload.action)} ${fieldList} from ${payload.from} to ${payload.to}`;
}

function pastTense(action: string): string {
  if (action.endsWith("e")) {
    return `${capitalize(action)}d`;
  }
  return `${capitalize(action)}ed`;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
