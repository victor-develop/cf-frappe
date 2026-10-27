import type { MiddlewareHandler } from "hono";
import { badRequest } from "../../core/errors.js";
import { DEFAULT_TENANT_ID, type Actor } from "../../core/types.js";
import {
  MAX_PROJECTION_READ_REQUIREMENTS,
  type ProjectionCatchUpResult,
  type ProjectionReadRequirement
} from "../../application/projection-read-consistency.js";
import { isDocumentSnapshotValue } from "../../application/document-delivery-outbox-consumer-policy.js";
import type { ActorResolver } from "./actor.js";

/**
 * Carries a read-your-writes token both ways: a write response sets it, and the
 * client sends it back on the reads that must see that write.
 */
export const READ_AFTER_HEADER = "x-cf-frappe-read-after";
/** On a read that carried a token: `fresh`, `stale` (waited and gave up) or `eventual` (token not usable). */
export const CONSISTENCY_HEADER = "x-cf-frappe-consistency";

export const DEFAULT_READ_AFTER_TTL_SECONDS = 300;
const MAX_TOKEN_LENGTH = 8_192;

export interface ReadYourWritesHttpOptions {
  /** HMAC key the tokens are signed with. From an environment secret, never source. */
  readonly secret: string;
  readonly catchUp: { waitFor(requirements: readonly ProjectionReadRequirement[]): Promise<ProjectionCatchUpResult> };
  readonly ttlSeconds?: number;
  /** Seconds since the epoch. */
  readonly now?: () => number;
}

interface ReadAfterPayload {
  readonly v: 1;
  /** Tenant. */
  readonly t: string;
  /** Actor id. */
  readonly a: string;
  /** Expires at, epoch seconds. */
  readonly e: number;
  /** `[doctype, name, version]` per written document. */
  readonly d: readonly (readonly [string, string, number])[];
}

/**
 * Read-your-writes for the split projection layout, at the HTTP boundary.
 *
 * Installed on `/api/*`, so every read can honour a token — lists, reports,
 * dashboards, search, link options. Writes under `/api/resource/*` that return
 * document snapshots get a signed
 * token naming each document and the version written. A read that sends the
 * token back waits — bounded — until the projection database shows those
 * versions, then runs, and the response says whether the wait succeeded.
 *
 * The token is signed and bound to the tenant and actor that made the write for
 * one reason: waiting on a version is an oracle. An unsigned token naming any
 * document would let a caller learn whether a document they cannot read exists
 * and how far it has been edited, from whether the wait succeeded. Signed, a
 * token can only name writes its bearer made. A token for another actor or
 * tenant, or an expired one, is ignored rather than refused — it is not an
 * attack, just stale — and a forged or malformed one is a bad request.
 *
 * Installed only when the split is on, so a single-database deployment's
 * responses carry exactly the headers they always did.
 */
export function readYourWritesMiddleware(
  options: ReadYourWritesHttpOptions,
  resolveActor: ActorResolver
): MiddlewareHandler {
  if (options.secret.trim().length === 0) {
    throw badRequest("Read-your-writes secret is required");
  }
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_READ_AFTER_TTL_SECONDS;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw badRequest("Read-your-writes ttlSeconds must be a positive integer");
  }
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD") {
      const token = c.req.header(READ_AFTER_HEADER);
      if (token === undefined || token.trim().length === 0) {
        await next();
        return;
      }
      const actor = await resolveActor(c.req.raw);
      const payload = await verifyReadAfterToken(token, options.secret);
      const usable = payload.e >= now() && payload.t === actorTenant(actor) && payload.a === actor.id;
      const result = usable
        ? await options.catchUp.waitFor(payload.d.map(([doctype, name, version]) => ({
            tenantId: payload.t,
            doctype,
            name,
            version
          })))
        : undefined;
      await next();
      c.res.headers.set(CONSISTENCY_HEADER, result?.status ?? "eventual");
      return;
    }
    await next();
    if (
      !c.req.path.startsWith("/api/resource/") ||
      !c.res.ok ||
      !(c.res.headers.get("content-type") ?? "").includes("application/json")
    ) {
      return;
    }
    const actor = await resolveActor(c.req.raw);
    const tenantId = actorTenant(actor);
    const written = writtenDocuments(await c.res.clone().json(), tenantId);
    if (written.length === 0) {
      return;
    }
    c.res.headers.set(READ_AFTER_HEADER, await signReadAfterToken({
      v: 1,
      t: tenantId,
      a: actor.id,
      e: now() + ttlSeconds,
      d: written
    }, options.secret));
  };
}

/**
 * Snapshots in a write response: `data` itself, `data.document` (merge), and
 * `data.succeeded[].snapshot` (bulk). A shape walk rather than a list of routes,
 * so a new write route is covered by returning what every write route returns.
 * Bounded in depth and count; a response naming more documents than a read may
 * wait for gets no token, rather than one that silently covers some of them.
 */
function writtenDocuments(body: unknown, tenantId: string): readonly (readonly [string, string, number])[] {
  const versions = new Map<string, readonly [string, string, number]>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 3 || value === null || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (isDocumentSnapshotValue(value)) {
      if (value.tenantId === tenantId) {
        const key = JSON.stringify([value.doctype, value.name]);
        const existing = versions.get(key);
        if (existing === undefined || existing[2] < value.version) {
          versions.set(key, [value.doctype, value.name, value.version]);
        }
      }
      return;
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit((body as { readonly data?: unknown } | null)?.data, 0);
  return versions.size > MAX_PROJECTION_READ_REQUIREMENTS ? [] : [...versions.values()];
}

function actorTenant(actor: Actor): string {
  return actor.tenantId ?? DEFAULT_TENANT_ID;
}

export async function signReadAfterToken(payload: ReadAfterPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${base64UrlEncode(await hmac(body, secret))}`;
}

export async function verifyReadAfterToken(token: string, secret: string): Promise<ReadAfterPayload> {
  const parts = token.split(".");
  if (token.length > MAX_TOKEN_LENGTH || parts.length !== 2 || !parts[0] || !parts[1]) {
    throw badRequest("Read-after token is malformed");
  }
  const [body, signature] = parts as [string, string];
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    bufferOf(base64UrlDecode(signature)),
    new TextEncoder().encode(body)
  );
  if (!valid) {
    throw badRequest("Read-after token signature is invalid");
  }
  return parsePayload(body);
}

function parsePayload(body: string): ReadAfterPayload {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    throw badRequest("Read-after token is malformed");
  }
  const record = value as Partial<Record<keyof ReadAfterPayload, unknown>> | null;
  if (
    record === null ||
    typeof record !== "object" ||
    record.v !== 1 ||
    typeof record.t !== "string" ||
    typeof record.a !== "string" ||
    typeof record.e !== "number" ||
    !Number.isSafeInteger(record.e) ||
    !Array.isArray(record.d) ||
    record.d.length > MAX_PROJECTION_READ_REQUIREMENTS ||
    !record.d.every(isRequirementTuple)
  ) {
    throw badRequest("Read-after token payload is invalid");
  }
  return record as ReadAfterPayload;
}

function isRequirementTuple(value: unknown): value is readonly [string, string, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    typeof value[2] === "number" &&
    Number.isSafeInteger(value[2]) &&
    value[2] > 0;
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(value)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw badRequest("Read-after token is malformed");
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
  } catch {
    throw badRequest("Read-after token is malformed");
  }
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
