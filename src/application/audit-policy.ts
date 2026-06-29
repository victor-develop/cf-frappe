import { badRequest, notFound } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { foldDocument } from "../core/events.js";
import type { AuditEventQuery } from "../ports/audit-event-store.js";
import type { DocumentEventPayload, DocumentSnapshot, DomainEvent, TenantId } from "../core/types.js";

export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_AUDIT_LIMIT = 200;
export const DEFAULT_DELETED_DOCUMENT_EVENT_LIMIT = 1_000;

const DOCUMENT_EVENT_KINDS = new Set<DocumentEventPayload["kind"]>([
  "DocumentCreated",
  "DocumentUpdated",
  "DocumentDeleted",
  "DocumentSubmitted",
  "DocumentCancelled",
  "DocumentCommentAdded",
  "DocumentActivityRecorded",
  "DocumentAssigned",
  "DocumentUnassigned",
  "DocumentTagged",
  "DocumentUntagged",
  "DocumentFollowed",
  "DocumentUnfollowed",
  "DocumentShared",
  "DocumentShareRevoked",
  "UserPermissionAllowed",
  "UserPermissionRevoked",
  "UserAccountCreated",
  "UserAuthProviderLinked",
  "UserAuthProviderSynced",
  "UserPasswordChanged",
  "UserPasswordResetRequested",
  "UserPasswordResetCompleted",
  "UserPasswordResetDeliveryFailed",
  "UserEmailVerificationRequested",
  "UserEmailVerified",
  "UserEmailVerificationDeliveryFailed",
  "UserRolesChanged",
  "UserAccountEnabled",
  "UserAccountDisabled",
  "UserProfileChanged",
  "PrintSettingsChanged",
  "UserNotificationRecorded",
  "UserNotificationRead",
  "UserNotificationDismissed",
  "RoleCreated",
  "RoleDescriptionChanged",
  "RoleEnabled",
  "RoleDisabled",
  "SavedListFilterSaved",
  "SavedListFilterDeleted",
  "SavedReportSaved",
  "SavedReportDeleted",
  "CustomFieldSaved",
  "CustomFieldDisabled",
  "FieldPropertyOverrideSaved",
  "FieldPropertyOverrideCleared",
  "WorkflowDefinitionSaved",
  "WorkflowDefinitionCleared",
  "NotificationRuleSaved",
  "NotificationRuleCleared",
  "AssignmentRuleSaved",
  "AssignmentRuleCleared",
  "EmailNotificationQueued",
  "EmailNotificationSent",
  "EmailNotificationDeliveryClaimed",
  "EmailNotificationFailed",
  "EmailNotificationSkipped",
  "WorkflowTransitioned",
  "DomainCommandApplied"
]);

export interface AuditSearchPolicyInput {
  readonly doctype?: string;
  readonly name?: string;
  readonly actorId?: string;
  readonly kind?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

export interface AuditSearchFilters {
  readonly doctype?: string;
  readonly name?: string;
  readonly actorId?: string;
  readonly kind?: DocumentEventPayload["kind"];
  readonly since?: string;
  readonly until?: string;
}

export interface AuditSearchPlan {
  readonly limit: number;
  readonly filters: AuditSearchFilters;
  readonly query: Omit<AuditEventQuery, "tenantId">;
}

export interface DeletedDocumentAuditProjection {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly name: string;
  readonly snapshot: DocumentSnapshot;
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly deleteEventId: string;
  readonly events: readonly DomainEvent[];
}

export interface DeletedDocumentAuditProjectionInput {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly name: string;
  readonly events: readonly DomainEvent[];
}

export function auditSearchPlan(options: AuditSearchPolicyInput = {}): AuditSearchPlan {
  const limit = normalizeAuditLimit(options.limit);
  const kind = normalizeAuditKind(options.kind);
  const filters = {
    ...(options.doctype !== undefined ? { doctype: options.doctype } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.actorId !== undefined ? { actorId: options.actorId } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
    ...(options.until !== undefined ? { until: options.until } : {})
  };
  return {
    limit,
    filters,
    query: {
      ...(filters.doctype !== undefined ? { doctype: filters.doctype } : {}),
      ...(filters.name !== undefined ? { documentName: filters.name } : {}),
      ...(filters.actorId !== undefined ? { actorId: filters.actorId } : {}),
      ...(filters.kind !== undefined ? { payloadKinds: [filters.kind] } : {}),
      ...(filters.since !== undefined ? { since: filters.since } : {}),
      ...(filters.until !== undefined ? { until: filters.until } : {}),
      limit
    }
  };
}

export function normalizeAuditLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_AUDIT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Audit limit must be a positive integer");
  }
  return Math.min(limit, MAX_AUDIT_LIMIT);
}

export function normalizeAuditKind(kind: string | undefined): DocumentEventPayload["kind"] | undefined {
  if (kind === undefined) {
    return undefined;
  }
  if (!DOCUMENT_EVENT_KINDS.has(kind as DocumentEventPayload["kind"])) {
    throw badRequest(`Unknown audit event kind '${kind}'`);
  }
  return kind as DocumentEventPayload["kind"];
}

export function normalizeDeletedDocumentEventLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DELETED_DOCUMENT_EVENT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw badRequest("Deleted document recovery event limit must be a positive integer");
  }
  return value;
}

export function assertDeletedDocumentEventWindow(events: readonly DomainEvent[], maxEvents: number): void {
  if (events.length > maxEvents) {
    throw badRequest(
      `Deleted document recovery needs more than ${maxEvents} events; narrow or raise the configured limit`
    );
  }
}

export function deletedDocumentAuditProjection(
  input: DeletedDocumentAuditProjectionInput
): DeletedDocumentAuditProjection {
  const snapshot = foldDocument(input.events);
  const deleted = [...input.events].reverse().find(isDeletedDocumentEvent);
  if (!snapshot || snapshot.docstatus !== "deleted" || !deleted) {
    throw notFound(`${input.doctype}/${input.name} is not a deleted document`);
  }
  return {
    tenantId: input.tenantId,
    doctype: input.doctype,
    name: input.name,
    snapshot,
    deletedAt: deleted.occurredAt,
    deletedBy: deleted.actorId,
    deleteEventId: deleted.id,
    events: input.events
  };
}

export function redactSensitiveAuditEvents(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return events.map(redactSensitiveAuditPayload);
}

export function redactSensitiveAuditPayload(event: DomainEvent): DomainEvent {
  if (isAuditEventPayloadKind(event, "UserAccountCreated")) {
    return {
      ...event,
      payload: {
        ...event.payload,
        ...(event.payload.passwordHash === undefined ? {} : { passwordHash: "[redacted]" })
      }
    };
  }
  if (isAuditEventPayloadKind(event, "UserPasswordChanged")) {
    return {
      ...event,
      payload: {
        ...event.payload,
        passwordHash: "[redacted]"
      }
    };
  }
  if (isAuditEventPayloadKind(event, "UserPasswordResetRequested")) {
    return {
      ...event,
      payload: {
        ...event.payload,
        tokenHash: "[redacted]"
      }
    };
  }
  if (isAuditEventPayloadKind(event, "UserPasswordResetCompleted")) {
    return {
      ...event,
      payload: {
        ...event.payload,
        passwordHash: "[redacted]"
      }
    };
  }
  if (isAuditEventPayloadKind(event, "UserEmailVerificationRequested")) {
    return {
      ...event,
      payload: {
        ...event.payload,
        tokenHash: "[redacted]"
      }
    };
  }
  return event;
}

function isDeletedDocumentEvent(event: DomainEvent): boolean {
  return domainEventPayloadKind(event) === "DocumentDeleted";
}

function isAuditEventPayloadKind<TKind extends DocumentEventPayload["kind"]>(
  event: DomainEvent,
  kind: TKind
): event is DomainEvent<Extract<DocumentEventPayload, { readonly kind: TKind }>> {
  return domainEventPayloadKind(event) === kind;
}
