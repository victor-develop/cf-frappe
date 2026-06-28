import { badRequest, permissionDenied } from "../../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type TenantId
} from "../../core/types.js";
import type { UserAccountService } from "../../application/user-account-service.js";
import type { ActorResolver } from "./actor.js";
import { parseCookies } from "./cookies.js";
import {
  assertJwks,
  currentSeconds,
  verifyJwtWithJwks,
  type JsonWebKeySet,
  type JsonWebKeyWithKid,
  type JwtClaims,
  type JwksLookup
} from "./jwt.js";

export interface CloudflareAccessActorResolverOptions {
  readonly teamDomain: string;
  readonly audience: string | readonly string[];
  readonly fallback?: ActorResolver;
  readonly roles?: readonly string[] | ((claims: CloudflareAccessJwtClaims) => readonly string[]);
  readonly tenantId?: string | ((claims: CloudflareAccessJwtClaims) => string | undefined);
  readonly actorId?: (claims: CloudflareAccessJwtClaims) => string | undefined;
  readonly mapClaims?: (claims: CloudflareAccessJwtClaims) => Actor | Promise<Actor>;
  readonly fetchJwks?: (url: string) => Promise<CloudflareAccessJwks>;
  readonly now?: () => number;
}

export interface CloudflareAccessAccountSyncActorResolverOptions extends Omit<CloudflareAccessActorResolverOptions, "mapClaims"> {
  readonly userAccounts: UserAccountService;
  readonly provider?: string;
  readonly subject?: (claims: CloudflareAccessJwtClaims) => string | undefined;
  readonly enabled?: boolean | ((claims: CloudflareAccessJwtClaims) => boolean | undefined);
  readonly emailVerified?: boolean | ((claims: CloudflareAccessJwtClaims) => boolean | undefined);
  readonly syncActorId?: string | ((claims: CloudflareAccessJwtClaims) => string | undefined);
  readonly syncActorRoles?: readonly string[];
  readonly metadata?: DocumentData | ((claims: CloudflareAccessJwtClaims) => DocumentData | undefined);
}

export interface CloudflareAccessJwtClaims extends JwtClaims {
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly sub?: string;
  readonly email?: string;
  readonly name?: string;
  readonly groups?: readonly string[];
  readonly [claim: string]: unknown;
}

export interface CloudflareAccessJwks extends JsonWebKeySet<CloudflareAccessJsonWebKey> {}

export interface CloudflareAccessJsonWebKey extends JsonWebKeyWithKid {}

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const ACCESS_JWT_COOKIE = "CF_Authorization";
const DEFAULT_JWKS_CACHE_TTL_SECONDS = 300;

export function hasCloudflareAccessToken(request: Request): boolean {
  return accessTokenFromRequest(request) !== undefined;
}

export function cloudflareAccessActorResolver(options: CloudflareAccessActorResolverOptions): ActorResolver {
  const teamDomain = normalizeTeamDomain(options.teamDomain);
  const issuer = `https://${teamDomain}`;
  const audiences = normalizeAudiences(options.audience);
  let cached: { readonly expiresAt: number; readonly jwks: CloudflareAccessJwks } | undefined;
  const loadJwks = async (forceRefresh = false): Promise<JwksLookup> => {
    if (!forceRefresh && cached !== undefined && cached.expiresAt > currentSeconds(options.now)) {
      return { jwks: cached.jwks, fromCache: true };
    }
    const jwks = await fetchCloudflareAccessJwks(teamDomain, options.fetchJwks);
    cached = {
      jwks,
      expiresAt: currentSeconds(options.now) + DEFAULT_JWKS_CACHE_TTL_SECONDS
    };
    return { jwks, fromCache: false };
  };

  return async (request) => {
    const token = accessTokenFromRequest(request);
    if (!token) {
      if (options.fallback) {
        return options.fallback(request);
      }
      throw permissionDenied("Cloudflare Access JWT is required");
    }
    const claims = await verifyCloudflareAccessJwt(token, {
      issuer,
      audiences,
      now: currentSeconds(options.now),
      jwks: () => loadJwks(),
      refreshJwks: async () => (await loadJwks(true)).jwks
    });
    if (options.mapClaims) {
      return options.mapClaims(claims);
    }
    return actorFromClaims(claims, options);
  };
}

export function cloudflareAccessAccountSyncActorResolver(
  options: CloudflareAccessAccountSyncActorResolverOptions
): ActorResolver {
  return cloudflareAccessActorResolver({
    ...options,
    mapClaims: async (claims) => {
      const provider = firstNonBlank(options.provider) ?? "cloudflare-access";
      const email = emailFromClaims(claims);
      const subject = firstNonBlank(options.subject?.(claims), claims.sub, email);
      if (subject === undefined) {
        throw permissionDenied("Cloudflare Access JWT subject is missing");
      }
      const tenantId = tenantIdFromClaims(claims, options.tenantId);
      const roles = rolesFromClaims(claims, options.roles);
      const enabled = booleanOptionFromClaims(claims, options.enabled);
      const emailVerified = booleanOptionFromClaims(claims, options.emailVerified) ?? (email === undefined ? undefined : true);
      const metadata = metadataFromClaims(claims, options.metadata);
      const userId = firstNonBlank(options.actorId?.(claims), email, claims.sub) ?? `${provider}:${subject}`;
      const account = await options.userAccounts.syncProvider({
        actor: syncActorForClaims(claims, {
          tenantId,
          provider,
          ...(options.syncActorId === undefined ? {} : { syncActorId: options.syncActorId }),
          ...(options.syncActorRoles === undefined ? {} : { syncActorRoles: options.syncActorRoles })
        }),
        provider,
        subject,
        userId,
        ...(email === undefined ? {} : { email }),
        ...(roles === undefined ? {} : { roles }),
        ...(enabled === undefined ? {} : { enabled }),
        ...(emailVerified === undefined ? {} : { emailVerified }),
        tenantId,
        ...(metadata === undefined ? {} : { metadata })
      });
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
  });
}

async function verifyCloudflareAccessJwt(
  token: string,
  options: {
    readonly issuer: string;
    readonly audiences: ReadonlySet<string>;
    readonly now: number;
    readonly jwks: () => Promise<JwksLookup<CloudflareAccessJwks>>;
    readonly refreshJwks: () => Promise<CloudflareAccessJwks>;
  }
): Promise<CloudflareAccessJwtClaims> {
  return verifyJwtWithJwks<CloudflareAccessJwtClaims, CloudflareAccessJwks>(token, {
    messages: {
      token: "Cloudflare Access JWT",
      signingKey: "Cloudflare Access signing key"
    },
    issuer: options.issuer,
    audiences: options.audiences,
    now: options.now,
    jwks: options.jwks,
    refreshJwks: options.refreshJwks,
    validateClaims: isCloudflareAccessClaims
  });
}

async function fetchCloudflareAccessJwks(
  teamDomain: string,
  fetchJwks: ((url: string) => Promise<CloudflareAccessJwks>) | undefined
): Promise<CloudflareAccessJwks> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (fetchJwks) {
    return assertJwks(await fetchJwks(url), "Cloudflare Access signing keys");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw permissionDenied("Cloudflare Access signing keys are unavailable");
  }
  return assertJwks(await response.json(), "Cloudflare Access signing keys");
}

function actorFromClaims(
  claims: CloudflareAccessJwtClaims,
  options: CloudflareAccessActorResolverOptions
): Actor {
  const id = firstNonBlank(options.actorId?.(claims), claims.email, claims.sub);
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
  const tenantId = typeof options.tenantId === "function"
    ? options.tenantId(claims)
    : options.tenantId ?? DEFAULT_TENANT_ID;
  const email = firstNonBlank(claims.email);
  return {
    id,
    roles: normalizedRoles,
    tenantId: tenantId && tenantId.trim().length > 0 ? tenantId : DEFAULT_TENANT_ID,
    ...(email === undefined ? {} : { email })
  };
}

function tenantIdFromClaims(
  claims: CloudflareAccessJwtClaims,
  tenant: CloudflareAccessActorResolverOptions["tenantId"]
): TenantId {
  const value = typeof tenant === "function" ? tenant(claims) : tenant ?? DEFAULT_TENANT_ID;
  return value && value.trim().length > 0 ? value : DEFAULT_TENANT_ID;
}

function rolesFromClaims(
  claims: CloudflareAccessJwtClaims,
  roles: CloudflareAccessActorResolverOptions["roles"]
): readonly string[] | undefined {
  return typeof roles === "function" ? roles(claims) : roles;
}

function emailFromClaims(claims: CloudflareAccessJwtClaims): string | undefined {
  return firstNonBlank(claims.email)?.trim().toLowerCase();
}

function booleanOptionFromClaims(
  claims: CloudflareAccessJwtClaims,
  value: boolean | ((claims: CloudflareAccessJwtClaims) => boolean | undefined) | undefined
): boolean | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function metadataFromClaims(
  claims: CloudflareAccessJwtClaims,
  value: DocumentData | ((claims: CloudflareAccessJwtClaims) => DocumentData | undefined) | undefined
): DocumentData | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function syncActorForClaims(
  claims: CloudflareAccessJwtClaims,
  options: {
    readonly tenantId: TenantId;
    readonly provider: string;
    readonly syncActorId?: string | ((claims: CloudflareAccessJwtClaims) => string | undefined);
    readonly syncActorRoles?: readonly string[];
  }
): Actor {
  return {
    id: syncActorIdForClaims(claims, options.provider, options.syncActorId),
    roles: options.syncActorRoles ?? [SYSTEM_MANAGER_ROLE],
    tenantId: options.tenantId
  };
}

function syncActorIdForClaims(
  claims: CloudflareAccessJwtClaims,
  provider: string,
  syncActorId: string | ((claims: CloudflareAccessJwtClaims) => string | undefined) | undefined
): string {
  return firstNonBlank(
    typeof syncActorId === "function" ? syncActorId(claims) : syncActorId,
    `${provider}:sync`
  ) ?? `${provider}:sync`;
}

function accessTokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get(ACCESS_JWT_HEADER);
  if (header && header.trim().length > 0) {
    return header.trim();
  }
  return firstNonBlank(parseCookies(request.headers.get("cookie")).get(ACCESS_JWT_COOKIE));
}

function normalizeTeamDomain(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  if (trimmed.length === 0) {
    throw badRequest("Cloudflare Access teamDomain is required");
  }
  return trimmed;
}

function normalizeAudiences(audience: string | readonly string[]): ReadonlySet<string> {
  const values = (Array.isArray(audience) ? audience : [audience]).map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw badRequest("Cloudflare Access audience is required");
  }
  return new Set(values);
}

function isCloudflareAccessClaims(claims: JwtClaims): boolean {
  return claims.groups === undefined || isStringArray(claims.groups);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}
