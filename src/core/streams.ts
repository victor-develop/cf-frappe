import type { DocTypeName, DocumentName, StreamName, TenantId } from "./types.js";

export function documentStream(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): StreamName {
  return `${escapePart(tenantId)}:${escapePart(doctype)}:${escapePart(name)}`;
}

export function namingSeriesStream(tenantId: TenantId, doctype: DocTypeName, pattern: string): StreamName {
  return documentStream(tenantId, "__NamingSeries", `${doctype}:${pattern}`);
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

export function workflowDefinitionsStream(tenantId: TenantId): StreamName {
  return documentStream(tenantId, "__Workflows", "definitions");
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
