import type { PasswordHasher } from "../../ports/password-hasher.js";

export interface WebCryptoPbkdf2PasswordHasherOptions {
  readonly iterations?: number;
  readonly saltBytes?: number;
  readonly hashBytes?: number;
}

const DEFAULT_ITERATIONS = 210_000;
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
  return {
    async hash(password) {
      const salt = new Uint8Array(saltBytes);
      crypto.getRandomValues(salt);
      const derived = await derivePbkdf2(password, salt, iterations, hashBytes);
      return `${FORMAT}$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
    },
    async verify(password, encodedHash) {
      const parsed = parseHash(encodedHash);
      if (!parsed) {
        return false;
      }
      const derived = await derivePbkdf2(password, parsed.salt, parsed.iterations, parsed.hash.byteLength);
      return timingSafeEqual(derived, parsed.hash);
    }
  };
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
} | null {
  const [format, iterationsValue, saltValue, hashValue] = value.split("$");
  if (format !== FORMAT || !iterationsValue || !saltValue || !hashValue || value.split("$").length !== 4) {
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
      hash: base64UrlDecode(hashValue)
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
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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
