import { describe, expect, it } from "vitest";
import * as framework from "../../src";
import type { DomainEvent, NamedWorkflowDefinition } from "../../src";
import {
  foldAssignmentRules,
  foldAssignmentRulesFrom,
  foldAutomationRun,
  foldAutomationRunFrom,
  foldCustomFields,
  foldCustomFieldsFrom,
  foldDocumentDeliveryOutbox,
  foldDocumentDeliveryOutboxFrom,
  foldDocumentDeliveryOutboxRecord,
  foldDocumentDeliveryOutboxRecordFrom,
  foldDocument,
  foldDocumentAssignments,
  foldDocumentAssignmentsFrom,
  foldDocumentFollowers,
  foldDocumentFollowersFrom,
  foldDocumentFrom,
  foldDocumentShares,
  foldDocumentSharesFrom,
  foldDocumentTags,
  foldDocumentTagsFrom,
  foldEmailOutbox,
  foldEmailOutboxFrom,
  foldFieldPropertyOverrides,
  foldFieldPropertyOverridesFrom,
  foldJobScheduleDefinitions,
  foldJobScheduleDefinitionsFrom,
  foldJobScheduleOverrides,
  foldJobScheduleOverridesFrom,
  foldNamedWorkflowDefinition,
  foldNamedWorkflowDefinitionFrom,
  foldNamedWorkflowFieldOwnership,
  foldNamedWorkflowFieldOwnershipFrom,
  foldNamingConfiguration,
  foldNamingConfigurationFrom,
  foldNotificationRules,
  foldNotificationRulesFrom,
  foldPrintSettings,
  foldPrintSettingsFrom,
  foldRoleCatalog,
  foldRoleCatalogFrom,
  foldSavedListFilters,
  foldSavedListFiltersFrom,
  foldSavedReports,
  foldSavedReportsFrom,
  foldUserAccount,
  foldUserAccountFrom,
  foldUserNotifications,
  foldUserNotificationsFrom,
  foldUserPermissions,
  foldUserPermissionsFrom,
  foldProjectionRebuild,
  foldProjectionRebuildFrom,
  foldUserProfile,
  foldUserProfileFrom
} from "../../src";
import { noteDocType } from "../helpers";

/**
 * Folds must be resumable: replaying a whole stream and replaying a prefix
 * then resuming from its result have to agree. Snapshots depend on this, and
 * the failure mode it catches is a fold that quietly assumes it has seen the
 * whole stream - a branch that only initialises on the first `Created` event,
 * for instance, breaks the moment the tail no longer contains one.
 */

const base = {
  id: "evt",
  tenantId: "acme",
  stream: "acme:Note:One",
  doctype: "Note",
  documentName: "One",
  actorId: "owner",
  occurredAt: "2026-01-01T00:00:00.000Z",
  metadata: {}
};

function event(sequence: number, payload: DomainEvent["payload"]): DomainEvent {
  return {
    ...base,
    id: `evt${sequence}`,
    sequence,
    type: payload.kind,
    payload
  } as DomainEvent;
}

function events(...payloads: readonly DomainEvent["payload"][]): DomainEvent[] {
  return payloads.map((payload, index) => event(index + 1, payload));
}

interface FoldCase<TState> {
  readonly name: string;
  readonly events: readonly DomainEvent[];
  foldAll(stream: readonly DomainEvent[]): TState;
  foldFrom(initial: TState | null, stream: readonly DomainEvent[]): TState;
}

function foldCase<TState>(input: FoldCase<TState>): FoldCase<unknown> {
  return input as FoldCase<unknown>;
}

const TENANT = "acme";
const USER = "user-1";
const REVIEW_WORKFLOW: NamedWorkflowDefinition = {
  name: "review",
  stateField: "review_state",
  initialState: "Pending",
  states: ["Pending", "Approved"],
  transitions: [{ action: "approve", from: "Pending", to: "Approved" }]
};

const cases: readonly FoldCase<unknown>[] = [
  foldCase({
    name: "foldDocument",
    events: events(
      { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
      { kind: "DocumentUpdated", patch: { body: "first" } },
      { kind: "DocumentUpdated", patch: { body: "second", extra: 1 } },
      { kind: "DocumentUpdated", patch: {}, unset: ["extra"] }
    ),
    foldAll: (stream) => foldDocument(stream),
    foldFrom: (initial, stream) => foldDocumentFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentAssignments",
    events: events(
      { kind: "DocumentAssigned", assigneeId: "a" },
      { kind: "DocumentAssigned", assigneeId: "b" },
      { kind: "DocumentUnassigned", assigneeId: "a" },
      { kind: "DocumentAssigned", assigneeId: "c" }
    ),
    foldAll: (stream) => foldDocumentAssignments(stream),
    foldFrom: (initial, stream) => foldDocumentAssignmentsFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentTags",
    events: events(
      { kind: "DocumentTagged", tag: "red" },
      { kind: "DocumentTagged", tag: "blue" },
      { kind: "DocumentUntagged", tag: "red" }
    ),
    foldAll: (stream) => foldDocumentTags(stream),
    foldFrom: (initial, stream) => foldDocumentTagsFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentFollowers",
    events: events(
      { kind: "DocumentFollowed", followerId: "a" },
      { kind: "DocumentFollowed", followerId: "b" },
      { kind: "DocumentUnfollowed", followerId: "a" }
    ),
    foldAll: (stream) => foldDocumentFollowers(stream),
    foldFrom: (initial, stream) => foldDocumentFollowersFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentShares",
    events: events(
      { kind: "DocumentShared", userId: "a", permissions: ["read"] },
      { kind: "DocumentShared", userId: "b", permissions: ["read", "update"] },
      { kind: "DocumentShareRevoked", userId: "a" },
      { kind: "DocumentShared", userId: "c", permissions: ["read"] }
    ),
    foldAll: (stream) => foldDocumentShares(TENANT, "Note", "One", stream),
    foldFrom: (initial, stream) => foldDocumentSharesFrom(initial, TENANT, "Note", "One", stream)
  }),
  foldCase({
    name: "foldCustomFields",
    events: events(
      {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "alpha", type: "text" }
      },
      {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "beta", type: "number" }
      },
      { kind: "CustomFieldDisabled", doctypeName: "Note", fieldName: "alpha" }
    ),
    foldAll: (stream) => foldCustomFields(TENANT, "Note", stream),
    foldFrom: (initial, stream) => foldCustomFieldsFrom(initial, TENANT, "Note", stream)
  }),
  foldCase({
    name: "foldAssignmentRules",
    events: events(
      {
        kind: "AssignmentRuleSaved",
        doctypeName: "Note",
        rule: {
          name: "Triage",
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "manager@example.com" }]
        }
      },
      {
        kind: "AssignmentRuleSaved",
        doctypeName: "Note",
        rule: {
          name: "Escalation",
          events: ["DocumentUpdated"],
          assignees: [{ kind: "user", userId: "lead@example.com" }]
        }
      },
      {
        kind: "AssignmentRuleSaved",
        doctypeName: "Note",
        rule: {
          name: "Triage",
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "manager@example.com" }],
          enabled: false
        }
      },
      { kind: "AssignmentRuleCleared", doctypeName: "Note", ruleName: "Escalation" }
    ),
    foldAll: (stream) => foldAssignmentRules(TENANT, "Note", stream),
    foldFrom: (initial, stream) => foldAssignmentRulesFrom(initial, TENANT, "Note", stream)
  }),
  foldCase({
    name: "foldAutomationRun",
    events: events(
      {
        kind: "AutomationRunEnqueued",
        runId: "run-1",
        sourceEventId: "source-1",
        sourceEventType: "NoteUpdated",
        sourcePayloadKind: "DocumentUpdated",
        sourceDoctype: "Note",
        sourceDocumentName: "One",
        sourceActorId: USER,
        ruleId: "mirror",
        ruleName: "Mirror note",
        actionId: "update",
        action: {
          kind: "updateDocument",
          target: { doctype: "Note", name: "Two" },
          patch: { body: "mirrored" }
        },
        retry: { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 60 },
        causationId: "source-1",
        correlationId: "source-1",
        automationDepth: 1,
        automationPath: ["mirror:update"]
      },
      {
        kind: "AutomationRunClaimed",
        runId: "run-1",
        claimId: "claim-1",
        claimExpiresAt: "2026-01-01T00:05:00.000Z"
      },
      {
        kind: "AutomationRunFailed",
        runId: "run-1",
        claimId: "claim-1",
        error: "temporary",
        retryAt: "2026-01-01T00:10:00.000Z"
      },
      {
        kind: "AutomationRunClaimed",
        runId: "run-1",
        claimId: "claim-2",
        claimExpiresAt: "2026-01-01T00:15:00.000Z"
      },
      { kind: "AutomationRunDelivered", runId: "run-1", claimId: "claim-2" }
    ),
    foldAll: (stream) => foldAutomationRun(TENANT, stream),
    foldFrom: (initial, stream) => foldAutomationRunFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldDocumentDeliveryOutbox",
    events: events(
      {
        kind: "DocumentDeliveryOutboxEnqueued",
        outboxId: "source-1:email",
        target: "email",
        sourceEventId: "source-1",
        sourceEventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        doctype: "Note",
        documentName: "One",
        actorId: USER,
        payload: { body: "updated" }
      },
      { kind: "DocumentDeliveryOutboxClaimed", outboxId: "source-1:email", claimId: "claim-1" },
      {
        kind: "DocumentDeliveryOutboxFailed",
        outboxId: "source-1:email",
        claimId: "claim-1",
        error: "temporary",
        retryAt: "2026-01-01T00:10:00.000Z"
      },
      { kind: "DocumentDeliveryOutboxClaimed", outboxId: "source-1:email", claimId: "claim-2" },
      // The compaction checkpoint has to be in this list for the prefix/resume
      // split assertions to cover it at all: the discovery guard below
      // enumerates exported `fold*` functions, so a new payload kind adds no
      // case and leaves the fold green while the kind is untouched.
      {
        kind: "DocumentDeliveryOutboxCheckpointed",
        upToSequence: 4,
        carryOver: ["source-1:email"]
      },
      { kind: "DocumentDeliveryOutboxDelivered", outboxId: "source-1:email", claimId: "claim-2" }
    ),
    foldAll: (stream) => foldDocumentDeliveryOutbox(TENANT, stream),
    foldFrom: (initial, stream) => foldDocumentDeliveryOutboxFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldDocumentDeliveryOutboxRecord",
    events: events(
      {
        kind: "DocumentDeliveryOutboxEnqueued",
        outboxId: "source-1:email",
        target: "email",
        sourceEventId: "source-1",
        sourceEventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        doctype: "Note",
        documentName: "One",
        actorId: USER,
        payload: { body: "updated" }
      },
      { kind: "DocumentDeliveryOutboxClaimed", outboxId: "source-1:email", claimId: "claim-1" },
      {
        kind: "DocumentDeliveryOutboxFailed",
        outboxId: "source-1:email",
        claimId: "claim-1",
        error: "temporary",
        retryAt: "2026-01-01T00:10:00.000Z"
      },
      { kind: "DocumentDeliveryOutboxClaimed", outboxId: "source-1:email", claimId: "claim-2" },
      // A checkpoint carries no `outboxId`, so the per-record fold has to skip
      // it before the guard that compares one. Folding it here proves the skip
      // happens rather than the switch merely lacking a case.
      {
        kind: "DocumentDeliveryOutboxCheckpointed",
        upToSequence: 4,
        carryOver: ["source-1:email"]
      },
      { kind: "DocumentDeliveryOutboxDelivered", outboxId: "source-1:email", claimId: "claim-2" }
    ),
    foldAll: (stream) => foldDocumentDeliveryOutboxRecord(TENANT, "source-1:email", stream),
    foldFrom: (initial, stream) => foldDocumentDeliveryOutboxRecordFrom(initial, TENANT, "source-1:email", stream)
  }),
  foldCase({
    name: "foldEmailOutbox",
    events: events(
      {
        kind: "EmailNotificationQueued",
        messageId: "message-1",
        sourceEventId: "source-1",
        sourceEventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        ruleName: "Email owner",
        recipientId: USER,
        from: { email: "noreply@example.com" },
        to: { email: "user@example.com" },
        subject: "Note updated",
        text: "The note changed."
      },
      { kind: "EmailNotificationDeliveryClaimed", messageId: "message-1", claimId: "claim-1" },
      { kind: "EmailNotificationFailed", messageId: "message-1", claimId: "claim-1", error: "temporary" },
      { kind: "EmailNotificationDeliveryClaimed", messageId: "message-1", claimId: "claim-2" },
      { kind: "EmailNotificationSent", messageId: "message-1", claimId: "claim-2", providerMessageId: "provider-1" }
    ),
    foldAll: (stream) => foldEmailOutbox(TENANT, stream),
    foldFrom: (initial, stream) => foldEmailOutboxFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldFieldPropertyOverrides",
    events: events(
      {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: "Note",
        fieldName: "priority",
        overrides: { label: "Urgency", options: ["Low", "High"] }
      },
      {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: "Note",
        fieldName: "body",
        overrides: { label: "Details", required: true }
      },
      {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: "Note",
        fieldName: "priority",
        overrides: { label: "Priority", options: ["Low", "Medium", "High"] }
      },
      { kind: "FieldPropertyOverrideCleared", doctypeName: "Note", fieldName: "body" }
    ),
    foldAll: (stream) => foldFieldPropertyOverrides(TENANT, "Note", stream),
    foldFrom: (initial, stream) => foldFieldPropertyOverridesFrom(initial, TENANT, "Note", stream)
  }),
  foldCase({
    name: "foldNamingConfiguration",
    events: events(
      { kind: "NamingStrategySaved", doctypeName: "Note", strategy: { kind: "uuid" } },
      { kind: "NamingStrategyCleared", doctypeName: "Note" },
      { kind: "NamingStrategySaved", doctypeName: "Note", strategy: { kind: "provided" } }
    ),
    foldAll: (stream) => foldNamingConfiguration(TENANT, noteDocType, stream),
    foldFrom: (initial, stream) => foldNamingConfigurationFrom(initial, TENANT, noteDocType, stream)
  }),
  foldCase({
    name: "foldNamedWorkflowDefinition",
    events: events(
      {
        kind: "NamedWorkflowSaved",
        doctypeName: "Note",
        workflowName: REVIEW_WORKFLOW.name,
        workflow: REVIEW_WORKFLOW
      },
      { kind: "NamedWorkflowCleared", doctypeName: "Note", workflowName: REVIEW_WORKFLOW.name },
      {
        kind: "NamedWorkflowSaved",
        doctypeName: "Note",
        workflowName: REVIEW_WORKFLOW.name,
        workflow: { ...REVIEW_WORKFLOW, label: "Review lifecycle" }
      }
    ),
    foldAll: (stream) => foldNamedWorkflowDefinition(TENANT, "Note", REVIEW_WORKFLOW.name, stream),
    foldFrom: (initial, stream) =>
      foldNamedWorkflowDefinitionFrom(initial, TENANT, "Note", REVIEW_WORKFLOW.name, stream)
  }),
  foldCase({
    name: "foldNamedWorkflowFieldOwnership",
    events: events(
      {
        kind: "NamedWorkflowFieldClaimed",
        doctypeName: "Note",
        stateField: "review_state",
        workflowName: "review"
      },
      {
        kind: "NamedWorkflowFieldReleased",
        doctypeName: "Note",
        stateField: "review_state",
        workflowName: "review"
      },
      {
        kind: "NamedWorkflowFieldClaimed",
        doctypeName: "Note",
        stateField: "review_state",
        workflowName: "audit"
      }
    ),
    foldAll: (stream) => foldNamedWorkflowFieldOwnership(TENANT, "Note", "review_state", stream),
    foldFrom: (initial, stream) =>
      foldNamedWorkflowFieldOwnershipFrom(initial, TENANT, "Note", "review_state", stream)
  }),
  foldCase({
    name: "foldNotificationRules",
    events: events(
      {
        kind: "NotificationRuleSaved",
        doctypeName: "Note",
        rule: {
          name: "Notify owner",
          events: ["DocumentUpdated"],
          recipients: [{ kind: "user", userId: "owner@example.com" }]
        }
      },
      {
        kind: "NotificationRuleSaved",
        doctypeName: "Note",
        rule: {
          name: "Notify manager",
          events: ["DocumentSubmitted"],
          recipients: [{ kind: "user", userId: "manager@example.com" }]
        }
      },
      {
        kind: "NotificationRuleSaved",
        doctypeName: "Note",
        rule: {
          name: "Notify owner",
          events: ["DocumentUpdated"],
          recipients: [{ kind: "user", userId: "owner@example.com" }],
          enabled: false
        }
      },
      { kind: "NotificationRuleCleared", doctypeName: "Note", ruleName: "Notify manager" }
    ),
    foldAll: (stream) => foldNotificationRules(TENANT, "Note", stream),
    foldFrom: (initial, stream) => foldNotificationRulesFrom(initial, TENANT, "Note", stream)
  }),
  foldCase({
    name: "foldSavedListFilters",
    events: events(
      { kind: "SavedListFilterSaved", filterId: "mine", label: "My notes", ownerId: USER },
      { kind: "SavedListFilterSaved", filterId: "team", label: "Team notes", ownerId: "manager" },
      { kind: "SavedListFilterSaved", filterId: "mine", label: "My active notes", ownerId: USER },
      { kind: "SavedListFilterDeleted", filterId: "team", ownerId: "manager" }
    ),
    foldAll: (stream) => foldSavedListFilters(TENANT, noteDocType, stream),
    foldFrom: (initial, stream) => foldSavedListFiltersFrom(initial, TENANT, noteDocType, stream)
  }),
  foldCase({
    name: "foldSavedReports",
    events: events(
      {
        kind: "SavedReportSaved",
        reportId: "mine",
        label: "My notes",
        ownerId: USER,
        definition: { columns: [{ name: "title" }] }
      },
      {
        kind: "SavedReportSaved",
        reportId: "team",
        label: "Team notes",
        ownerId: "manager",
        definition: { columns: [{ name: "priority" }] }
      },
      {
        kind: "SavedReportSaved",
        reportId: "mine",
        label: "My priority notes",
        ownerId: USER,
        definition: { columns: [{ name: "title" }, { name: "priority" }] }
      },
      { kind: "SavedReportDeleted", reportId: "team", ownerId: "manager" }
    ),
    foldAll: (stream) => foldSavedReports(TENANT, noteDocType, stream),
    foldFrom: (initial, stream) => foldSavedReportsFrom(initial, TENANT, noteDocType, stream)
  }),
  foldCase({
    name: "foldUserAccount",
    events: events(
      {
        kind: "UserAccountCreated",
        userId: USER,
        email: "user@example.com",
        roles: ["User"],
        enabled: true
      },
      { kind: "UserRolesChanged", userId: USER, roles: ["User", "Reviewer"] },
      { kind: "UserAccountDisabled", userId: USER },
      { kind: "UserAccountEnabled", userId: USER }
    ),
    foldAll: (stream) => foldUserAccount(TENANT, USER, stream),
    foldFrom: (initial, stream) => foldUserAccountFrom(initial, TENANT, USER, stream)
  }),
  foldCase({
    name: "foldUserNotifications",
    events: events(
      {
        kind: "UserNotificationRecorded",
        notificationId: "notification-1",
        sourceEventId: "source-1",
        eventType: "NoteUpdated",
        payloadKind: "DocumentUpdated",
        recipientId: USER,
        doctype: "Note",
        documentName: "One",
        actorId: "owner"
      },
      { kind: "UserNotificationRead", notificationId: "notification-1" },
      { kind: "UserNotificationDismissed", notificationId: "notification-1" }
    ),
    foldAll: (stream) => foldUserNotifications(TENANT, USER, stream),
    foldFrom: (initial, stream) => foldUserNotificationsFrom(initial, TENANT, USER, stream)
  }),
  foldCase({
    name: "foldUserPermissions",
    events: events(
      {
        kind: "UserPermissionAllowed",
        userId: USER,
        targetDoctype: "Project",
        targetName: "Apollo",
        applicableDoctypes: ["Note"]
      },
      {
        kind: "UserPermissionAllowed",
        userId: USER,
        targetDoctype: "Project",
        targetName: "Gemini",
        applicableDoctypes: ["Note"]
      },
      {
        kind: "UserPermissionRevoked",
        userId: USER,
        targetDoctype: "Project",
        targetName: "Apollo",
        applicableDoctypes: ["Note"]
      }
    ),
    foldAll: (stream) => foldUserPermissions(TENANT, USER, stream),
    foldFrom: (initial, stream) => foldUserPermissionsFrom(initial, TENANT, USER, stream)
  }),
  foldCase({
    name: "foldPrintSettings",
    events: events(
      {
        kind: "PrintSettingsChanged",
        settings: { defaultLayout: { pageSize: "A4" } }
      },
      {
        kind: "PrintSettingsChanged",
        settings: { defaultLayout: { pageSize: "Letter" } }
      }
    ),
    foldAll: (stream) => foldPrintSettings(TENANT, stream),
    foldFrom: (initial, stream) => foldPrintSettingsFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldRoleCatalog",
    events: events(
      { kind: "RoleCreated", role: "Auditor", enabled: true },
      { kind: "RoleCreated", role: "Approver", enabled: true },
      { kind: "RoleDescriptionChanged", role: "Auditor", description: "reads everything" },
      { kind: "RoleDisabled", role: "Approver" },
      { kind: "RoleEnabled", role: "Approver" }
    ),
    foldAll: (stream) => foldRoleCatalog(TENANT, stream),
    foldFrom: (initial, stream) => foldRoleCatalogFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldJobScheduleOverrides",
    events: events(
      { kind: "JobScheduleOverrideSet", scheduleId: "nightly", enabled: false },
      { kind: "JobSchedulePaused", scheduleId: "hourly", pausedUntil: "2026-02-01T00:00:00.000Z" },
      { kind: "JobScheduleOverrideCleared", scheduleId: "nightly" },
      { kind: "JobScheduleOverrideSet", scheduleId: "weekly", enabled: true }
    ),
    foldAll: (stream) => foldJobScheduleOverrides(TENANT, stream),
    foldFrom: (initial, stream) => foldJobScheduleOverridesFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldJobScheduleDefinitions",
    events: events(
      {
        kind: "JobScheduleSaved",
        scheduleId: "nightly",
        cron: "0 0 * * *",
        jobName: "rebuild",
        tenantId: TENANT,
        enabled: true
      },
      {
        kind: "JobScheduleSaved",
        scheduleId: "hourly",
        cron: "0 * * * *",
        jobName: "drain",
        tenantId: TENANT,
        enabled: true
      },
      { kind: "JobScheduleDeleted", scheduleId: "nightly", tenantId: TENANT }
    ),
    foldAll: (stream) => foldJobScheduleDefinitions(stream),
    foldFrom: (initial, stream) => foldJobScheduleDefinitionsFrom(initial, stream)
  }),
  foldCase({
    name: "foldProjectionRebuild",
    events: events(
      {
        kind: "ProjectionRebuildStarted",
        runId: "rebuild-1",
        doctype: "Note",
        target: "v2",
        batchSize: 2,
        totalStreams: 4
      },
      { kind: "ProjectionRebuildAdvanced", runId: "rebuild-1", cursor: "t/Note/A", rebuilt: 1, errors: [] },
      {
        kind: "ProjectionRebuildAdvanced",
        runId: "rebuild-1",
        cursor: "t/Note/B",
        rebuilt: 0,
        errors: [{ stream: "t/Note/B", reason: "write rejected" }]
      },
      { kind: "ProjectionRebuildAdvanced", runId: "rebuild-1", cursor: "t/Note/C", rebuilt: 1, errors: [] },
      { kind: "ProjectionRebuildCompleted", runId: "rebuild-1" }
    ),
    foldAll: (stream) => foldProjectionRebuild(stream),
    foldFrom: (initial, stream) => foldProjectionRebuildFrom(initial, stream)
  }),
  foldCase({
    name: "foldUserProfile",
    events: events(
      { kind: "UserProfileChanged", userId: USER, profile: { fullName: "Ada" } },
      { kind: "UserProfileChanged", userId: USER, profile: { timeZone: "UTC" } },
      { kind: "UserProfileChanged", userId: "someone-else", profile: { fullName: "Bob" } }
    ),
    foldAll: (stream) => foldUserProfile(TENANT, USER, stream),
    foldFrom: (initial, stream) => foldUserProfileFrom(initial, TENANT, USER, stream)
  })
];

describe("fold associativity", () => {
  it("covers every fold the framework exports", () => {
    // A hardcoded count only notices a missing *case*; it cannot notice a missing
    // *fold*. Discovering the folds from the exports means a new one cannot slip
    // past this file — which is exactly how foldProjectionRebuild did.
    const exported = Object.keys(framework).filter((name) => /^fold[A-Z]/.test(name));
    const resumable = exported.filter((name) => name.endsWith("From"));
    const folds = exported.filter((name) => !name.endsWith("From"));

    expect(folds.filter((name) => !resumable.includes(`${name}From`))).toEqual([]);
    expect([...folds].sort()).toEqual([...cases.map((testCase) => testCase.name)].sort());
  });

  for (const testCase of cases) {
    describe(testCase.name, () => {
      const all = testCase.events;
      const expected = testCase.foldAll(all);

      it("folds the whole stream from an empty prior", () => {
        expect(testCase.foldFrom(null, all)).toEqual(expected);
      });

      for (let split = 0; split <= all.length; split += 1) {
        it(`resumes from a prior folded at ${split}/${all.length}`, () => {
          const head = all.slice(0, split);
          const tail = all.slice(split);
          expect(testCase.foldFrom(testCase.foldAll(head), tail)).toEqual(expected);
        });
      }

      it("is idempotent when the tail is empty", () => {
        expect(testCase.foldFrom(expected, [])).toEqual(expected);
      });
    });
  }
});
