import { badRequest } from "../core/errors.js";
import type { RoleRecord } from "../core/roles.js";
import type { UserAccount } from "../core/user-accounts.js";
import type { JsonValue } from "../core/types.js";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

export interface ScimUserWrite {
  readonly userId?: string | undefined;
  readonly externalId?: string | undefined;
  readonly email?: string | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly active?: boolean | undefined;
}

export interface ScimUserResource extends ScimUserWrite {
  readonly userName: string;
  readonly userId: string;
  readonly externalId: string;
  readonly roles: readonly string[];
  readonly meta: {
    readonly resourceType: "User";
    readonly created?: string;
    readonly lastModified?: string;
    readonly location?: string;
  };
}

export interface ScimGroupWrite {
  readonly displayName: string;
  readonly description?: string;
  readonly enabled?: boolean;
}

export interface ScimGroupResource {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly active: boolean;
  readonly members?: readonly ScimGroupMember[];
  readonly meta: {
    readonly resourceType: "Group";
    readonly created?: string;
    readonly lastModified?: string;
    readonly location?: string;
  };
}

export interface ScimGroupMember {
  readonly value: string;
  readonly display?: string;
}

export interface ScimGroupPatch {
  readonly description?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly addMembers: readonly string[];
  readonly removeMembers: readonly string[];
}

export interface ScimListOptions {
  readonly startIndex: number;
  readonly count: number;
}

export interface ScimListResponse<TResource> {
  readonly schemas: readonly string[];
  readonly totalResults: number;
  readonly startIndex: number;
  readonly itemsPerPage: number;
  readonly Resources: readonly unknown[];
}

export const SCIM_DEFAULT_PAGE_SIZE = 100;
export const SCIM_MAX_PAGE_SIZE = 1_000;

export function parseScimUser(value: unknown): ScimUserWrite {
  const body = scimObject(value, "SCIM user");
  const userId = optionalScimString(body.userName, "userName");
  const externalId = optionalScimString(body.externalId, "externalId");
  const email = parseScimEmail(body.emails) ?? optionalScimString(body.email, "email");
  const roles = parseScimRoleValues(body.roles);
  const groups = parseScimGroupValues(body.groups);
  const active = body.active === undefined ? undefined : parseScimBoolean(body.active, "active");
  return {
    ...(userId === undefined ? {} : { userId }),
    ...(externalId === undefined ? {} : { externalId }),
    ...(email === undefined ? {} : { email }),
    ...(roles === undefined ? {} : { roles }),
    ...(groups === undefined ? {} : { roles: groups }),
    ...(active === undefined ? {} : { active })
  };
}

export function parseScimPatch(value: unknown): readonly ScimUserWrite[] {
  const body = scimObject(value, "SCIM patch operation");
  const operations = body.Operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw badRequest("SCIM patch Operations must include at least one operation");
  }
  return operations.map((operation) => parseScimPatchOperation(operation));
}

export function applyScimUserPatch(
  current: ScimUserResource,
  patches: readonly ScimUserWrite[]
): ScimUserWrite {
  const result: MutableScimUserWrite = {
    userId: current.userId,
    externalId: current.externalId,
    ...(current.email === undefined ? {} : { email: current.email }),
    roles: [...current.roles],
    active: current.active
  };
  for (const patch of patches) {
    if (patch.userId !== undefined) {
      result.userId = patch.userId;
    }
    if (patch.externalId !== undefined) {
      result.externalId = patch.externalId;
    }
    if (patch.email !== undefined) {
      result.email = patch.email;
    }
    if (patch.roles !== undefined) {
      result.roles = [...patch.roles];
    }
    if (patch.active !== undefined) {
      result.active = patch.active;
    }
  }
  return result;
}

export function parseScimGroup(value: unknown): ScimGroupWrite {
  const body = scimObject(value, "SCIM group");
  const displayName = optionalScimString(body.displayName, "displayName");
  if (displayName === undefined) {
    throw badRequest("SCIM group displayName is required");
  }
  const description = optionalScimString(body.description, "description");
  const active = body.active === undefined ? undefined : parseScimBoolean(body.active, "active");
  return {
    displayName,
    ...(description === undefined ? {} : { description }),
    ...(active === undefined ? {} : { enabled: active })
  };
}

export function parseScimGroupPatch(current: ScimGroupResource, value: unknown): ScimGroupPatch {
  const body = scimObject(value, "SCIM patch operation");
  const operations = body.Operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw badRequest("SCIM patch Operations must include at least one operation");
  }
  const result: {
    description?: string | undefined;
    enabled?: boolean | undefined;
    readonly addMembers: string[];
    readonly removeMembers: string[];
  } = {
    addMembers: [],
    removeMembers: []
  };
  for (const operation of operations) {
    const patch = scimObject(operation, "SCIM patch operation");
    const op = optionalScimString(patch.op, "op")?.toLowerCase();
    const path = optionalScimString(patch.path, "path");
    const value = patch.value;
    if (op !== "add" && op !== "remove" && op !== "replace") {
      throw badRequest("SCIM patch op must be add, remove, or replace");
    }
    if (path !== undefined && scimPathField(path) === "description") {
      result.description = optionalScimString(value, "description");
      continue;
    }
    if (path !== undefined && (scimPathField(path) === "active" || scimPathField(path) === "enabled")) {
      result.enabled = parseScimBoolean(value, "active");
      continue;
    }
    if (path !== undefined && scimPathField(path) !== "members") {
      throw badRequest(`SCIM group patch path '${path}' is not supported`);
    }
    if (op === "replace" && path === undefined) {
      const replacement = parseScimGroup(patch.value);
      result.description = replacement.description;
      result.enabled = replacement.enabled;
      continue;
    }
    const filterValue = path === undefined ? undefined : scimMemberFilterValue(path);
    const memberIds = filterValue === undefined
      ? parseScimMemberIds(value, op === "remove")
      : [filterValue];
    if (op === "add") {
      result.addMembers.push(...memberIds);
    } else {
      result.removeMembers.push(...memberIds);
    }
  }
  return result;
}

export function parseScimListOptions(query: URLSearchParams): ScimListOptions {
  const startIndex = parseScimQueryInteger(query.get("startIndex"), "startIndex", 1, Number.MAX_SAFE_INTEGER, 1);
  const count = parseScimQueryInteger(query.get("count"), "count", 1, SCIM_MAX_PAGE_SIZE, SCIM_DEFAULT_PAGE_SIZE);
  return { startIndex, count };
}

export function scimListResponse<TResource>(
  resources: readonly TResource[],
  startIndex: number,
  totalResults: number
): ScimListResponse<TResource> {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources as readonly unknown[]
  };
}

export function scimUserResource(
  account: UserAccount,
  externalId: string,
  location: string
): ScimUserResource {
  return {
    userId: account.userId,
    userName: account.userId,
    externalId,
    ...(account.email === undefined ? {} : { email: account.email }),
    roles: [...account.roles],
    active: account.enabled,
    meta: {
      resourceType: "User",
      ...(account.createdAt === undefined ? {} : { created: account.createdAt }),
      ...(account.updatedAt === undefined ? {} : { lastModified: account.updatedAt }),
      location
    }
  };
}

export function scimGroupResource(role: RoleRecord, location: string): ScimGroupResource {
  return {
    id: role.name,
    displayName: role.name,
    ...(role.description === undefined ? {} : { description: role.description }),
    active: role.enabled,
    meta: {
      resourceType: "Group",
      ...(role.createdAt === undefined ? {} : { created: role.createdAt }),
      ...(role.updatedAt === undefined ? {} : { lastModified: role.updatedAt }),
      location
    }
  };
}

export function scimUserFilterMatches(
  resource: ScimUserResource,
  filter: string | undefined
): boolean {
  if (filter === undefined) {
    return true;
  }
  const parsed = parseScimEqualityFilter(filter);
  if (parsed === undefined) {
    throw badRequest("SCIM filter must use the form 'attribute eq \"value\"'");
  }
  const actual = scimUserFilterValue(resource, parsed.attribute);
  return actual?.localeCompare(parsed.value, undefined, { sensitivity: "accent" }) === 0;
}

export function scimExternalId(account: UserAccount, requested?: string | undefined): string {
  if (requested !== undefined) {
    return requested;
  }
  const provider = account.providers?.find((link) => link.provider === "scim");
  return provider?.subject ?? account.userId;
}

export function scimMetadata(input: DocumentData) {
  return input;
}

interface MutableScimUserWrite {
  userId: string;
  externalId: string;
  email?: string;
  roles: readonly string[];
  active: boolean | undefined;
}

type DocumentData = Record<string, JsonValue>;

function parseScimPatchOperation(operation: unknown): ScimUserWrite {
  const operationBody = scimObject(operation, "SCIM patch operation");
  const op = optionalScimString(operationBody.op, "op")?.toLowerCase();
  if (op !== "add" && op !== "remove" && op !== "replace") {
    throw badRequest("SCIM patch op must be add, remove, or replace");
  }
  const path = optionalScimString(operationBody.path, "path");
  if (path === undefined) {
    return parseScimUserPatchValue(operationBody.value);
  }
  const field = scimPathField(path);
  const value = operationBody.value;
  if (field === "userName") {
    const userId = optionalScimString(value, "userName");
    return userId === undefined ? {} : { userId };
  }
  if (field === "externalId") {
    const externalId = optionalScimString(value, "externalId");
    return externalId === undefined ? {} : { externalId };
  }
  if (field === "emails" || field === "email") {
    const email = optionalScimString(value, "email");
    return email === undefined ? {} : { email };
  }
  if (field === "active") {
    return { active: parseScimBoolean(value, "active") };
  }
  if (field === "roles") {
    const roles = parseScimRoleValues(value);
    if (op === "remove" && roles === undefined) {
      return { roles: [] };
    }
    if (roles === undefined) {
      return {};
    }
    if (op === "add") {
      return { roles: [...roles] };
    }
    return { roles };
  }
  if (field === "groups" || field === "members") {
    const groups = parseScimGroupValues(value);
    if (groups === undefined) {
      throw badRequest("SCIM group patch requires group values");
    }
    if (op === "remove") {
      return {};
    }
    return { roles: groups };
  }
  throw badRequest(`SCIM user patch path '${path}' is not supported`);
}

function parseScimUserPatchValue(value: unknown): ScimUserWrite {
  const body = scimObject(value, "SCIM patch value");
  return parseScimUser(body);
}

function parseScimEmail(value: unknown): string | undefined {
  if (typeof value === "string") {
    return optionalScimString(value, "email");
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    const item = typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : undefined;
    const email = item === undefined ? undefined : optionalScimString(item.value, "email");
    if (email !== undefined) {
      return email;
    }
  }
  return undefined;
}

function parseScimRoleValues(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const roles: string[] = [];
  for (const entry of value) {
    const role = optionalScimString(
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).value
        : entry,
      "role"
    );
    if (role !== undefined) {
      roles.push(role);
    }
  }
  return roles;
}

function parseScimGroupValues(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const groups: string[] = [];
  for (const entry of value) {
    const item = typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : undefined;
    const group = item === undefined
      ? optionalScimString(entry, "group")
      : optionalScimString(item.value ?? item.displayName, "group");
    if (group !== undefined) {
      groups.push(group);
    }
  }
  return groups;
}

function parseScimMemberIds(value: unknown, allowEmpty: boolean): readonly string[] {
  const values = Array.isArray(value) ? value : value === undefined && allowEmpty ? [] : [value];
  const memberIds: string[] = [];
  for (const entry of values) {
    const item = typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : undefined;
    const memberId = item === undefined ? optionalScimString(entry, "member") : optionalScimString(item.value, "member");
    if (memberId !== undefined) {
      memberIds.push(memberId);
    }
  }
  return memberIds;
}

function scimMemberFilterValue(path: string): string | undefined {
  const match = /value eq "((?:\\.|[^"])*)"/u.exec(path);
  const value = match?.[1];
  return value === undefined ? undefined : unquoteScimValue(value);
}

function scimPathField(path: string): string {
  const [first] = path.split(".");
  return (first ?? path).split("[")[0]?.trim() ?? "";
}

function parseScimEqualityFilter(filter: string): { readonly attribute: string; readonly value: string } | undefined {
  const match = /^([\w.]+)\s+eq\s+"((?:\\.|[^"])*)"$/u.exec(filter.trim());
  if (match === null) {
    return undefined;
  }
  return {
    attribute: match[1]?.toLowerCase() ?? "",
    value: unquoteScimValue(match[2] ?? "")
  };
}

function scimUserFilterValue(resource: ScimUserResource, attribute: string): string | undefined {
  switch (attribute) {
    case "id":
    case "username":
      return resource.userId;
    case "externalid":
      return resource.externalId;
    case "email":
      return resource.email;
    case "emails.value":
      return resource.email;
    default:
      return undefined;
  }
}

function unquoteScimValue(value: string): string {
  try {
    return JSON.parse(`"${value.replaceAll('"', '\\"')}"`) as string;
  } catch {
    return value;
  }
}

function scimObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function optionalScimString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseScimBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }
  return value;
}

function parseScimQueryInteger(
  value: string | null,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw badRequest(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}
