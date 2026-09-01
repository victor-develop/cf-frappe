# Authentication

## cf-frappe is an identity consumer, not an identity provider

**For production, use Cloudflare Access or generic OIDC. `signed-session` is the fallback for development, demos, and small deployments.**

That is the position, and it exists so the question does not have to be re-argued every time someone asks for MFA, passkeys, social login, device management, or account linking. The answer to all of those is the same: they belong to the identity provider.

## What is delegated is credential verification, not user management

This is the part that gets misread, so it is worth being blunt: **you do not have to build a user system.** cf-frappe has one, and it is event-sourced.

| Layer | Owner |
| --- | --- |
| **Who you are** — accounts, roles, permissions, enable/disable, full audit trail | **cf-frappe**, event-sourced |
| **That you really are you** — passwords, MFA, passkeys, device management | **the IdP** |

`user-account`, `user-profile`, `role` and `user-permission` are all event streams, so "who changed whom from Viewer to Admin, and when" is an immutable event rather than a row someone can quietly update. That is an advantage, and it is not outsourced.

The bridge already exists: `UserAuthProviderLinked` and `UserAuthProviderSynced` attach an external subject to a cf-frappe account and keep roles and email in step with what the provider asserts.

## Choosing

| Mode | Fits | What the deployment must supply |
| --- | --- | --- |
| **Cloudflare Access** | Internal systems behind Zero Trust | **Nothing.** Cloudflare handles the IdP integration; the Worker only verifies the Access JWT |
| **Generic OIDC** | You already run Okta, Entra, Google Workspace, Auth0 | Three values: issuer, audience, JWKS URL |
| **signed-session** | Development, demos, small deployments, external users with no IdP | Nothing. cf-frappe stores password hashes itself |

```bash
cf-frappe init my-app --auth cloudflare-access
cf-frappe init my-app --auth oidc
cf-frappe init my-app                        # signed-session
```

### signed-session is complete, but its scope is frozen

It is not deprecated and not half-built. Login, password reset, email verification and session revocation are all implemented, and the revocation check is stricter than most frameworks': `ensureUserAccountSessionCurrent` compares the session's recorded account version against the current one, so any change to the account — roles, enable/disable, a password change — invalidates every existing session for that user immediately.

What it will not do is grow. New credential-verification features go to the IdP, not here.

Password hashing details, including why PBKDF2 rather than Argon2id and how existing hashes upgrade on login, are in [Password Hashing](passwords.md).

## Deliberately not built

The declaration above is a scope boundary, not a removal of capability. Nothing here is missing by accident:

| Not built | Why |
| --- | --- |
| MFA / TOTP | The IdP's job. An organisation's MFA policy should live in one place, not be re-implemented per application |
| Passkeys / WebAuthn | Same |
| Social login buttons and account linking | Generic OIDC already covers the enterprise case; consumer social login is a different product |
| Device management, session listing | Per-account revocation is sufficient for internal systems |

If a deployment genuinely needs one of these, the supported answer is to put an IdP in front that provides it. That is cheaper than maintaining a second credential system inside an application framework.

## The exception: surfaces facing your customers

`examples/returns/public-intake.ts` is the shape of the problem — the people using that surface are your customers, and they have no corporate IdP. Two recommendations, in order:

1. **Prefer no account at all.** A one-time link or an OTP, authorising a single transaction. Most customer-facing intake does not need a durable identity, and not having one removes password reset, session management, and account recovery from the surface entirely.
2. **If accounts are genuinely required, build them as a separate authentication surface.** Do not push customer identities through the employee identity model.

The second point is the one worth insisting on. Customer identity differs from employee identity in lifecycle (self-service signup and deletion versus provisioning and offboarding), in audit expectations, and in permission model. Forcing them into one model is not the simplification it looks like — it means every employee permission check has to reason about a population it was never designed for.
