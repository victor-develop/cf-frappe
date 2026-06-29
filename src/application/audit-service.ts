import { permissionDenied } from "../core/errors.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentEventPayload,
  type DocumentSnapshot,
  type DomainEvent,
  type TenantId
} from "../core/types.js";
import type { AuditEventStore } from "../ports/audit-event-store.js";
import {
  assertDeletedDocumentEventWindow,
  auditSearchPlan,
  deletedDocumentAuditProjection,
  normalizeDeletedDocumentEventLimit,
  planAuditTenantAccess,
  redactSensitiveAuditEvents
} from "./audit-policy.js";

export interface AuditServiceOptions {
  readonly events: AuditEventStore;
  readonly adminRoles?: readonly string[];
  readonly allowCrossTenantSearch?: boolean;
  readonly maxDeletedDocumentEvents?: number;
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

export interface RecoverDeletedDocumentOptions {
  readonly tenantId?: TenantId;
  readonly doctype: string;
  readonly name: string;
}

export interface DeletedDocumentAudit {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly name: string;
  readonly snapshot: DocumentSnapshot;
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly deleteEventId: string;
  readonly events: readonly DomainEvent[];
}

export class AuditService {
  private readonly events: AuditEventStore;
  private readonly adminRoles: readonly string[];
  private readonly allowCrossTenantSearch: boolean;
  private readonly maxDeletedDocumentEvents: number;

  constructor(options: AuditServiceOptions) {
    this.events = options.events;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.allowCrossTenantSearch = options.allowCrossTenantSearch ?? false;
    this.maxDeletedDocumentEvents = normalizeDeletedDocumentEventLimit(options.maxDeletedDocumentEvents);
  }

  async search(actor: Actor, options: SearchAuditEventsOptions = {}): Promise<AuditSearchResult> {
    const tenantId = this.authorizeTenant(actor, options.tenantId);
    const plan = auditSearchPlan(options);
    const events = await this.events.searchEvents({
      tenantId,
      ...plan.query
    });
    return { tenantId, limit: plan.limit, filters: plan.filters, events: redactSensitiveAuditEvents(events) };
  }

  async recoverDeletedDocument(
    actor: Actor,
    options: RecoverDeletedDocumentOptions
  ): Promise<DeletedDocumentAudit> {
    const tenantId = this.authorizeTenant(actor, options.tenantId);
    const events = await this.events.readDocumentEvents({
      tenantId,
      doctype: options.doctype,
      documentName: options.name,
      limit: this.maxDeletedDocumentEvents + 1
    });
    assertDeletedDocumentEventWindow(events, this.maxDeletedDocumentEvents);
    return deletedDocumentAuditProjection({
      tenantId,
      doctype: options.doctype,
      name: options.name,
      events
    });
  }

  private authorizeTenant(actor: Actor, tenantId: TenantId | undefined): TenantId {
    const decision = planAuditTenantAccess({
      actor,
      adminRoles: this.adminRoles,
      allowCrossTenantSearch: this.allowCrossTenantSearch,
      ...(tenantId === undefined ? {} : { explicitTenantId: tenantId })
    });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return decision.tenantId;
  }
}
