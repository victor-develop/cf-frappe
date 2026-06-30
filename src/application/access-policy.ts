import { badRequest } from "../core/errors.js";

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

const DEFAULT_OIDC_TOKEN_SOURCE: NormalizedOidcTokenSource = {
  header: "authorization",
  scheme: "bearer"
};
const HTTP_TOKEN_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

export function normalizeOidcTokenSource(tokenSource: OidcTokenSource | undefined): NormalizedOidcTokenSource {
  if (tokenSource === undefined) {
    return DEFAULT_OIDC_TOKEN_SOURCE;
  }
  const header = firstNonBlank(tokenSource.header);
  const cookie = firstNonBlank(tokenSource.cookie);
  const scheme = firstNonBlank(tokenSource.scheme)?.toLowerCase();
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

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}
