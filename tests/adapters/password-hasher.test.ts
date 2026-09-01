import { webCryptoPbkdf2PasswordHasher } from "../../src";
import type { PasswordPepper } from "../../src";

describe("webCryptoPbkdf2PasswordHasher", () => {
  it("hashes with PBKDF2 metadata and verifies without exposing deterministic salts", async () => {
    const hasher = webCryptoPbkdf2PasswordHasher({
      iterations: 1,
      saltBytes: 8,
      hashBytes: 16
    });

    const first = await hasher.hash("secret-123");
    const second = await hasher.hash("secret-123");

    expect(first).toMatch(/^pbkdf2-sha256\$1\$/);
    expect(second).toMatch(/^pbkdf2-sha256\$1\$/);
    expect(first).not.toBe(second);
    await expect(hasher.verify("secret-123", first)).resolves.toBe(true);
    await expect(hasher.verify("wrong-secret", first)).resolves.toBe(false);
    await expect(hasher.verify("secret-123", "not-a-pbkdf2-hash")).resolves.toBe(false);
  });

  it("defaults to the OWASP iteration count for PBKDF2-HMAC-SHA-256", async () => {
    // 600,000 is the SHA-256 row of the OWASP table. The previous default of
    // 210,000 was the SHA-512 figure applied to SHA-256. See docs/passwords.md.
    const hasher = webCryptoPbkdf2PasswordHasher({ saltBytes: 8, hashBytes: 16 });

    expect(await hasher.hash("secret-123")).toMatch(/^pbkdf2-sha256\$600000\$/);
  });

  it("reports a hash as needing a rehash when its parameters are weaker", async () => {
    const weak = webCryptoPbkdf2PasswordHasher({ iterations: 1, saltBytes: 8, hashBytes: 16 });
    const strong = webCryptoPbkdf2PasswordHasher({ iterations: 4, saltBytes: 8, hashBytes: 16 });
    const weakHash = await weak.hash("secret-123");
    const strongHash = await strong.hash("secret-123");

    expect(strong.needsRehash?.(weakHash)).toBe(true);
    expect(strong.needsRehash?.(strongHash)).toBe(false);
    // A stronger stored hash is left alone rather than downgraded.
    expect(weak.needsRehash?.(strongHash)).toBe(false);
    // Verification still accepts the old parameters, which is what makes the
    // upgrade-on-login path possible at all.
    await expect(strong.verify("secret-123", weakHash)).resolves.toBe(true);
  });

  it("treats a changed hash length as needing a rehash, and an unparseable hash as not", async () => {
    const narrow = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, hashBytes: 16 });
    const wide = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, hashBytes: 32 });

    expect(wide.needsRehash?.(await narrow.hash("secret-123"))).toBe(true);
    // Nothing can be upgraded from a hash that cannot be parsed; verify already
    // rejects it, and rehashing would need a password this method never sees.
    expect(wide.needsRehash?.("not-a-pbkdf2-hash")).toBe(false);
  });

  it("records the pepper id and keeps the encoded shape parseable", async () => {
    const hasher = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, pepper: p1 });

    const encoded = await hasher.hash("secret-123");

    expect(encoded).toMatch(/^pbkdf2-sha256\$2\$[^$]+\$[^$]+\$p1$/);
    await expect(hasher.verify("secret-123", encoded)).resolves.toBe(true);
    await expect(hasher.verify("wrong-secret", encoded)).resolves.toBe(false);
  });

  it("is useless to an attacker holding the database but not the secret", async () => {
    const withPepper = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, pepper: p1 });
    const encoded = await withPepper.hash("secret-123");

    // Same algorithm, same parameters, correct password — and it still fails,
    // because the secret is not in the record.
    const withoutPepper = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8 });
    const wrongPepper = webCryptoPbkdf2PasswordHasher({
      iterations: 2,
      saltBytes: 8,
      pepper: { id: "p1", secret: "not-the-secret" }
    });

    await expect(withoutPepper.verify("secret-123", encoded)).resolves.toBe(false);
    await expect(wrongPepper.verify("secret-123", encoded)).resolves.toBe(false);
  });

  it("verifies pre-pepper records and flags them for upgrade", async () => {
    const before = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, hashBytes: 32 });
    const after = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, hashBytes: 32, pepper: p1 });
    const legacy = await before.hash("secret-123");

    // Backward compatible: no downtime migration, the record still verifies.
    await expect(after.verify("secret-123", legacy)).resolves.toBe(true);
    // And the same upgrade-on-login path #20 built will rewrap it.
    expect(after.needsRehash?.(legacy)).toBe(true);
    expect(after.needsRehash?.(await after.hash("secret-123"))).toBe(false);
  });

  it("verifies a retired pepper during rotation and flags it for rewrapping", async () => {
    const old = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, pepper: p1 });
    const rotating = webCryptoPbkdf2PasswordHasher({
      iterations: 2,
      saltBytes: 8,
      pepper: p2,
      previousPeppers: [p1]
    });
    const underOldPepper = await old.hash("secret-123");

    await expect(rotating.verify("secret-123", underOldPepper)).resolves.toBe(true);
    expect(rotating.needsRehash?.(underOldPepper)).toBe(true);
    expect(rotating.needsRehash?.(await rotating.hash("secret-123"))).toBe(false);

    // Once the old pepper is dropped from the configuration, those records stop
    // verifying. That is the rotation deadline, not a bug.
    const dropped = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, pepper: p2 });
    await expect(dropped.verify("secret-123", underOldPepper)).resolves.toBe(false);
  });

  it("flags records for rewrapping when a deployment removes its pepper", async () => {
    const withPepper = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, pepper: p1 });
    const downgraded = webCryptoPbkdf2PasswordHasher({
      iterations: 2,
      saltBytes: 8,
      previousPeppers: [p1]
    });
    const encoded = await withPepper.hash("secret-123");

    // The downgrade path: keep the secret listed as previous, and logins rewrap
    // to the unpeppered form instead of locking everyone out.
    await expect(downgraded.verify("secret-123", encoded)).resolves.toBe(true);
    expect(downgraded.needsRehash?.(encoded)).toBe(true);
  });

  it("keeps peppered verification independent of the configured hash length", async () => {
    // A peppered record stores an HMAC output, so its own length cannot describe
    // the KDF length it wrapped. Changing hashBytes must not lock accounts out.
    const narrow = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, hashBytes: 16, pepper: p1 });
    const wide = webCryptoPbkdf2PasswordHasher({ iterations: 2, saltBytes: 8, hashBytes: 32, pepper: p1 });
    const encoded = await narrow.hash("secret-123");

    await expect(wide.verify("secret-123", encoded)).resolves.toBe(true);
    expect(wide.needsRehash?.(encoded)).toBe(false);
  });

  it("rejects a pepper id that would break the encoded format", () => {
    for (const id of ["has$dollar", "has space", "", "1leading"]) {
      expect(() =>
        webCryptoPbkdf2PasswordHasher({ pepper: { id, secret: "s" } })
      ).toThrow("plain identifier");
    }
  });
});

const p1: PasswordPepper = { id: "p1", secret: "pepper-one" };
const p2: PasswordPepper = { id: "p2", secret: "pepper-two" };