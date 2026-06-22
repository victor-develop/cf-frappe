import type {
  Actor,
  DocTypeDefinition,
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  TenantId
} from "./types";

export interface UserPermissionGrant {
  readonly targetDoctype: DocTypeName;
  readonly targetName: DocumentName;
  readonly applicableDoctypes?: readonly DocTypeName[];
}

export interface UserPermissionState {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly version: number;
  readonly grants: readonly UserPermissionGrant[];
}

export interface UserPermissionProvider {
  permissionsFor(actor: Actor, tenantId: TenantId): Promise<readonly UserPermissionGrant[]>;
}

export function foldUserPermissions(
  tenantId: TenantId,
  userId: string,
  events: readonly DomainEvent[]
): UserPermissionState {
  const grants = new Map<string, UserPermissionGrant>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    switch (event.payload.kind) {
      case "UserPermissionAllowed": {
        if (event.payload.userId !== userId) {
          break;
        }
        const grant = normalizeUserPermissionGrant({
          targetDoctype: event.payload.targetDoctype,
          targetName: event.payload.targetName,
          ...(event.payload.applicableDoctypes !== undefined ? { applicableDoctypes: event.payload.applicableDoctypes } : {})
        });
        grants.set(userPermissionGrantKey(grant), grant);
        break;
      }
      case "UserPermissionRevoked": {
        if (event.payload.userId !== userId) {
          break;
        }
        grants.delete(
          userPermissionGrantKey(
            normalizeUserPermissionGrant({
              targetDoctype: event.payload.targetDoctype,
              targetName: event.payload.targetName,
              ...(event.payload.applicableDoctypes !== undefined ? { applicableDoctypes: event.payload.applicableDoctypes } : {})
            })
          )
        );
        break;
      }
    }
  }
  return {
    tenantId,
    userId,
    version,
    grants: [...grants.values()].sort(compareUserPermissionGrants)
  };
}

export function normalizeUserPermissionGrant(grant: UserPermissionGrant): UserPermissionGrant {
  const targetDoctype = grant.targetDoctype.trim();
  const targetName = grant.targetName.trim();
  const applicableDoctypes = uniqueSorted((grant.applicableDoctypes ?? []).map((doctype) => doctype.trim()).filter(Boolean));
  return {
    targetDoctype,
    targetName,
    ...(applicableDoctypes.length > 0 ? { applicableDoctypes } : {})
  };
}

export function userPermissionGrantKey(grant: UserPermissionGrant): string {
  return `${grant.targetDoctype}\u0000${grant.targetName}\u0000${(grant.applicableDoctypes ?? []).join("\u0001")}`;
}

export function documentMatchesUserPermissions(
  doctype: DocTypeDefinition,
  document: DocumentSnapshot,
  grants: readonly UserPermissionGrant[]
): boolean {
  const relevant = grants.filter((grant) => isGrantRelevantToDoctype(grant, doctype));
  if (relevant.length === 0) {
    return true;
  }
  const byTarget = new Map<DocTypeName, Set<DocumentName>>();
  for (const grant of relevant) {
    const names = byTarget.get(grant.targetDoctype) ?? new Set<DocumentName>();
    names.add(grant.targetName);
    byTarget.set(grant.targetDoctype, names);
  }
  for (const [targetDoctype, allowedNames] of byTarget) {
    if (!documentMatchesTargetRestriction(doctype, document, targetDoctype, allowedNames)) {
      return false;
    }
  }
  return true;
}

export function linkTargetMatchesUserPermissions(
  sourceDoctype: DocTypeDefinition,
  field: FieldDefinition,
  target: DocumentSnapshot,
  grants: readonly UserPermissionGrant[]
): boolean {
  if (field.type !== "link" || field.linkTo === undefined) {
    return true;
  }
  if (target.doctype !== field.linkTo) {
    return false;
  }
  const allowedNames = new Set<DocumentName>();
  for (const grant of grants) {
    if (isGrantRelevantToLinkField(grant, sourceDoctype, field)) {
      allowedNames.add(grant.targetName);
    }
  }
  return allowedNames.size === 0 || allowedNames.has(target.name);
}

function isGrantRelevantToDoctype(grant: UserPermissionGrant, doctype: DocTypeDefinition): boolean {
  if (!isGrantApplicableToDoctype(grant, doctype.name)) {
    return false;
  }
  return doctype.name === grant.targetDoctype || doctype.fields.some((field) => field.type === "link" && field.linkTo === grant.targetDoctype);
}

function isGrantRelevantToLinkField(
  grant: UserPermissionGrant,
  doctype: DocTypeDefinition,
  field: FieldDefinition
): boolean {
  return isGrantApplicableToDoctype(grant, doctype.name) && field.type === "link" && field.linkTo === grant.targetDoctype;
}

function isGrantApplicableToDoctype(grant: UserPermissionGrant, doctype: DocTypeName): boolean {
  return grant.applicableDoctypes === undefined || grant.applicableDoctypes.includes(doctype);
}

function documentMatchesTargetRestriction(
  doctype: DocTypeDefinition,
  document: DocumentSnapshot,
  targetDoctype: DocTypeName,
  allowedNames: ReadonlySet<DocumentName>
): boolean {
  if (doctype.name === targetDoctype) {
    return allowedNames.has(document.name);
  }
  const linkFields = doctype.fields.filter((field) => field.type === "link" && field.linkTo === targetDoctype);
  if (linkFields.length === 0) {
    return true;
  }
  return linkFields.some((field) => {
    const value = document.data[field.name];
    return typeof value === "string" && allowedNames.has(value);
  });
}

function compareUserPermissionGrants(left: UserPermissionGrant, right: UserPermissionGrant): number {
  return (
    left.targetDoctype.localeCompare(right.targetDoctype) ||
    left.targetName.localeCompare(right.targetName) ||
    (left.applicableDoctypes ?? []).join("\u0001").localeCompare((right.applicableDoctypes ?? []).join("\u0001"))
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
