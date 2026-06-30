import { badRequest, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type TenantId
} from "../core/types.js";

export function isPermissionDeniedError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}

export function normalizeCloudflareAccessTeamDomain(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  if (trimmed.length === 0) {
    throw badRequest("Cloudflare Access teamDomain is required");
  }
  return trimmed;
}

export function normalizeCloudflareAccessAudiences(audience: string | readonly string[]): ReadonlySet<string> {
  const values = (Array.isArray(audience) ? audience : [audience]).map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw badRequest("Cloudflare Access audience is required");
  }
  return new Set(values);
}

export function normalizeOidcIssuer(issuer: string): string {
  const trimmed = issuer.trim();
  if (trimmed.length === 0) {
    throw badRequest("OIDC issuer is required");
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw badRequest("OIDC issuer must be an HTTPS URL");
  }
  return trimmed;
}

export function normalizeOidcJwksUrl(jwksUrl: string): string {
  const trimmed = jwksUrl.trim();
  if (trimmed.length === 0) {
    throw badRequest("OIDC jwksUrl is required");
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url.toString();
  } catch {
    throw badRequest("OIDC jwksUrl must be an HTTPS URL");
  }
}

export function normalizeOidcAudiences(audience: string | readonly string[]): ReadonlySet<string> {
  const values = (Array.isArray(audience) ? audience : [audience]).map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw badRequest("OIDC audience is required");
  }
  return new Set(values);
}

export interface OidcTokenSource {
  readonly header?: string;
  readonly scheme?: string;
  readonly cookie?: string;
}

export interface NormalizedOidcTokenSource {
  readonly header?: string;
  readonly scheme?: string;
  readonly cookie?: string;
}

export interface OidcActorClaims {
  readonly sub?: string;
  readonly email?: string;
  readonly preferred_username?: string;
}

export interface OidcActorMappingOptions<TClaims extends OidcActorClaims = OidcActorClaims> {
  readonly roles?: readonly string[] | ((claims: TClaims) => readonly string[]);
  readonly tenantId?: string | ((claims: TClaims) => string | undefined);
  readonly actorId?: (claims: TClaims) => string | undefined;
}

export interface OidcAccountSyncClaims extends OidcActorClaims {
  readonly email_verified?: boolean;
}

export interface OidcAccountSyncProjectionOptions<
  TClaims extends OidcAccountSyncClaims = OidcAccountSyncClaims
> extends OidcActorMappingOptions<TClaims> {
  readonly provider?: string;
  readonly subject?: (claims: TClaims) => string | undefined;
  readonly enabled?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly emailVerified?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly metadata?: DocumentData | ((claims: TClaims) => DocumentData | undefined);
}

export interface OidcAccountSyncProjection {
  readonly provider: string;
  readonly subject: string;
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerified?: boolean;
  readonly metadata?: DocumentData;
}

export interface OidcAccountSyncAccessOptions<TClaims extends OidcAccountSyncClaims = OidcAccountSyncClaims> {
  readonly allowed?: boolean | ((claims: TClaims) => boolean | undefined);
}

export interface OidcSyncActorOptions<TClaims extends OidcActorClaims = OidcActorClaims> {
  readonly tenantId: TenantId;
  readonly provider: string;
  readonly syncActorId?: string | ((claims: TClaims) => string | undefined);
  readonly syncActorRoles?: readonly string[];
}

export interface OidcSyncedAccount {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly tenantId: TenantId;
  readonly enabled: boolean;
  readonly email?: string;
}

export interface CloudflareAccessSyncedAccount {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly tenantId: TenantId;
  readonly enabled: boolean;
  readonly email?: string;
}

export interface CloudflareAccessActorClaims {
  readonly sub?: string;
  readonly email?: string;
}

export interface CloudflareAccessActorMappingOptions<
  TClaims extends CloudflareAccessActorClaims = CloudflareAccessActorClaims
> {
  readonly roles?: readonly string[] | ((claims: TClaims) => readonly string[]);
  readonly tenantId?: string | ((claims: TClaims) => string | undefined);
  readonly actorId?: (claims: TClaims) => string | undefined;
}

export interface CloudflareAccessAccountSyncProjectionOptions<
  TClaims extends CloudflareAccessActorClaims = CloudflareAccessActorClaims
> extends CloudflareAccessActorMappingOptions<TClaims> {
  readonly provider?: string;
  readonly subject?: (claims: TClaims) => string | undefined;
  readonly enabled?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly emailVerified?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly metadata?: DocumentData | ((claims: TClaims) => DocumentData | undefined);
}

export interface CloudflareAccessAccountSyncProjection {
  readonly provider: string;
  readonly subject: string;
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerified?: boolean;
  readonly metadata?: DocumentData;
}

export interface CloudflareAccessSyncActorOptions<
  TClaims extends CloudflareAccessActorClaims = CloudflareAccessActorClaims
> {
  readonly tenantId: TenantId;
  readonly provider: string;
  readonly syncActorId?: string | ((claims: TClaims) => string | undefined);
  readonly syncActorRoles?: readonly string[];
}

const DEFAULT_OIDC_TOKEN_SOURCE: NormalizedOidcTokenSource = {
  header: "authorization",
  scheme: "bearer"
};
const HTTP_TOKEN_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

export function normalizeOidcTokenSource(tokenSource: OidcTokenSource | undefined): NormalizedOidcTokenSource {
  if (tokenSource === undefined) {
    return DEFAULT_OIDC_TOKEN_SOURCE;
  }
  const header = firstNonBlankTrimmed(tokenSource.header);
  const cookie = firstNonBlankTrimmed(tokenSource.cookie);
  const scheme = firstNonBlankTrimmed(tokenSource.scheme)?.toLowerCase();
  if (header !== undefined && !isHttpTokenName(header)) {
    throw badRequest("OIDC token source header is invalid");
  }
  if (cookie !== undefined && !isHttpTokenName(cookie)) {
    throw badRequest("OIDC token source cookie is invalid");
  }
  if (scheme !== undefined && !isHttpTokenName(scheme)) {
    throw badRequest("OIDC token source scheme is invalid");
  }
  if (header === undefined && cookie === undefined) {
    throw badRequest("OIDC token source is required");
  }
  if (scheme !== undefined && header === undefined) {
    throw badRequest("OIDC token source scheme requires a header");
  }
  return {
    ...(header === undefined ? {} : { header: header.toLowerCase() }),
    ...(scheme === undefined ? {} : { scheme }),
    ...(cookie === undefined ? {} : { cookie })
  };
}

export function resolveOidcActorFromClaims<TClaims extends OidcActorClaims>(
  claims: TClaims,
  options: OidcActorMappingOptions<TClaims> = {}
): Actor {
  const id = firstNonBlankValue(options.actorId?.(claims), claims.email, claims.preferred_username, claims.sub);
  if (id === undefined || id.trim().length === 0) {
    throw permissionDenied("OIDC token subject is missing");
  }
  const roles = typeof options.roles === "function" ? options.roles(claims) : options.roles ?? ["User"];
  const normalizedRoles = roles.filter(
    (role): role is string => typeof role === "string" && role.trim().length > 0
  );
  if (normalizedRoles.length === 0 || normalizedRoles.length !== roles.length) {
    throw permissionDenied("OIDC actor roles are invalid");
  }
  const tenantId = tenantIdFromOidcActorClaims(claims, options.tenantId);
  const email = firstNonBlankValue(claims.email);
  return {
    id,
    roles: normalizedRoles,
    tenantId,
    ...(email === undefined ? {} : { email })
  };
}

export function resolveOidcAccountSyncProjection<TClaims extends OidcAccountSyncClaims>(
  claims: TClaims,
  options: OidcAccountSyncProjectionOptions<TClaims> = {}
): OidcAccountSyncProjection {
  const provider = firstNonBlankValue(options.provider) ?? "oidc";
  const email = emailFromOidcClaims(claims);
  const subject = firstNonBlankValue(options.subject?.(claims), claims.sub);
  if (subject === undefined) {
    throw permissionDenied("OIDC token subject is missing");
  }
  const tenantId = tenantIdFromOidcActorClaims(claims, options.tenantId);
  const roles = rolesFromOidcActorClaims(claims, options.roles);
  const enabled = booleanOptionFromOidcClaims(claims, options.enabled);
  const emailVerified = booleanOptionFromOidcClaims(claims, options.emailVerified) ??
    (typeof claims.email_verified === "boolean" ? claims.email_verified : undefined);
  const metadata = metadataFromOidcClaims(claims, options.metadata);
  const userId = firstNonBlankValue(options.actorId?.(claims), email, claims.preferred_username, claims.sub) ??
    `${provider}:${subject}`;
  return {
    provider,
    subject,
    userId,
    tenantId,
    ...(email === undefined ? {} : { email }),
    ...(roles === undefined ? {} : { roles }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(emailVerified === undefined ? {} : { emailVerified }),
    ...(metadata === undefined ? {} : { metadata })
  };
}

export function resolveOidcSyncActorFromClaims<TClaims extends OidcActorClaims>(
  claims: TClaims,
  options: OidcSyncActorOptions<TClaims>
): Actor {
  return {
    id: syncActorIdFromOidcClaims(claims, options.provider, options.syncActorId),
    roles: options.syncActorRoles ?? [SYSTEM_MANAGER_ROLE],
    tenantId: options.tenantId
  };
}

export function ensureOidcClaimsAllowed<TClaims extends OidcAccountSyncClaims>(
  claims: TClaims,
  options: OidcAccountSyncAccessOptions<TClaims> = {}
): void {
  if (booleanOptionFromOidcClaims(claims, options.allowed) === false) {
    throw permissionDenied("OIDC token is not allowed");
  }
}

export function resolveOidcSyncedAccountActor(account: OidcSyncedAccount): Actor {
  if (!account.enabled) {
    throw permissionDenied("OIDC account is disabled");
  }
  return {
    id: account.userId,
    roles: account.roles,
    tenantId: account.tenantId,
    ...(account.email === undefined ? {} : { email: account.email })
  };
}

export function resolveCloudflareAccessActorFromClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  options: CloudflareAccessActorMappingOptions<TClaims> = {}
): Actor {
  const id = firstNonBlankValue(options.actorId?.(claims), claims.email, claims.sub);
  if (id === undefined || id.trim().length === 0) {
    throw permissionDenied("Cloudflare Access JWT subject is missing");
  }
  const roles = typeof options.roles === "function" ? options.roles(claims) : options.roles ?? ["User"];
  const normalizedRoles = roles.filter(
    (role): role is string => typeof role === "string" && role.trim().length > 0
  );
  if (normalizedRoles.length === 0 || normalizedRoles.length !== roles.length) {
    throw permissionDenied("Cloudflare Access actor roles are invalid");
  }
  const tenantId = tenantIdFromCloudflareAccessActorClaims(claims, options.tenantId);
  const email = firstNonBlankValue(claims.email);
  return {
    id,
    roles: normalizedRoles,
    tenantId,
    ...(email === undefined ? {} : { email })
  };
}

export function resolveCloudflareAccessAccountSyncProjection<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  options: CloudflareAccessAccountSyncProjectionOptions<TClaims> = {}
): CloudflareAccessAccountSyncProjection {
  const provider = firstNonBlankValue(options.provider) ?? "cloudflare-access";
  const email = emailFromCloudflareAccessClaims(claims);
  const subject = firstNonBlankValue(options.subject?.(claims), claims.sub, email);
  if (subject === undefined) {
    throw permissionDenied("Cloudflare Access JWT subject is missing");
  }
  const tenantId = tenantIdFromCloudflareAccessActorClaims(claims, options.tenantId);
  const roles = rolesFromCloudflareAccessActorClaims(claims, options.roles);
  const enabled = booleanOptionFromCloudflareAccessClaims(claims, options.enabled);
  const emailVerified = booleanOptionFromCloudflareAccessClaims(claims, options.emailVerified) ??
    (email === undefined ? undefined : true);
  const metadata = metadataFromCloudflareAccessClaims(claims, options.metadata);
  const userId = firstNonBlankValue(options.actorId?.(claims), email, claims.sub) ?? `${provider}:${subject}`;
  return {
    provider,
    subject,
    userId,
    tenantId,
    ...(email === undefined ? {} : { email }),
    ...(roles === undefined ? {} : { roles }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(emailVerified === undefined ? {} : { emailVerified }),
    ...(metadata === undefined ? {} : { metadata })
  };
}

export function resolveCloudflareAccessSyncActorFromClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  options: CloudflareAccessSyncActorOptions<TClaims>
): Actor {
  return {
    id: syncActorIdFromCloudflareAccessClaims(claims, options.provider, options.syncActorId),
    roles: options.syncActorRoles ?? [SYSTEM_MANAGER_ROLE],
    tenantId: options.tenantId
  };
}

export function resolveCloudflareAccessSyncedAccountActor(account: CloudflareAccessSyncedAccount): Actor {
  if (!account.enabled) {
    throw permissionDenied("Cloudflare Access account is disabled");
  }
  return {
    id: account.userId,
    roles: account.roles,
    tenantId: account.tenantId,
    ...(account.email === undefined ? {} : { email: account.email })
  };
}

export function isValidOidcJwtClaimShape(claims: object): boolean {
  const values = claims as {
    readonly email_verified?: unknown;
    readonly preferred_username?: unknown;
    readonly groups?: unknown;
    readonly roles?: unknown;
  };
  return (values.email_verified === undefined || typeof values.email_verified === "boolean") &&
    (values.preferred_username === undefined || typeof values.preferred_username === "string") &&
    (values.groups === undefined || isStringArray(values.groups)) &&
    (values.roles === undefined || isStringArray(values.roles));
}

export function isValidCloudflareAccessJwtClaimShape(claims: object): boolean {
  const values = claims as { readonly groups?: unknown };
  return values.groups === undefined || isStringArray(values.groups);
}

export function normalizeOidcRoleList(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/gu, " ");
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      roles.push(normalized);
    }
  }
  return roles;
}

export function normalizeOidcClaimNameList(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return normalized;
}

export function normalizeOidcHostedDomainSet(domains: string | readonly string[] | undefined): ReadonlySet<string> {
  return new Set(
    normalizeOidcClaimNameList(domains === undefined ? [] : Array.isArray(domains) ? domains : [domains])
      .map((domain) => domain.toLowerCase())
  );
}

function isHttpTokenName(value: string): boolean {
  return HTTP_TOKEN_NAME.test(value);
}

function tenantIdFromOidcActorClaims<TClaims extends OidcActorClaims>(
  claims: TClaims,
  tenant: OidcActorMappingOptions<TClaims>["tenantId"]
): TenantId {
  const value = typeof tenant === "function" ? tenant(claims) : tenant ?? DEFAULT_TENANT_ID;
  return value && value.trim().length > 0 ? value : DEFAULT_TENANT_ID;
}

function rolesFromOidcActorClaims<TClaims extends OidcActorClaims>(
  claims: TClaims,
  roles: OidcActorMappingOptions<TClaims>["roles"]
): readonly string[] | undefined {
  return typeof roles === "function" ? roles(claims) : roles;
}

function emailFromOidcClaims(claims: OidcAccountSyncClaims): string | undefined {
  return firstNonBlankValue(claims.email)?.trim().toLowerCase();
}

function booleanOptionFromOidcClaims<TClaims extends OidcAccountSyncClaims>(
  claims: TClaims,
  value: boolean | ((claims: TClaims) => boolean | undefined) | undefined
): boolean | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function metadataFromOidcClaims<TClaims extends OidcAccountSyncClaims>(
  claims: TClaims,
  value: DocumentData | ((claims: TClaims) => DocumentData | undefined) | undefined
): DocumentData | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function syncActorIdFromOidcClaims<TClaims extends OidcActorClaims>(
  claims: TClaims,
  provider: string,
  syncActorId: string | ((claims: TClaims) => string | undefined) | undefined
): string {
  return firstNonBlankValue(
    typeof syncActorId === "function" ? syncActorId(claims) : syncActorId,
    `${provider}:sync`
  ) ?? `${provider}:sync`;
}

function tenantIdFromCloudflareAccessActorClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  tenant: CloudflareAccessActorMappingOptions<TClaims>["tenantId"]
): TenantId {
  const value = typeof tenant === "function" ? tenant(claims) : tenant ?? DEFAULT_TENANT_ID;
  return value && value.trim().length > 0 ? value : DEFAULT_TENANT_ID;
}

function rolesFromCloudflareAccessActorClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  roles: CloudflareAccessActorMappingOptions<TClaims>["roles"]
): readonly string[] | undefined {
  return typeof roles === "function" ? roles(claims) : roles;
}

function emailFromCloudflareAccessClaims(claims: CloudflareAccessActorClaims): string | undefined {
  return firstNonBlankValue(claims.email)?.trim().toLowerCase();
}

function booleanOptionFromCloudflareAccessClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  value: boolean | ((claims: TClaims) => boolean | undefined) | undefined
): boolean | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function metadataFromCloudflareAccessClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  value: DocumentData | ((claims: TClaims) => DocumentData | undefined) | undefined
): DocumentData | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function syncActorIdFromCloudflareAccessClaims<TClaims extends CloudflareAccessActorClaims>(
  claims: TClaims,
  provider: string,
  syncActorId: string | ((claims: TClaims) => string | undefined) | undefined
): string {
  return firstNonBlankValue(
    typeof syncActorId === "function" ? syncActorId(claims) : syncActorId,
    `${provider}:sync`
  ) ?? `${provider}:sync`;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function firstNonBlankTrimmed(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function firstNonBlankValue(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}
