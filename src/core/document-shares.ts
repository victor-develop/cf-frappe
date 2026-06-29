import { domainEventPayloadKind } from "./domain-events.js";
import type {
  Actor,
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  DomainEvent,
  PermissionAction,
  TenantId
} from "./types.js";

export const DOCUMENT_SHARE_PERMISSIONS = ["read", "update", "share"] as const;

export type DocumentSharePermission = typeof DOCUMENT_SHARE_PERMISSIONS[number];

export interface DocumentShareGrant {
  readonly userId: string;
  readonly permissions: readonly DocumentSharePermission[];
}

export interface DocumentShareState {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly grants: readonly DocumentShareGrant[];
}

export interface DocumentShareProvider {
  sharedPermissionsFor(
    actor: Actor,
    document: DocumentSnapshot
  ): Promise<readonly DocumentSharePermission[]>;
}

export type DocumentShareStatePayloadKind =
  | "DocumentShared"
  | "DocumentShareRevoked";

export type DocumentShareStateEventPayload =
  | {
      readonly kind: "DocumentShared";
      readonly userId: string;
      readonly permissions: readonly DocumentSharePermission[];
    }
  | {
      readonly kind: "DocumentShareRevoked";
      readonly userId: string;
    };

export const DOCUMENT_SHARE_STATE_PAYLOAD_KINDS = Object.freeze([
  "DocumentShared",
  "DocumentShareRevoked"
] as const satisfies readonly DocumentShareStatePayloadKind[]);

const DOCUMENT_SHARE_STATE_PAYLOAD_KIND_SET = new Set<string>(DOCUMENT_SHARE_STATE_PAYLOAD_KINDS);

export function foldDocumentShares(
  tenantId: TenantId,
  doctype: DocTypeName,
  name: DocumentName,
  events: readonly DomainEvent[]
): DocumentShareState {
  const grants = new Map<string, DocumentShareGrant>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    if (!isDocumentShareStateEvent(event)) {
      continue;
    }
    switch (event.payload.kind) {
      case "DocumentShared": {
        const grant = normalizeDocumentShareGrant({
          userId: event.payload.userId,
          permissions: event.payload.permissions
        });
        grants.set(grant.userId, grant);
        break;
      }
      case "DocumentShareRevoked":
        grants.delete(normalizeDocumentShareUserId(event.payload.userId));
        break;
    }
  }
  return {
    tenantId,
    doctype,
    name,
    version,
    grants: [...grants.values()].sort(compareDocumentShareGrants)
  };
}

export function documentShareStateEventType(
  payload: DocumentShareStateEventPayload
): DocumentShareStatePayloadKind {
  return payload.kind;
}

export function isDocumentShareStatePayloadKind(kind: string): kind is DocumentShareStatePayloadKind {
  return DOCUMENT_SHARE_STATE_PAYLOAD_KIND_SET.has(kind);
}

function isDocumentShareStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: DocumentShareStateEventPayload } {
  return isDocumentShareStatePayloadKind(domainEventPayloadKind(event));
}

export function documentSharePermissionsForActor(
  actor: Actor,
  grants: readonly DocumentShareGrant[]
): readonly DocumentSharePermission[] {
  const actorIds = new Set([actor.id, actor.email].filter((value): value is string => typeof value === "string"));
  return uniqueSorted(
    grants
      .filter((item) => actorIds.has(item.userId))
      .flatMap((grant) => grant.permissions)
  );
}

export function documentShareAllows(
  permissions: readonly DocumentSharePermission[],
  action: PermissionAction
): boolean {
  switch (action) {
    case "read":
      return permissions.includes("read");
    case "update":
      return permissions.includes("update");
    case "share":
      return permissions.includes("share");
    default:
      return false;
  }
}

export function normalizeDocumentShareGrant(grant: {
  readonly userId: string;
  readonly permissions: readonly string[];
}): DocumentShareGrant {
  return {
    userId: normalizeDocumentShareUserId(grant.userId),
    permissions: normalizeDocumentSharePermissions(grant.permissions)
  };
}

export function normalizeDocumentShareUserId(userId: string): string {
  return userId.trim();
}

export function normalizeDocumentSharePermissions(
  permissions: readonly string[]
): readonly DocumentSharePermission[] {
  const normalized = uniqueSorted(
    permissions
      .map((permission) => normalizeDocumentSharePermission(permission))
      .filter((permission): permission is DocumentSharePermission => permission !== undefined)
  );
  if (normalized.some((permission) => permission !== "read") && !normalized.includes("read")) {
    return uniqueSorted(["read", ...normalized]);
  }
  return normalized;
}

export function invalidDocumentSharePermissions(permissions: readonly string[]): readonly string[] {
  return permissions
    .map((permission) => permission.trim())
    .filter((permission) => permission.length > 0 && normalizeDocumentSharePermission(permission) === undefined);
}

export function documentShareGrantKey(grant: DocumentShareGrant): string {
  return `${grant.userId}\u0000${grant.permissions.join("\u0001")}`;
}

function normalizeDocumentSharePermission(permission: string): DocumentSharePermission | undefined {
  const normalized = permission.trim().toLowerCase();
  if (normalized === "write") {
    return "update";
  }
  return isDocumentSharePermission(normalized) ? normalized : undefined;
}

function isDocumentSharePermission(value: string): value is DocumentSharePermission {
  return DOCUMENT_SHARE_PERMISSIONS.some((permission) => permission === value);
}

function compareDocumentShareGrants(left: DocumentShareGrant, right: DocumentShareGrant): number {
  return (
    left.userId.localeCompare(right.userId) ||
    left.permissions.join("\u0001").localeCompare(right.permissions.join("\u0001"))
  );
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
