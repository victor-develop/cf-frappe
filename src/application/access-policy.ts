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
