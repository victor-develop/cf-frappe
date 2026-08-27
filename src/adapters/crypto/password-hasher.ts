import { isPlainIdentifier } from "../../core/identifiers.js";
import type { PasswordHasher } from "../../ports/password-hasher.js";

/**
 * A secret that is HMAC'd over the KDF output and is **not** stored in the
 * database, so a database-only leak leaves offline cracking useless.
 *
 * `id` is recorded in the encoded hash so rotation can tell which secret
 * produced a given record. It never reveals the secret itself.
 */
export interface PasswordPepper {
  readonly id: string;
  readonly secret: string;
}

export interface WebCryptoPbkdf2PasswordHasherOptions {
  readonly iterations?: number;
  readonly saltBytes?: number;
  readonly hashBytes?: number;
  /**
   * Applied after the KDF, so rewrapping a stored hash under a new pepper is one
   * HMAC rather than another full KDF run. Omit for the previous behaviour.
   */
  readonly pepper?: PasswordPepper;
  /**
   * Retired peppers kept for verification during a rotation. A hash produced by
   * one of these still verifies, and is rewrapped under the current pepper on
   * the next successful login.
   *
   * There is no offline batch rotation: `HMAC(oldPepper, x)` cannot be reversed
   * to recover `x`, so rotation only happens as accounts log in.
   */
  readonly previousPeppers?: readonly PasswordPepper[];
}

/**
 * OWASP's Password Storage Cheat Sheet recommends 600,000 iterations for
 * PBKDF2-HMAC-SHA-256. The previous default of 210,000 is the figure from the
 * SHA-512 row of the same table, applied to SHA-256 by mistake.
 *
 * Measured on workerd (Apple Silicon, `wrangler dev --local`), PBKDF2-SHA256
 * costs about 66ms per million iterations, so this is roughly 68ms per login
 * against 22ms before. Production Workers may be 2-3x slower; that is still
 * within a login budget. See docs/passwords.md.
 */
const DEFAULT_ITERATIONS = 600_000;
const DEFAULT_SALT_BYTES = 16;
const DEFAULT_HASH_BYTES = 32;
const FORMAT = "pbkdf2-sha256";

export function webCryptoPbkdf2PasswordHasher(
  options: WebCryptoPbkdf2PasswordHasherOptions = {}
): PasswordHasher {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const saltBytes = options.saltBytes ?? DEFAULT_SALT_BYTES;
  const hashBytes = options.hashBytes ?? DEFAULT_HASH_BYTES;
  ensurePositiveInteger(iterations, "PBKDF2 iterations");
  ensurePositiveInteger(saltBytes, "PBKDF2 salt bytes");
  ensurePositiveInteger(hashBytes, "PBKDF2 hash bytes");
  const pepper = options.pepper;
  const previousPeppers = options.previousPeppers ?? [];
  for (const candidate of pepper === undefined ? previousPeppers : [pepper, ...previousPeppers]) {
    ensurePepperId(candidate.id);
  }
  // Verification tries the current pepper, then each retired one, then no pepper
  // at all — the last covers records written before a pepper was configured.
  const verifyCandidates: readonly (PasswordPepper | undefined)[] = [
    ...(pepper === undefined ? [] : [pepper]),
    ...previousPeppers,
    undefined
  ];

  return {
    async hash(password) {
      const salt = new Uint8Array(saltBytes);
      crypto.getRandomValues(salt);
      const derived = await derivePbkdf2(password, salt, iterations, kdfBytesFor(pepper, hashBytes));
      const wrapped = await applyPepper(derived, pepper);
      const suffix = pepper === undefined ? "" : `$${pepper.id}`;
      return `${FORMAT}$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(wrapped)}${suffix}`;
    },
    async verify(password, encodedHash) {
      const parsed = parseHash(encodedHash);
      if (!parsed) {
        return false;
      }
      const candidate = verifyCandidates.find((entry) => entry?.id === parsed.pepperId);
      if (parsed.pepperId !== undefined && candidate === undefined) {
        // Written under a pepper this deployment does not hold. Failing here is
        // the point of a pepper; see docs/passwords.md on secret loss.
        return false;
      }
      // A peppered record stores an HMAC-SHA256 output, so its own length says
      // nothing about the KDF length — which is why that length is pinned.
      const derived = await derivePbkdf2(
        password,
        parsed.salt,
        parsed.iterations,
        parsed.pepperId === undefined ? parsed.hash.byteLength : PEPPERED_KDF_BYTES
      );
      const wrapped = await applyPepper(derived, candidate);
      return timingSafeEqual(wrapped, parsed.hash);
    },
    needsRehash(encodedHash) {
      const parsed = parseHash(encodedHash);
      // An unparseable hash is not upgradeable — verify already rejects it, and
      // rehashing would need a password this method does not have.
      if (!parsed) {
        return false;
      }
      if (parsed.pepperId !== pepper?.id) {
        // Covers no-pepper -> pepper, an old pepper -> the current one, and a
        // deployment that removed its pepper.
        return true;
      }
      if (parsed.iterations < iterations) {
        return true;
      }
      // A peppered record's stored length is always the HMAC width, so comparing
      // it against `hashBytes` would flag every record forever.
      return parsed.pepperId === undefined && parsed.hash.byteLength !== hashBytes;
    }
  };
}

/**
 * KDF output length when a pepper is configured.
 *
 * A peppered record stores `HMAC-SHA256(pepper, kdfOutput)`, so its encoded
 * length is always 32 bytes and the KDF length it wrapped is unrecoverable.
 * Pinning it keeps verification independent of the `hashBytes` a deployment
 * happens to be configured with today — otherwise changing that option would
 * lock every existing account out.
 */
const PEPPERED_KDF_BYTES = 32;

function kdfBytesFor(pepper: PasswordPepper | undefined, hashBytes: number): number {
  return pepper === undefined ? hashBytes : PEPPERED_KDF_BYTES;
}

async function applyPepper(
  derived: Uint8Array,
  pepper: PasswordPepper | undefined
): Promise<Uint8Array> {
  if (pepper === undefined) {
    return derived;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, arrayBufferFromBytes(derived)));
}

function ensurePepperId(id: string): void {
  // Recorded as the last `$`-delimited segment of the encoded hash.
  if (!isPlainIdentifier(id)) {
    throw new Error(`Password pepper id must be a plain identifier: '${id}'`);
  }
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hashBytes: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: arrayBufferFromBytes(salt),
      iterations
    },
    key,
    hashBytes * 8
  );
  return new Uint8Array(bits);
}

function parseHash(value: string): {
  readonly iterations: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
  readonly pepperId: string | undefined;
} | null {
  const segments = value.split("$");
  const [format, iterationsValue, saltValue, hashValue, pepperId] = segments;
  if (format !== FORMAT || !iterationsValue || !saltValue || !hashValue) {
    return null;
  }
  // Four segments is the pre-pepper format; five records which pepper wrapped it.
  if (segments.length === 5 ? pepperId === undefined || !isPlainIdentifier(pepperId) : segments.length !== 4) {
    return null;
  }
  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations < 1) {
    return null;
  }
  try {
    return {
      iterations,
      salt: base64UrlDecode(saltValue),
      hash: base64UrlDecode(hashValue),
      pepperId: segments.length === 5 ? pepperId : undefined
    };
  } catch {
    return null;
  }
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function ensurePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
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
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
