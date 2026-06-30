import { permissionDenied } from "../../core/errors.js";
import {
  ensureOidcClaimsAllowed,
  normalizeOidcTokenSource,
  resolveOidcAccountSyncProjection,
  resolveOidcActorFromClaims,
  resolveOidcSyncActorFromClaims,
  resolveOidcSyncedAccountActor,
  normalizeOidcAudiences,
  normalizeOidcIssuer,
  normalizeOidcJwksUrl,
  type NormalizedOidcTokenSource,
  type OidcTokenSource
} from "../../application/access-policy.js";
import {
  type Actor,
  type DocumentData
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
    return resolveOidcActorFromClaims(claims, options);
  };
}

export function oidcAccountSyncActorResolver<TClaims extends OidcJwtClaims = OidcJwtClaims>(
  options: OidcAccountSyncActorResolverOptions<TClaims>
): ActorResolver {
  return oidcActorResolver({
    ...options,
    mapClaims: async (claims) => {
      ensureOidcClaimsAllowed(claims, options);
      const projection = resolveOidcAccountSyncProjection(claims, options);
      const account = await options.userAccounts.syncProvider({
        actor: resolveOidcSyncActorFromClaims(claims, {
          tenantId: projection.tenantId,
          provider: projection.provider,
          ...(options.syncActorId === undefined ? {} : { syncActorId: options.syncActorId }),
          ...(options.syncActorRoles === undefined ? {} : { syncActorRoles: options.syncActorRoles })
        }),
        provider: projection.provider,
        subject: projection.subject,
        userId: projection.userId,
        ...(projection.email === undefined ? {} : { email: projection.email }),
        ...(projection.roles === undefined ? {} : { roles: projection.roles }),
        ...(projection.enabled === undefined ? {} : { enabled: projection.enabled }),
        ...(projection.emailVerified === undefined ? {} : { emailVerified: projection.emailVerified }),
        tenantId: projection.tenantId,
        ...(projection.metadata === undefined ? {} : { metadata: projection.metadata })
      });
      return resolveOidcSyncedAccountActor(account);
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
