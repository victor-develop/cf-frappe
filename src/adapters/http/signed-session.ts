import { badRequest, permissionDenied } from "../../core/errors.js";
import { DEFAULT_TENANT_ID, type Actor } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { parseCookies } from "./cookies.js";

export interface SignedSessionOptions {
  readonly secret: string;
  readonly cookieName?: string;
  readonly now?: () => number;
}

export interface SignedSessionActorResolverOptions extends SignedSessionOptions {
  readonly fallback?: ActorResolver;
  readonly validate?: (session: SignedSessionValidation) => Actor | Promise<Actor>;
}

export interface CreateSignedSessionCookieOptions extends SignedSessionOptions {
  readonly maxAgeSeconds: number;
  readonly accountVersion?: number;
  readonly path?: string;
  readonly sameSite?: "Lax" | "Strict" | "None";
  readonly secure?: boolean;
}

export interface ClearSignedSessionCookieOptions {
  readonly cookieName?: string;
  readonly path?: string;
  readonly sameSite?: "Lax" | "Strict" | "None";
  readonly secure?: boolean;
}

interface SignedSessionPayload {
  readonly version: 1;
  readonly actor: Actor;
  readonly accountVersion?: number;
  readonly expiresAt: number;
}

const DEFAULT_SESSION_COOKIE = "cf_frappe_session";

export interface SignedSessionValidation {
  readonly actor: Actor;
  readonly accountVersion?: number;
  readonly expiresAt: number;
}

export function signedSessionActorResolver(options: SignedSessionActorResolverOptions): ActorResolver {
  ensureSecret(options.secret);
  return async (request) => {
    const token = parseCookies(request.headers.get("cookie")).get(options.cookieName ?? DEFAULT_SESSION_COOKIE);
    if (!token) {
      if (options.fallback) {
        return options.fallback(request);
      }
      throw permissionDenied("Session cookie is required");
    }
    const session = await verifySignedSession(token, options);
    if (options.validate) {
      return options.validate({
        actor: session.actor,
        ...(session.accountVersion === undefined ? {} : { accountVersion: session.accountVersion }),
        expiresAt: session.expiresAt
      });
    }
    return session.actor;
  };
}

export async function createSignedSessionCookie(
  actor: Actor,
  options: CreateSignedSessionCookieOptions
): Promise<string> {
  ensureSecret(options.secret);
  if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 1) {
    throw badRequest("Session maxAgeSeconds must be a positive integer");
  }
  const now = currentSeconds(options.now);
  const payload = {
    version: 1,
    actor: normalizeActor(actor),
    ...(options.accountVersion === undefined ? {} : { accountVersion: normalizeAccountVersion(options.accountVersion) }),
    expiresAt: now + options.maxAgeSeconds
  } satisfies SignedSessionPayload;
  const token = await signSessionPayload(payload, options.secret);
  return serializeCookie(options.cookieName ?? DEFAULT_SESSION_COOKIE, token, {
    maxAgeSeconds: options.maxAgeSeconds,
    path: options.path ?? "/",
    sameSite: options.sameSite ?? "Lax",
    secure: options.secure ?? true
  });
}

export function clearSignedSessionCookie(options: ClearSignedSessionCookieOptions = {}): string {
  return serializeCookie(options.cookieName ?? DEFAULT_SESSION_COOKIE, "", {
    maxAgeSeconds: 0,
    path: options.path ?? "/",
    sameSite: options.sameSite ?? "Lax",
    secure: options.secure ?? true
  });
}

async function verifySignedSession(
  token: string,
  options: SignedSessionOptions
): Promise<SignedSessionPayload> {
  ensureSecret(options.secret);
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart || token.split(".").length !== 2) {
    throw permissionDenied("Session token is malformed");
  }
  if (!(await verifyHmacSha256(payloadPart, signaturePart, options.secret))) {
    throw permissionDenied("Session signature is invalid");
  }
  const parsed = parseSessionPayload(payloadPart);
  if (parsed.expiresAt < currentSeconds(options.now)) {
    throw permissionDenied("Session expired");
  }
  return parsed;
}

async function signSessionPayload(payload: SignedSessionPayload, secret: string): Promise<string> {
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(payloadPart, secret);
  return `${payloadPart}.${base64UrlEncode(signature)}`;
}

async function hmacSha256(value: string, secret: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function verifyHmacSha256(value: string, signature: string, secret: string): Promise<boolean> {
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    arrayBufferFromBytes(base64UrlDecode(signature)),
    new TextEncoder().encode(value)
  );
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return key;
}

function parseSessionPayload(payloadPart: string): SignedSessionPayload {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as unknown;
  } catch {
    throw permissionDenied("Session payload is malformed");
  }
  const expiresAt = isRecord(value) ? value.expiresAt : undefined;
  if (!isRecord(value) || value.version !== 1 || typeof expiresAt !== "number" || !Number.isInteger(expiresAt)) {
    throw permissionDenied("Session payload is invalid");
  }
  return {
    version: 1,
    actor: normalizeActor(value.actor),
    ...(value.accountVersion === undefined ? {} : { accountVersion: normalizeAccountVersion(value.accountVersion) }),
    expiresAt
  };
}

function normalizeActor(value: unknown): Actor {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.roles)) {
    throw permissionDenied("Session actor is invalid");
  }
  if (value.id.trim().length === 0) {
    throw permissionDenied("Session actor id is invalid");
  }
  const roles = value.roles.filter((role): role is string => typeof role === "string" && role.trim().length > 0);
  if (roles.length !== value.roles.length || roles.length === 0) {
    throw permissionDenied("Session actor roles are invalid");
  }
  const tenantId = typeof value.tenantId === "string" && value.tenantId.trim().length > 0
    ? value.tenantId
    : DEFAULT_TENANT_ID;
  const email = typeof value.email === "string" && value.email.trim().length > 0
    ? value.email
    : undefined;
  return {
    id: value.id,
    roles,
    tenantId,
    ...(email === undefined ? {} : { email })
  };
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    readonly maxAgeSeconds: number;
    readonly path: string;
    readonly sameSite: "Lax" | "Strict" | "None";
    readonly secure: boolean;
  }
): string {
  const attributes = [
    `${name}=${value}`,
    `Path=${options.path}`,
    "HttpOnly",
    `SameSite=${options.sameSite}`,
    `Max-Age=${options.maxAgeSeconds}`
  ];
  if (options.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function currentSeconds(now: (() => number) | undefined): number {
  return now ? now() : Math.floor(Date.now() / 1000);
}

function ensureSecret(secret: string): void {
  if (secret.trim().length === 0) {
    throw badRequest("Session secret is required");
  }
}

function normalizeAccountVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw permissionDenied("Session account version is invalid");
  }
  return value;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(byteAt(bytes, index));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function byteAt(bytes: Uint8Array, index: number): number {
  const byte = bytes[index];
  if (byte === undefined) {
    throw new Error(`Byte index ${index} is outside encoded byte length ${bytes.byteLength}`);
  }
  return byte;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw permissionDenied("Session token is malformed");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
