# Password Hashing

Why cf-frappe uses PBKDF2, what the parameters are and why, and how existing accounts get upgraded.

## Why PBKDF2, when OWASP prefers Argon2id

OWASP's order of preference is Argon2id > scrypt > bcrypt > PBKDF2, and it recommends PBKDF2 mainly for FIPS-140 contexts. cf-frappe still uses PBKDF2, because **Workers' WebCrypto only offers PBKDF2** — there is no native Argon2 or scrypt.

This is a platform constraint, not an oversight. Two findings from evaluating the alternatives, recorded so the investigation does not have to be repeated:

- **Packages that compile WASM at runtime do not work on Workers at all.** `hash-wasm` embeds its WASM as base64 and calls `WebAssembly.compile`, which fails with `CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder`. Workers only accept `.wasm` modules imported by the bundler, which rules out most off-the-shelf argon2 packages.
- **Pure-JS Argon2id runs, but costs about 4x PBKDF2 at OWASP settings.** `@noble/hashes` argon2id at 19 MiB / t=2 measured ~293ms against ~68ms for PBKDF2 600k. At that memory setting, allocation and GC dominated the variance — t=3 measured *faster* than t=2, which says the noise exceeded the algorithm's own cost. Workers give each isolate 128 MB, so concurrent logins stack.

So the combination here is **PBKDF2 at the OWASP SHA-256 iteration count, plus a pepper** (issue #21). Under Workers' constraints that balances better than a slow pure-JS Argon2id.

## Parameters

```
pbkdf2-sha256$600000$<salt>$<hash>
```

600,000 is the OWASP recommendation for PBKDF2-HMAC-**SHA-256**. The previous default was 210,000, which is the figure from the **SHA-512** row of the same table — the wrong line for the algorithm actually in use.

OWASP notes that 600k derives from a 2022-12 benchmark against an RTX 4000 and should be read as a floor, not a target.

Measured on workerd (Apple Silicon, `wrangler dev --local`), median of several runs:

| Configuration | Median |
| --- | --- |
| PBKDF2-SHA256 210k (the old default) | 22 ms |
| PBKDF2-SHA256 600k (current) | 68 ms |
| Argon2id 19 MiB t=2, pure JS | ~293 ms |

A separate sweep over 100k / 210k / 400k / 600k / 1M was linear at roughly 66 ms per million iterations, which makes the figures above credible rather than incidental. So the upgrade costs about 46 ms of CPU per login. **There was no cost argument for staying at 210,000.**

These are local workerd numbers. Production Workers may be 2–3x slower, putting 600k near 140–200 ms. Re-measure before a deployment that cares, but even 3x is inside a login budget.

Deployments can override the cost:

```ts
webCryptoPbkdf2PasswordHasher({ iterations: 800_000 });
```

## Existing accounts upgrade on login

Raising `iterations` only helps new and changed passwords unless something rewrites the old ones. `verify` reads the iteration count out of the stored hash, so an old hash keeps verifying forever — correct, but it also means an account can sit at the old cost indefinitely.

So a successful login upgrades the hash in place:

1. `verify` succeeds against the stored parameters.
2. `PasswordHasher.needsRehash(storedHash)` reports the parameters are weaker than current.
3. The password is rehashed with current parameters and a `UserPasswordRehashed` event is appended.

Two things about that event are deliberate:

**It is not `UserPasswordChanged`.** A password change clears any in-flight password reset, and it means something different in an audit trail. An upgrade is not a change of password.

**The login must return the post-rehash state.** Appending any event advances `state.version`, and `ensureUserAccountSessionCurrent` rejects a session whose recorded version no longer matches. Returning the pre-rehash state would issue a session that is invalid on its very next request — the user would be logged out by the act of logging in. `tests/application/user-account-service.test.ts` asserts the session stays valid, and that assertion has been checked by mutation: reverting to the pre-rehash state makes it fail with `Session is no longer valid`.

**A failed upgrade never fails the login.** The old hash still verifies, so a storage error or a concurrent write just means the account tries again next time.

## What is not here yet

A pepper — an HMAC with a Workers Secret outside the KDF — is tracked in issue #21. It costs almost nothing and makes offline cracking useless when a database leaks without the secret. OWASP treats it as complementary to the iteration count rather than a substitute, so both belong.
