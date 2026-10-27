import type { DocTypeName, DocumentName, StreamName, TenantId } from "./types.js";

export function documentStream(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): StreamName {
  return `${escapePart(tenantId)}:${escapePart(doctype)}:${escapePart(name)}`;
}

export function namingSeriesStream(
  tenantId: TenantId,
  doctype: DocTypeName,
  counter: string,
  scope = ""
): StreamName {
  return documentStream(tenantId, "__NamingSeries", `${doctype}:${counter}${scope ? `:${scope}` : ""}`);
}

export function namingConfigurationStream(tenantId: TenantId, doctype: DocTypeName): StreamName {
  return documentStream(tenantId, "__NamingConfiguration", doctype);
}

export function metadataRevisionStream(tenantId: TenantId, doctype: DocTypeName): StreamName {
  return documentStream(tenantId, "__MetadataRevision", doctype);
}

export function uniqueValueStream(
  tenantId: TenantId,
  doctype: DocTypeName,
  field: string,
  value: string
): StreamName {
  return documentStream(tenantId, "__UniqueValues", `${doctype}:${field}:${value}`);
}

export function savedListFiltersStream(tenantId: TenantId, doctype: DocTypeName, ownerId: string): StreamName {
  return documentStream(tenantId, "__SavedListFilters", `${doctype}:${ownerId}`);
}

export function savedReportsStream(tenantId: TenantId, doctype: DocTypeName, ownerId: string): StreamName {
  return documentStream(tenantId, "__SavedReports", `${doctype}:${ownerId}`);
}

export function customFieldsCatalogStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__CustomFields", "__catalog");
}

export function customFieldsStream(tenantId: TenantId, doctype: DocTypeName): StreamName {
  return documentStream(tenantId, "__CustomFields", doctype);
}

export function namedWorkflowStream(
  tenantId: TenantId,
  doctype: DocTypeName,
  workflowName: string
): StreamName {
  return documentStream(tenantId, "__NamedWorkflows", `${doctype}:${workflowName}`);
}

export function namedWorkflowStateFieldStream(
  tenantId: TenantId,
  doctype: DocTypeName,
  stateField: string
): StreamName {
  return documentStream(tenantId, "__NamedWorkflowFields", `${doctype}:${stateField}`);
}

export function fieldPropertyOverridesStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__FieldProperties", "overrides");
}

export function userPermissionsStream(tenantId: TenantId, userId: string): StreamName {
  return documentStream(tenantId, "__UserPermissions", userId);
}

export function userAccountsStream(tenantId: TenantId, userId: string): StreamName {
  return documentStream(tenantId, "__UserAccounts", userId);
}

export function userProfilesStream(tenantId: TenantId, userId: string): StreamName {
  return documentStream(tenantId, "__UserProfiles", userId);
}

export function printSettingsStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__PrintSettings", "settings");
}

export function userNotificationsStream(tenantId: TenantId, userId: string): StreamName {
  return documentStream(tenantId, "__UserNotifications", userId);
}

export function notificationRulesStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__NotificationRules", "rules");
}

export function assignmentRulesStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__AssignmentRules", "rules");
}

export function emailOutboxStream(tenantId: TenantId, messageId: string): StreamName {
  return documentStream(tenantId, "__EmailOutbox", messageId);
}

export function documentDeliveryOutboxStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__DocumentDeliveryOutbox", "deliveries");
}

export function automationRunStream(tenantId: TenantId, runId: string): StreamName {
  return documentStream(tenantId, "__AutomationRuns", runId);
}

export function roleCatalogStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__Roles", "catalog");
}

export function jobScheduleOverridesStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__JobSchedules", "overrides");
}

export function jobScheduleDefinitionsStream(): StreamName {
  return documentStream("__global__", "__JobSchedules", "definitions");
}

export function escapePart(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

/**
 * Stream kinds whose events must never leave the hot database, keyed by the
 * doctype part of the stream name.
 *
 * Both are claims that a write consults before it commits: a naming series
 * counter decides the next document name, and a unique-value stream decides
 * whether a value is already taken. The archive read path would still return
 * their events — it falls back to cold storage — but these are the two places
 * where a fold that came back short would not be slow, it would be wrong:
 * a duplicate name or a duplicate unique value, committed. Keeping them hot
 * removes that whole class of failure for the price of two small stream kinds.
 *
 * Listed by doctype rather than by prefix of the full stream name because the
 * tenant comes first in the name, and derived from the stream builders above so
 * a renamed sentinel cannot leave this list pointing at nothing — see
 * `tests/core/streams-archive.test.ts`.
 */
export const ARCHIVE_PROTECTED_STREAM_DOCTYPES: readonly DocTypeName[] = [
  parseStreamName(namingSeriesStream("t", "D", "c"))!.doctype,
  parseStreamName(uniqueValueStream("t", "D", "f", "v"))!.doctype
];

/** The three parts of a stream name, decoded. */
export interface ParsedStreamName {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: string;
}

/**
 * Reverses {@link documentStream}. Every stream the framework writes is built
 * by it, and {@link escapePart} encodes `:`, so a well-formed name has exactly
 * three parts. Anything else returns null rather than a guess.
 */
export function parseStreamName(stream: StreamName): ParsedStreamName | null {
  const parts = stream.split(":");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return {
      tenantId: decodeURIComponent(parts[0]!),
      doctype: decodeURIComponent(parts[1]!),
      name: decodeURIComponent(parts[2]!)
    };
  } catch {
    return null;
  }
}

/**
 * Whether a stream's events may ever be moved to cold storage.
 *
 * A name this module cannot parse is refused too: archiving is the one
 * operation that removes rows from the hot database, so anything it does not
 * positively recognise stays where it is.
 */
export function isArchivableStream(stream: StreamName): boolean {
  const parsed = parseStreamName(stream);
  return parsed !== null && !ARCHIVE_PROTECTED_STREAM_DOCTYPES.includes(parsed.doctype);
}
