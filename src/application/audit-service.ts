import { badRequest, permissionDenied } from "../core/errors";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentEventPayload,
  type DomainEvent,
  type TenantId
} from "../core/types";
import type { AuditEventStore } from "../ports/audit-event-store";

const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 200;

const DOCUMENT_EVENT_KINDS = new Set<DocumentEventPayload["kind"]>([
  "DocumentCreated",
  "DocumentUpdated",
  "DocumentDeleted",
  "DocumentSubmitted",
  "DocumentCancelled",
  "DocumentCommentAdded",
  "DocumentAssigned",
  "DocumentUnassigned",
  "SavedListFilterSaved",
  "SavedListFilterDeleted",
  "WorkflowTransitioned",
  "DomainCommandApplied"
]);

export interface AuditServiceOptions {
  readonly events: AuditEventStore;
  readonly adminRoles?: readonly string[];
  readonly allowCrossTenantSearch?: boolean;
}

export interface SearchAuditEventsOptions {
  readonly tenantId?: TenantId;
  readonly doctype?: string;
  readonly name?: string;
  readonly actorId?: string;
  readonly kind?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

export interface AuditSearchResult {
  readonly tenantId: TenantId;
  readonly limit: number;
  readonly filters: {
    readonly doctype?: string;
    readonly name?: string;
    readonly actorId?: string;
    readonly kind?: DocumentEventPayload["kind"];
    readonly since?: string;
    readonly until?: string;
  };
  readonly events: readonly DomainEvent[];
}

export class AuditService {
  private readonly events: AuditEventStore;
  private readonly adminRoles: readonly string[];
  private readonly allowCrossTenantSearch: boolean;

  constructor(options: AuditServiceOptions) {
    this.events = options.events;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.allowCrossTenantSearch = options.allowCrossTenantSearch ?? false;
  }

  async search(actor: Actor, options: SearchAuditEventsOptions = {}): Promise<AuditSearchResult> {
    if (!this.isAdmin(actor)) {
      throw permissionDenied(`Actor '${actor.id}' cannot search audit events`);
    }
    const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
    const tenantId = options.tenantId ?? actorTenantId;
    if (!this.allowCrossTenantSearch && tenantId !== actorTenantId) {
      throw permissionDenied(`Actor '${actor.id}' cannot search audit events for tenant '${tenantId}'`);
    }
    const limit = normalizeLimit(options.limit);
    const kind = normalizeKind(options.kind);
    const filters = {
      ...(options.doctype !== undefined ? { doctype: options.doctype } : {}),
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.actorId !== undefined ? { actorId: options.actorId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
      ...(options.until !== undefined ? { until: options.until } : {})
    };
    const events = await this.events.searchEvents({
      tenantId,
      ...(filters.doctype !== undefined ? { doctype: filters.doctype } : {}),
      ...(filters.name !== undefined ? { documentName: filters.name } : {}),
      ...(filters.actorId !== undefined ? { actorId: filters.actorId } : {}),
      ...(filters.kind !== undefined ? { payloadKinds: [filters.kind] } : {}),
      ...(filters.since !== undefined ? { since: filters.since } : {}),
      ...(filters.until !== undefined ? { until: filters.until } : {}),
      limit
    });
    return { tenantId, limit, filters, events };
  }

  private isAdmin(actor: Actor): boolean {
    return this.adminRoles.some((role) => actor.roles.includes(role));
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_AUDIT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Audit limit must be a positive integer");
  }
  return Math.min(limit, MAX_AUDIT_LIMIT);
}

function normalizeKind(kind: string | undefined): DocumentEventPayload["kind"] | undefined {
  if (kind === undefined) {
    return undefined;
  }
  if (!DOCUMENT_EVENT_KINDS.has(kind as DocumentEventPayload["kind"])) {
    throw badRequest(`Unknown audit event kind '${kind}'`);
  }
  return kind as DocumentEventPayload["kind"];
}
