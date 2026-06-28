import { permissionDenied } from "../../core/errors.js";

export interface JwtClaims {
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly sub?: string;
  readonly email?: string;
  readonly name?: string;
  readonly [claim: string]: unknown;
}

export interface JsonWebKeyWithKid extends JsonWebKey {
  readonly kid: string;
}

export interface JsonWebKeySet<TJwk extends JsonWebKeyWithKid = JsonWebKeyWithKid> {
  readonly keys: readonly TJwk[];
}

export interface JwksLookup<TJwks extends JsonWebKeySet = JsonWebKeySet> {
  readonly jwks: TJwks;
  readonly fromCache: boolean;
}

export interface JwtVerifierMessages {
  readonly token: string;
  readonly signingKey: string;
}

interface JwtHeader {
  readonly alg: string;
  readonly kid: string;
  readonly typ?: string;
}

export async function verifyJwtWithJwks<
  TClaims extends JwtClaims,
  TJwks extends JsonWebKeySet = JsonWebKeySet
>(
  token: string,
  options: {
    readonly messages: JwtVerifierMessages;
    readonly issuer: string;
    readonly audiences: ReadonlySet<string>;
    readonly now: number;
    readonly jwks: () => Promise<JwksLookup<TJwks>>;
    readonly refreshJwks: () => Promise<TJwks>;
    readonly validateClaims?: (claims: JwtClaims) => boolean;
  }
): Promise<TClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw permissionDenied(`${options.messages.token} is malformed`);
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = parseJwtHeader(headerPart, options.messages.token);
  if (header.alg !== "RS256") {
    throw permissionDenied(`${options.messages.token} algorithm is unsupported`);
  }
  const lookup = await options.jwks();
  let jwk = lookup.jwks.keys.find((key) => key.kid === header.kid);
  if (jwk === undefined && lookup.fromCache) {
    jwk = (await options.refreshJwks()).keys.find((key) => key.kid === header.kid);
  }
  if (jwk === undefined) {
    throw permissionDenied(`${options.messages.token} signing key is unknown`);
  }
  const verified = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    await importRsaVerifyKey(jwk, options.messages.signingKey),
    arrayBufferFromBytes(base64UrlDecode(signaturePart, options.messages.token)),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!verified) {
    throw permissionDenied(`${options.messages.token} signature is invalid`);
  }
  const claims = parseJwtClaims(payloadPart, options.messages.token);
  if (options.validateClaims && !options.validateClaims(claims)) {
    throw permissionDenied(`${options.messages.token} payload is invalid`);
  }
  validateRegisteredClaims(claims, options);
  return claims as TClaims;
}

export function assertJwks<TJwks extends JsonWebKeySet = JsonWebKeySet>(
  value: unknown,
  signingKeysLabel: string
): TJwks {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw permissionDenied(`${signingKeysLabel} are invalid`);
  }
  if (!value.keys.every(isJwkWithKid)) {
    throw permissionDenied(`${signingKeysLabel} are invalid`);
  }
  return { keys: value.keys } as unknown as TJwks;
}

export function currentSeconds(now: (() => number) | undefined): number {
  const seconds = now ? now() : Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(seconds)) {
    throw permissionDenied("JWT clock must be a safe integer");
  }
  return seconds;
}

function validateRegisteredClaims(
  claims: JwtClaims,
  options: {
    readonly messages: JwtVerifierMessages;
    readonly issuer: string;
    readonly audiences: ReadonlySet<string>;
    readonly now: number;
  }
): void {
  if (claims.iss !== options.issuer) {
    throw permissionDenied(`${options.messages.token} issuer is invalid`);
  }
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!tokenAudiences.some((audience) => options.audiences.has(audience))) {
    throw permissionDenied(`${options.messages.token} audience is invalid`);
  }
  if (claims.exp <= options.now) {
    throw permissionDenied(`${options.messages.token} expired`);
  }
  if (claims.nbf !== undefined && claims.nbf > options.now) {
    throw permissionDenied(`${options.messages.token} is not active yet`);
  }
}

function parseJwtHeader(headerPart: string, tokenLabel: string): JwtHeader {
  const value = parseJwtJson(headerPart, "header", tokenLabel);
  if (!isRecord(value) || typeof value.alg !== "string" || typeof value.kid !== "string") {
    throw permissionDenied(`${tokenLabel} header is invalid`);
  }
  return {
    alg: value.alg,
    kid: value.kid,
    ...(typeof value.typ === "string" ? { typ: value.typ } : {})
  };
}

function parseJwtClaims(payloadPart: string, tokenLabel: string): JwtClaims {
  const value = parseJwtJson(payloadPart, "payload", tokenLabel);
  if (
    !isRecord(value) ||
    typeof value.iss !== "string" ||
    !isAudience(value.aud) ||
    typeof value.exp !== "number" ||
    !Number.isSafeInteger(value.exp) ||
    (value.nbf !== undefined && (typeof value.nbf !== "number" || !Number.isSafeInteger(value.nbf))) ||
    (value.iat !== undefined && (typeof value.iat !== "number" || !Number.isSafeInteger(value.iat))) ||
    (value.email !== undefined && typeof value.email !== "string") ||
    (value.sub !== undefined && typeof value.sub !== "string") ||
    (value.name !== undefined && typeof value.name !== "string")
  ) {
    throw permissionDenied(`${tokenLabel} payload is invalid`);
  }
  return value as unknown as JwtClaims;
}

function parseJwtJson(part: string, label: string, tokenLabel: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(part, tokenLabel))) as unknown;
  } catch {
    throw permissionDenied(`${tokenLabel} ${label} is malformed`);
  }
}

async function importRsaVerifyKey(jwk: JsonWebKey, signingKeyLabel: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    throw permissionDenied(`${signingKeyLabel} is invalid`);
  }
}

function isAudience(value: unknown): value is string | readonly string[] {
  return isNonBlankString(value) ||
    (Array.isArray(value) && value.length > 0 && value.every(isNonBlankString));
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function base64UrlDecode(value: string, tokenLabel: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw permissionDenied(`${tokenLabel} is malformed`);
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJwkWithKid(value: unknown): value is JsonWebKeyWithKid {
  return isRecord(value) &&
    typeof value.kid === "string" &&
    value.kid.trim().length > 0 &&
    value.kty === "RSA" &&
    typeof value.n === "string" &&
    value.n.length > 0 &&
    typeof value.e === "string" &&
    value.e.length > 0 &&
    (value.alg === undefined || value.alg === "RS256") &&
    (value.use === undefined || value.use === "sig");
}
