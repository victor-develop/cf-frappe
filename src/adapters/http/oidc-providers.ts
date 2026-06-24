import type { DocumentData, JsonValue } from "../../core/types.js";
import type { OidcAccountSyncActorResolverOptions, OidcJwtClaims } from "./oidc.js";

export type OidcProviderPreset<TClaims extends OidcJwtClaims = OidcJwtClaims> = Pick<
  OidcAccountSyncActorResolverOptions<TClaims>,
  | "provider"
  | "allowed"
  | "subject"
  | "actorId"
  | "roles"
  | "tenantId"
  | "enabled"
  | "emailVerified"
  | "metadata"
>;

export interface OidcClaimRoleMapperOptions {
  readonly claimNames?: readonly string[];
  readonly rolePrefix?: string;
  readonly baseRoles?: readonly string[];
}

export interface OktaOidcClaims extends OidcJwtClaims {
  readonly uid?: string;
}

export interface OktaOidcProviderPresetOptions {
  readonly provider?: string;
  readonly groupClaim?: string;
  readonly rolePrefix?: string;
  readonly baseRoles?: readonly string[];
  readonly metadataClaims?: readonly string[];
}

export interface Auth0OidcClaims extends OidcJwtClaims {
  readonly permissions?: readonly string[];
  readonly org_id?: string;
  readonly org_name?: string;
  readonly [claim: string]: unknown;
}

export interface Auth0OidcProviderPresetOptions {
  readonly provider?: string;
  readonly namespace?: string;
  readonly roleClaim?: string;
  readonly rolePrefix?: string;
  readonly baseRoles?: readonly string[];
  readonly includePermissions?: boolean;
  readonly permissionClaim?: string;
  readonly permissionRolePrefix?: string;
  readonly tenantClaim?: string;
  readonly metadataClaims?: readonly string[];
}

export interface GoogleWorkspaceOidcClaims extends OidcJwtClaims {
  readonly hd?: string;
}

export interface GoogleWorkspaceOidcProviderPresetOptions {
  readonly provider?: string;
  readonly hostedDomains?: string | readonly string[];
  readonly tenantId?: string | ((claims: GoogleWorkspaceOidcClaims, hostedDomain: string | undefined) => string | undefined);
  readonly baseRoles?: readonly string[];
  readonly metadataClaims?: readonly string[];
}

const DEFAULT_BASE_ROLES = ["User"] as const;

export function oidcClaimRoleMapper<TClaims extends OidcJwtClaims = OidcJwtClaims>(
  options: OidcClaimRoleMapperOptions = {}
): (claims: TClaims) => readonly string[] {
  const claimNames = normalizeStringList(options.claimNames ?? ["roles"]);
  const rolePrefix = options.rolePrefix ?? "";
  const baseRoles = normalizeRoles(options.baseRoles ?? DEFAULT_BASE_ROLES);
  return (claims) =>
    normalizeRoles([
      ...baseRoles,
      ...claimNames.flatMap((claimName) =>
        claimStringValues(claims, claimName).map((role) => prefixedRole(rolePrefix, role))
      )
    ]);
}

export function oidcGroupsRoleMapper<TClaims extends OidcJwtClaims = OidcJwtClaims>(
  options: Omit<OidcClaimRoleMapperOptions, "claimNames"> = {}
): (claims: TClaims) => readonly string[] {
  return oidcClaimRoleMapper({
    ...options,
    claimNames: ["groups"],
    rolePrefix: options.rolePrefix ?? "OIDC:"
  });
}

export function oktaOidcProviderPreset(
  options: OktaOidcProviderPresetOptions = {}
): OidcProviderPreset<OktaOidcClaims> {
  const groupClaim = options.groupClaim ?? "groups";
  return withOptionalMetadata(
    {
      provider: options.provider ?? "okta",
      roles: oidcClaimRoleMapper<OktaOidcClaims>({
        claimNames: [groupClaim],
        rolePrefix: options.rolePrefix ?? "Okta:",
        ...(options.baseRoles === undefined ? {} : { baseRoles: options.baseRoles })
      })
    },
    options.metadataClaims
  );
}

export function auth0OidcProviderPreset(
  options: Auth0OidcProviderPresetOptions = {}
): OidcProviderPreset<Auth0OidcClaims> {
  const roleClaim = namespacedClaim(options.namespace, options.roleClaim ?? "roles");
  const permissionClaim = options.permissionClaim ?? "permissions";
  const rolePrefix = options.rolePrefix ?? "Auth0:";
  const permissionRolePrefix = options.permissionRolePrefix ?? "Auth0Permission:";
  const tenantClaim = options.tenantClaim ?? "org_id";
  return withOptionalMetadata(
    {
      provider: options.provider ?? "auth0",
      tenantId: (claims) => claimString(claims, tenantClaim),
      roles: (claims) =>
        normalizeRoles([
          ...(options.baseRoles ?? DEFAULT_BASE_ROLES),
          ...claimStringValues(claims, roleClaim).map((role) => prefixedRole(rolePrefix, role)),
          ...(options.includePermissions === true
            ? claimStringValues(claims, permissionClaim).map((permission) =>
                prefixedRole(permissionRolePrefix, permission)
              )
            : [])
        ])
    },
    options.metadataClaims
  );
}

export function googleWorkspaceOidcProviderPreset(
  options: GoogleWorkspaceOidcProviderPresetOptions = {}
): OidcProviderPreset<GoogleWorkspaceOidcClaims> {
  const hostedDomains = normalizeDomainSet(options.hostedDomains);
  const tenantId = options.tenantId;
  return withOptionalMetadata(
    {
      provider: options.provider ?? "google",
      allowed: (claims) => {
        if (claims.email_verified !== true) {
          return false;
        }
        if (hostedDomains.size === 0) {
          return true;
        }
        const hostedDomain = hostedDomainFromClaims(claims);
        return hostedDomain !== undefined && hostedDomains.has(hostedDomain);
      },
      emailVerified: (claims) => claims.email_verified === true,
      roles: () => normalizeRoles(options.baseRoles ?? DEFAULT_BASE_ROLES),
      ...(tenantId === undefined
        ? {}
        : {
            tenantId:
              typeof tenantId === "function"
                ? (claims: GoogleWorkspaceOidcClaims) => tenantId(claims, hostedDomainFromClaims(claims))
                : tenantId
          })
    },
    options.metadataClaims
  );
}

function withOptionalMetadata<TClaims extends OidcJwtClaims>(
  preset: OidcProviderPreset<TClaims>,
  metadataClaims: readonly string[] | undefined
): OidcProviderPreset<TClaims> {
  const normalized = normalizeStringList(metadataClaims ?? []);
  if (normalized.length === 0) {
    return preset;
  }
  return {
    ...preset,
    metadata: (claims) => metadataFromClaims(claims, normalized)
  };
}

function metadataFromClaims(claims: OidcJwtClaims, claimNames: readonly string[]): DocumentData | undefined {
  const metadata: Record<string, JsonValue> = {};
  for (const claimName of claimNames) {
    const value = claimValue(claims, claimName);
    const metadataValue = jsonClaimValue(value);
    if (metadataValue !== undefined) {
      metadata[claimName] = metadataValue;
    }
  }
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function namespacedClaim(namespace: string | undefined, claimName: string): string {
  const normalizedClaim = claimName.trim();
  const normalizedNamespace = namespace?.trim();
  if (!normalizedNamespace || normalizedClaim.includes("://")) {
    return normalizedClaim;
  }
  return `${normalizedNamespace.replace(/\/+$/u, "")}/${normalizedClaim.replace(/^\/+/u, "")}`;
}

function claimString(claims: OidcJwtClaims, claimName: string): string | undefined {
  const value = claimValue(claims, claimName);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function claimStringValues(claims: OidcJwtClaims, claimName: string): readonly string[] {
  const value = claimValue(claims, claimName);
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function claimValue(claims: OidcJwtClaims, claimName: string): unknown {
  return (claims as unknown as Record<string, unknown>)[claimName];
}

function normalizeRoles(values: readonly string[]): readonly string[] {
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

function prefixedRole(prefix: string, value: string): string {
  return `${prefix}${value.trim().replace(/\s+/gu, " ")}`;
}

function normalizeStringList(values: readonly string[]): readonly string[] {
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

function normalizeDomainSet(domains: string | readonly string[] | undefined): ReadonlySet<string> {
  return new Set(
    normalizeStringList(domains === undefined ? [] : Array.isArray(domains) ? domains : [domains])
      .map((domain) => domain.toLowerCase())
  );
}

function hostedDomainFromClaims(claims: GoogleWorkspaceOidcClaims): string | undefined {
  const hostedDomain = claims.hd?.trim().toLowerCase();
  if (hostedDomain) {
    return hostedDomain;
  }
  const email = claims.email?.trim().toLowerCase();
  const at = email?.lastIndexOf("@") ?? -1;
  return at > -1 ? email?.slice(at + 1) : undefined;
}

function jsonClaimValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return undefined;
}
