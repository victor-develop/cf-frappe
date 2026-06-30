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
