import type { DocumentData, DocumentSnapshot, DomainEvent } from "./types.js";

export function foldDocument(events: readonly DomainEvent[]): DocumentSnapshot | null {
  return foldDocumentFrom(null, events);
}

export function foldDocumentFrom(
  initialSnapshot: DocumentSnapshot | null,
  events: readonly DomainEvent[]
): DocumentSnapshot | null {
  let snapshot = initialSnapshot ? cloneSnapshot(initialSnapshot) : null;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "DocumentCreated":
        snapshot = {
          tenantId: event.tenantId,
          doctype: event.doctype,
          name: event.documentName,
          version: event.sequence,
          docstatus: event.payload.docstatus,
          data: cloneData(event.payload.data),
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt
        };
        break;
      case "DocumentUpdated":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            data: applyDocumentDataChange(current.data, event.payload.patch, event.payload.unset),
            updatedAt: event.occurredAt
          };
        }
        break;
      case "WorkflowTransitioned":
      case "DomainCommandApplied":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            data: { ...current.data, ...cloneData(event.payload.patch) },
            updatedAt: event.occurredAt
          };
        }
        break;
      case "DocumentDeleted":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            docstatus: "deleted",
            updatedAt: event.occurredAt
          };
        }
        break;
      case "DocumentSubmitted":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            docstatus: "submitted",
            updatedAt: event.occurredAt
          };
        }
        break;
      case "DocumentCancelled":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            docstatus: "cancelled",
            updatedAt: event.occurredAt
          };
        }
        break;
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
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            updatedAt: event.occurredAt
          };
        }
        break;
      case "SavedListFilterSaved":
      case "SavedListFilterDeleted":
      case "UserPermissionAllowed":
      case "UserPermissionRevoked":
      case "UserAccountCreated":
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
      case "UserNotificationRecorded":
      case "UserNotificationRead":
      case "UserNotificationDismissed":
      case "RoleCreated":
      case "RoleDescriptionChanged":
      case "RoleEnabled":
      case "RoleDisabled":
      case "SavedReportSaved":
      case "SavedReportDeleted":
      case "JobScheduleOverrideSet":
      case "JobScheduleOverrideCleared":
      case "JobScheduleSaved":
      case "JobScheduleDeleted":
      case "CustomFieldSaved":
      case "CustomFieldDisabled":
        break;
    }
  }

  return snapshot;
}

export function foldDocumentAssignments(events: readonly DomainEvent[]): readonly string[] {
  const assignees = new Set<string>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "DocumentAssigned":
        assignees.add(event.payload.assigneeId);
        break;
      case "DocumentUnassigned":
        assignees.delete(event.payload.assigneeId);
        break;
    }
  }
  return [...assignees].sort((left, right) => left.localeCompare(right));
}

export function foldDocumentTags(events: readonly DomainEvent[]): readonly string[] {
  const tags = new Set<string>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "DocumentTagged":
        tags.add(event.payload.tag);
        break;
      case "DocumentUntagged":
        tags.delete(event.payload.tag);
        break;
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}

export function foldDocumentFollowers(events: readonly DomainEvent[]): readonly string[] {
  const followers = new Set<string>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "DocumentFollowed":
        followers.add(event.payload.followerId);
        break;
      case "DocumentUnfollowed":
        followers.delete(event.payload.followerId);
        break;
    }
  }
  return [...followers].sort((left, right) => left.localeCompare(right));
}

export function applyDocumentDataChange(
  data: DocumentData,
  patch: DocumentData = {},
  unset: readonly string[] = []
): DocumentData {
  const next: Record<string, unknown> = {
    ...cloneData(data),
    ...cloneData(patch)
  };
  for (const field of unset) {
    delete next[field];
  }
  return next as DocumentData;
}

function cloneData<TData extends DocumentData>(data: TData): TData {
  return JSON.parse(JSON.stringify(data)) as TData;
}

function cloneSnapshot(snapshot: DocumentSnapshot): DocumentSnapshot {
  return {
    ...snapshot,
    data: cloneData(snapshot.data)
  };
}
