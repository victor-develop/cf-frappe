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
});
