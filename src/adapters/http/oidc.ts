import { permissionDenied } from "../../core/errors.js";
import {
  normalizeOidcTokenSource,
  normalizeOidcAudiences,
  normalizeOidcIssuer,
  normalizeOidcJwksUrl,
  type NormalizedOidcTokenSource,
  type OidcTokenSource
} from "../../application/access-policy.js";
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

export interface OidcActorResolverOptions<TClaims extends OidcJwtClaims = OidcJwtClaims> {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly jwksUrl: string;
  readonly fallback?: ActorResolver;
  readonly roles?: readonly string[] | ((claims: TClaims) => readonly string[]);
  readonly tenantId?: string | ((claims: TClaims) => string | undefined);
  readonly actorId?: (claims: TClaims) => string | undefined;
  readonly mapClaims?: (claims: TClaims) => Actor | Promise<Actor>;
  readonly fetchJwks?: (url: string) => Promise<OidcJwks>;
  readonly now?: () => number;
  readonly tokenSource?: OidcTokenSource | OidcTokenResolver;
}

export interface OidcAccountSyncActorResolverOptions<TClaims extends OidcJwtClaims = OidcJwtClaims>
  extends Omit<OidcActorResolverOptions<TClaims>, "mapClaims"> {
  readonly userAccounts: UserAccountService;
  readonly provider?: string;
  readonly allowed?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly subject?: (claims: TClaims) => string | undefined;
  readonly enabled?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly emailVerified?: boolean | ((claims: TClaims) => boolean | undefined);
  readonly syncActorId?: string | ((claims: TClaims) => string | undefined);
  readonly syncActorRoles?: readonly string[];
  readonly metadata?: DocumentData | ((claims: TClaims) => DocumentData | undefined);
}

export interface OidcJwtClaims extends JwtClaims {
  readonly sub?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly preferred_username?: string;
  readonly name?: string;
  readonly groups?: readonly string[];
  readonly roles?: readonly string[];
}

export interface OidcJwks extends JsonWebKeySet<OidcJsonWebKey> {}

export interface OidcJsonWebKey extends JsonWebKeyWithKid {}

export type OidcTokenResolver = (request: Request) => string | undefined;

const DEFAULT_JWKS_CACHE_TTL_SECONDS = 300;

export function hasOidcToken(request: Request, tokenSource?: OidcTokenSource | OidcTokenResolver): boolean {
  return oidcTokenFromRequest(request, normalizeTokenSource(tokenSource)) !== undefined;
}

export function oidcActorResolver<TClaims extends OidcJwtClaims = OidcJwtClaims>(
  options: OidcActorResolverOptions<TClaims>
): ActorResolver {
  const issuer = normalizeOidcIssuer(options.issuer);
  const audiences = normalizeOidcAudiences(options.audience);
  const jwksUrl = normalizeOidcJwksUrl(options.jwksUrl);
  const tokenSource = normalizeTokenSource(options.tokenSource);
  let cached: { readonly expiresAt: number; readonly jwks: OidcJwks } | undefined;
  const loadJwks = async (forceRefresh = false): Promise<JwksLookup<OidcJwks>> => {
    if (!forceRefresh && cached !== undefined && cached.expiresAt > currentSeconds(options.now)) {
      return { jwks: cached.jwks, fromCache: true };
    }
    const jwks = await fetchOidcJwks(jwksUrl, options.fetchJwks);
    cached = {
      jwks,
      expiresAt: currentSeconds(options.now) + DEFAULT_JWKS_CACHE_TTL_SECONDS
    };
    return { jwks, fromCache: false };
  };

  return async (request) => {
    const token = oidcTokenFromRequest(request, tokenSource);
    if (!token) {
      if (options.fallback) {
        return options.fallback(request);
      }
      throw permissionDenied("OIDC token is required");
    }
    const claims = await verifyOidcJwt<TClaims>(token, {
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

export function oidcAccountSyncActorResolver<TClaims extends OidcJwtClaims = OidcJwtClaims>(
  options: OidcAccountSyncActorResolverOptions<TClaims>
): ActorResolver {
  return oidcActorResolver({
    ...options,
    mapClaims: async (claims) => {
      if (booleanOptionFromClaims(claims, options.allowed) === false) {
        throw permissionDenied("OIDC token is not allowed");
      }
      const provider = firstNonBlank(options.provider) ?? "oidc";
      const email = emailFromClaims(claims);
      const subject = firstNonBlank(options.subject?.(claims), claims.sub);
      if (subject === undefined) {
        throw permissionDenied("OIDC token subject is missing");
      }
      const tenantId = tenantIdFromClaims(claims, options.tenantId);
      const roles = rolesFromClaims(claims, options.roles);
      const enabled = booleanOptionFromClaims(claims, options.enabled);
      const emailVerified = booleanOptionFromClaims(claims, options.emailVerified) ??
        (typeof claims.email_verified === "boolean" ? claims.email_verified : undefined);
      const metadata = metadataFromClaims(claims, options.metadata);
      const userId = firstNonBlank(options.actorId?.(claims), email, claims.preferred_username, claims.sub) ??
        `${provider}:${subject}`;
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
        throw permissionDenied("OIDC account is disabled");
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

async function verifyOidcJwt<TClaims extends OidcJwtClaims>(
  token: string,
  options: {
    readonly issuer: string;
    readonly audiences: ReadonlySet<string>;
    readonly now: number;
    readonly jwks: () => Promise<JwksLookup<OidcJwks>>;
    readonly refreshJwks: () => Promise<OidcJwks>;
  }
): Promise<TClaims> {
  return verifyJwtWithJwks<TClaims, OidcJwks>(token, {
    messages: {
      token: "OIDC token",
      signingKey: "OIDC signing key"
    },
    issuer: options.issuer,
    audiences: options.audiences,
    now: options.now,
    jwks: options.jwks,
    refreshJwks: options.refreshJwks,
    validateClaims: isOidcClaims
  });
}

async function fetchOidcJwks(
  jwksUrl: string,
  fetchJwks: ((url: string) => Promise<OidcJwks>) | undefined
): Promise<OidcJwks> {
  if (fetchJwks) {
    return assertJwks<OidcJwks>(await fetchJwks(jwksUrl), "OIDC signing keys");
  }
  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw permissionDenied("OIDC signing keys are unavailable");
  }
  return assertJwks<OidcJwks>(await response.json(), "OIDC signing keys");
}

function actorFromClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  options: OidcActorResolverOptions<TClaims>
): Actor {
  const id = firstNonBlank(options.actorId?.(claims), claims.email, claims.preferred_username, claims.sub);
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

function tenantIdFromClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  tenant: OidcActorResolverOptions<TClaims>["tenantId"]
): TenantId {
  const value = typeof tenant === "function" ? tenant(claims) : tenant ?? DEFAULT_TENANT_ID;
  return value && value.trim().length > 0 ? value : DEFAULT_TENANT_ID;
}

function rolesFromClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  roles: OidcActorResolverOptions<TClaims>["roles"]
): readonly string[] | undefined {
  return typeof roles === "function" ? roles(claims) : roles;
}

function emailFromClaims(claims: OidcJwtClaims): string | undefined {
  return firstNonBlank(claims.email)?.trim().toLowerCase();
}

function booleanOptionFromClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  value: boolean | ((claims: TClaims) => boolean | undefined) | undefined
): boolean | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function metadataFromClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  value: DocumentData | ((claims: TClaims) => DocumentData | undefined) | undefined
): DocumentData | undefined {
  return typeof value === "function" ? value(claims) : value;
}

function syncActorForClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  options: {
    readonly tenantId: TenantId;
    readonly provider: string;
    readonly syncActorId?: string | ((claims: TClaims) => string | undefined);
    readonly syncActorRoles?: readonly string[];
  }
): Actor {
  return {
    id: syncActorIdForClaims(claims, options.provider, options.syncActorId),
    roles: options.syncActorRoles ?? [SYSTEM_MANAGER_ROLE],
    tenantId: options.tenantId
  };
}

function syncActorIdForClaims<TClaims extends OidcJwtClaims>(
  claims: TClaims,
  provider: string,
  syncActorId: string | ((claims: TClaims) => string | undefined) | undefined
): string {
  return firstNonBlank(
    typeof syncActorId === "function" ? syncActorId(claims) : syncActorId,
    `${provider}:sync`
  ) ?? `${provider}:sync`;
}

function oidcTokenFromRequest(
  request: Request,
  tokenSource: NormalizedOidcTokenSource | OidcTokenResolver
): string | undefined {
  if (typeof tokenSource === "function") {
    return firstNonBlank(tokenSource(request));
  }
  if (tokenSource.header) {
    const token = tokenFromHeader(request.headers.get(tokenSource.header), tokenSource.scheme);
    if (token !== undefined) {
      return token;
    }
  }
  if (tokenSource.cookie) {
    return firstNonBlank(parseCookies(request.headers.get("cookie")).get(tokenSource.cookie));
  }
  return undefined;
}

function tokenFromHeader(value: string | null, scheme: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (scheme === undefined) {
    return trimmed;
  }
  const parts = tokenHeaderParts(trimmed);
  if (parts === undefined || parts.scheme.toLowerCase() !== scheme) {
    return undefined;
  }
  return firstNonBlank(parts.token);
}

function tokenHeaderParts(value: string): { readonly scheme: string; readonly token: string } | undefined {
  const match = /^(\S+)\s+(.+)$/u.exec(value);
  const scheme = match?.[1];
  const token = match?.[2];
  if (scheme === undefined || token === undefined) {
    return undefined;
  }
  return { scheme, token };
}

function normalizeTokenSource(
  tokenSource: OidcTokenSource | OidcTokenResolver | undefined
): NormalizedOidcTokenSource | OidcTokenResolver {
  if (tokenSource === undefined) {
    return normalizeOidcTokenSource(undefined);
  }
  if (typeof tokenSource === "function") {
    return tokenSource;
  }
  return normalizeOidcTokenSource(tokenSource);
}

function isOidcClaims(claims: JwtClaims): boolean {
  return (claims.email_verified === undefined || typeof claims.email_verified === "boolean") &&
    (claims.preferred_username === undefined || typeof claims.preferred_username === "string") &&
    (claims.groups === undefined || isStringArray(claims.groups)) &&
    (claims.roles === undefined || isStringArray(claims.roles));
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}
