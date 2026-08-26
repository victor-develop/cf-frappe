import { webCryptoPbkdf2PasswordHasher } from "../../src";

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
});