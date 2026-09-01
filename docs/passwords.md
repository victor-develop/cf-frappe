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

## Pepper

The iteration count defends against one thing: how fast an attacker who already holds the hashes can crack them offline. But the most common leak is **the database alone** — an injection, a stray backup, a read replica left open. There, iterations only buy time; weak passwords still fall.

A pepper removes that scenario. A secret that is **not in the database** is HMAC'd over the KDF output, so an attacker with the whole database and no secret gets nothing from offline cracking. It costs one HMAC-SHA256, microseconds — against the 68ms of the KDF it is free.

```ts
webCryptoPbkdf2PasswordHasher({
  pepper: { id: "p1", secret: env.PASSWORD_PEPPER }
});
```

Wire it where the app constructs its hasher — `createCloudFrappeApp` already accepts `auth.passwords`, so no extra option is needed:

```ts
auth: {
  passwords: webCryptoPbkdf2PasswordHasher({ pepper: { id: "p1", secret: env.PASSWORD_PEPPER } })
}
```

### The pepper is applied after the KDF, on purpose

| Placement | Form | Rewrapping on login |
| --- | --- | --- |
| Pre-KDF | `PBKDF2(HMAC(pepper, password), salt)` | Needs a full KDF run, and tangles with the iteration upgrade |
| **Post-KDF** | `HMAC(pepper, PBKDF2(password, salt))` | The KDF output is already in memory — one HMAC |

Neither placement allows offline batch rotation: `HMAC(oldPepper, x)` cannot be reversed to recover `x`. So rotation only ever happens as accounts log in, and post-KDF makes that step cheap.

### Format

```
pbkdf2-sha256$600000$<salt>$<hash>            # no pepper
pbkdf2-sha256$600000$<salt>$<hash>$p1         # wrapped by pepper "p1"
```

A record without the fifth segment verifies through the unpeppered path, so adding a pepper needs no downtime migration. Because a peppered record stores an HMAC-SHA256 output, its own length says nothing about the KDF length it wrapped — so that length is pinned at 32 bytes when a pepper is configured. Changing `hashBytes` therefore cannot lock peppered accounts out.

### Rotation

Keep the retired secret listed while accounts migrate:

```ts
webCryptoPbkdf2PasswordHasher({
  pepper: { id: "p2", secret: env.PASSWORD_PEPPER_V2 },
  previousPeppers: [{ id: "p1", secret: env.PASSWORD_PEPPER_V1 }]
});
```

`verify` accepts either; `needsRehash` reports the old one as stale, so **the same upgrade-on-login path that raises the iteration count also rewraps the pepper** — one mechanism, not two. Watch the proportion of records still on `p1`, then drop it. Dropping it is the deadline: records still wrapped by `p1` stop verifying at that moment.

## Operational risk: losing the secret locks everyone out

**If the pepper secret is lost, every peppered password becomes permanently unverifiable.** No amount of knowing the correct password recovers it. This is the real cost of a pepper and it has to be planned for, not discovered.

- **Back the secret up outside the Worker.** It is not in the database, which is the whole point — and it is therefore not in your database backups either.
- **Downgrade path.** To stop using a pepper without locking anyone out, move the current secret to `previousPeppers` and configure no `pepper`. Logins then verify through the retired secret and rewrap to the unpeppered form. If the secret is already gone, the only path left is an administrative password reset for every affected account, so keep that runbook ready.
- **Environments must not share a database.** dev / staging / production should use different secrets, which means a production database copied into staging will not authenticate there. Copy accounts only alongside their matching secret, or reset passwords after the copy.
- **Rotate deliberately, not reactively.** Rotation completes only as users log in, so a dormant account can sit on an old pepper indefinitely. Dropping a retired secret before those accounts return locks them out.

## Not done yet

The pepper is global. Per-tenant secrets would isolate a leak further, but secret management then grows with tenant count and interacts with the sharding work in issue #14. `tokenSecrets` — the hashing for password-reset and email-verification tokens — does not use a pepper either; those tokens are short-lived, so the trade is different.
