import {
  ensureUserAccountAdmin,
  ensureUserAccountExpectedVersion,
  ensureUserAccountSessionCurrent,
  ensureUserRecoveryChallengeUsable,
  emailVerificationPatch,
  MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS,
  MIN_USER_PASSWORD_LENGTH,
  normalizeOptionalUserEmail,
  normalizeRecoveryExpirySeconds,
  normalizeRequiredUserAccountText,
  normalizeRequiredUserRoles,
  normalizeUserLoginPassword,
  normalizeUserPassword,
  normalizeUserRecoveryToken,
  recoveryChallengeExpired,
  recoveryExpiresAtFrom,
  resolveUserAccountActorTenant,
  resolveUserAccountSessionTenant,
  SYSTEM_MANAGER_ROLE,
  ensureUserAccountPasswordLoginAllowed,
  ensureUserAccountPasswordResettable,
  userAccountEmailVerificationChallengeForCompletion,
  userAccountEmailVerificationDeliveryEmail,
  userAccountPasswordHashForLogin,
  userAccountPasswordResetDeliveryEmail,
  userAccountRolesEqual
} from "../../src";
import type { UserAccountState } from "../../src";

describe("user account policy", () => {
  it("guards user account administration roles", () => {
    expect(() => ensureUserAccountAdmin(
      { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      [SYSTEM_MANAGER_ROLE]
    )).not.toThrow();
    expect(() => ensureUserAccountAdmin(
      { id: "user@example.com", roles: ["User"], tenantId: "acme" },
      [SYSTEM_MANAGER_ROLE]
    )).toThrow("Actor 'user@example.com' cannot manage user accounts");
  });

  it("resolves user account command tenants from actor scope", () => {
    expect(resolveUserAccountActorTenant(
      { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] },
      undefined
    )).toBe("default");
    expect(resolveUserAccountActorTenant(
      { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      undefined
    )).toBe("acme");
    expect(resolveUserAccountActorTenant(
      { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      "acme"
    )).toBe("acme");
  });

  it("rejects user account command tenant escapes", () => {
    expect(() => resolveUserAccountActorTenant(
      { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      "other"
    )).toThrow("Actor 'admin@example.com' cannot manage user accounts for tenant 'other'");
  });

  it("resolves session tenants from actor scope", () => {
    expect(resolveUserAccountSessionTenant({ id: "owner@example.com", roles: ["User"] })).toBe("default");
    expect(resolveUserAccountSessionTenant({ id: "owner@example.com", roles: ["User"], tenantId: "acme" })).toBe("acme");
  });

  it("guards session account freshness and availability", () => {
    expect(() => ensureUserAccountSessionCurrent(accountState({ version: 3 }), 3)).not.toThrow();
    expect(() => ensureUserAccountSessionCurrent(accountState({ version: 3 }), undefined))
      .toThrow("Session is no longer valid");
    expect(() => ensureUserAccountSessionCurrent(accountState({ exists: false, version: 3 }), 3))
      .toThrow("Session is no longer valid");
    expect(() => ensureUserAccountSessionCurrent(accountState({ enabled: false, version: 3 }), 3))
      .toThrow("Session is no longer valid");
    expect(() => ensureUserAccountSessionCurrent(accountState({ version: 3 }), 2))
      .toThrow("Session is no longer valid");
  });

  it("normalizes required account text fields", () => {
    expect(normalizeRequiredUserAccountText("  owner@example.com  ", "User id")).toBe("owner@example.com");
    expect(() => normalizeRequiredUserAccountText("   ", "User id")).toThrow("User id is required");
  });

  it("normalizes optional account email values", () => {
    expect(normalizeOptionalUserEmail(undefined)).toBeUndefined();
    expect(normalizeOptionalUserEmail("   ")).toBeUndefined();
    expect(normalizeOptionalUserEmail(" OWNER@EXAMPLE.COM ")).toBe("owner@example.com");
  });

  it("normalizes required account roles", () => {
    expect(normalizeRequiredUserRoles([" User ", "System Manager", "User"])).toEqual(["System Manager", "User"]);
    expect(() => normalizeRequiredUserRoles(["  "])).toThrow("At least one role is required");
  });

  it("normalizes password inputs for account and login flows", () => {
    expect(normalizeUserPassword("12345678")).toBe("12345678");
    expect(() => normalizeUserPassword("1234567")).toThrow(`Password must be at least ${MIN_USER_PASSWORD_LENGTH} characters`);
    expect(() => normalizeUserLoginPassword("")).toThrow("Invalid credentials");
  });

  it("selects password hashes for password login", () => {
    expect(userAccountPasswordHashForLogin(accountState({ passwordHash: "hash:secret" }))).toBe("hash:secret");
    expect(() => userAccountPasswordHashForLogin(accountState({ exists: false, passwordHash: "hash:secret" })))
      .toThrow("Invalid credentials");
    expect(() => userAccountPasswordHashForLogin(accountState()))
      .toThrow("Invalid credentials");
  });

  it("guards verified password login against bad credentials and disabled accounts", () => {
    expect(() => ensureUserAccountPasswordLoginAllowed(accountState(), true)).not.toThrow();
    expect(() => ensureUserAccountPasswordLoginAllowed(accountState(), false))
      .toThrow("Invalid credentials");
    expect(() => ensureUserAccountPasswordLoginAllowed(accountState({ enabled: false }), true))
      .toThrow("Invalid credentials");
  });

  it("selects password reset delivery email for recoverable password accounts", () => {
    expect(userAccountPasswordResetDeliveryEmail(accountState({
      email: "owner@example.com",
      passwordHash: "hash:secret"
    }), true)).toBe("owner@example.com");
    expect(userAccountPasswordResetDeliveryEmail(accountState({
      email: "owner@example.com",
      passwordHash: "hash:secret"
    }), false)).toBeUndefined();
    expect(userAccountPasswordResetDeliveryEmail(accountState({
      exists: false,
      email: "owner@example.com",
      passwordHash: "hash:secret"
    }), true)).toBeUndefined();
    expect(userAccountPasswordResetDeliveryEmail(accountState({
      enabled: false,
      email: "owner@example.com",
      passwordHash: "hash:secret"
    }), true)).toBeUndefined();
    expect(userAccountPasswordResetDeliveryEmail(accountState({
      email: "owner@example.com"
    }), true)).toBeUndefined();
    expect(userAccountPasswordResetDeliveryEmail(accountState({
      passwordHash: "hash:secret"
    }), true)).toBeUndefined();
  });

  it("selects email verification delivery email for unverified accounts", () => {
    expect(userAccountEmailVerificationDeliveryEmail(accountState({ email: "owner@example.com" }), true))
      .toBe("owner@example.com");
    expect(userAccountEmailVerificationDeliveryEmail(accountState({ email: "owner@example.com" }), false))
      .toBeUndefined();
    expect(userAccountEmailVerificationDeliveryEmail(accountState({ exists: false, email: "owner@example.com" }), true))
      .toBeUndefined();
    expect(userAccountEmailVerificationDeliveryEmail(accountState({ enabled: false, email: "owner@example.com" }), true))
      .toBeUndefined();
    expect(userAccountEmailVerificationDeliveryEmail(accountState(), true)).toBeUndefined();
    expect(userAccountEmailVerificationDeliveryEmail(accountState({
      email: "owner@example.com",
      emailVerifiedAt: now
    }), true)).toBeUndefined();
  });

  it("guards password reset completion to password accounts", () => {
    expect(() => ensureUserAccountPasswordResettable(accountState({ passwordHash: "hash:secret" }))).not.toThrow();
    expect(() => ensureUserAccountPasswordResettable(accountState()))
      .toThrow("Invalid recovery token");
  });

  it("selects email verification challenges for completion", () => {
    const challenge = emailVerificationChallenge({ email: "owner@example.com" });
    expect(userAccountEmailVerificationChallengeForCompletion(accountState({
      emailVerification: challenge
    }))).toEqual(challenge);
    expect(() => userAccountEmailVerificationChallengeForCompletion(accountState()))
      .toThrow("Invalid recovery token");
  });

  it("normalizes recovery tokens", () => {
    expect(normalizeUserRecoveryToken(" tok_123 ")).toBe("tok_123");
    expect(() => normalizeUserRecoveryToken("   ")).toThrow("Invalid recovery token");
  });

  it("compares normalized account role arrays positionally", () => {
    expect(userAccountRolesEqual(["System Manager", "User"], ["System Manager", "User"])).toBe(true);
    expect(userAccountRolesEqual(["User", "System Manager"], ["System Manager", "User"])).toBe(false);
    expect(userAccountRolesEqual(["User"], ["User", "System Manager"])).toBe(false);
  });

  it("guards expected user account versions", () => {
    expect(() => ensureUserAccountExpectedVersion(accountState({ version: 3 }), undefined)).not.toThrow();
    expect(() => ensureUserAccountExpectedVersion(accountState({ version: 3 }), 3)).not.toThrow();
    expect(() => ensureUserAccountExpectedVersion(accountState({ version: 3 }), 2))
      .toThrow("Expected user account 'owner@example.com' at version 2, found 3");
  });

  it("normalizes recovery expiry seconds with configured defaults and bounds", () => {
    expect(normalizeRecoveryExpirySeconds(undefined, 3_600)).toBe(3_600);
    expect(normalizeRecoveryExpirySeconds(1, 3_600)).toBe(1);
    expect(normalizeRecoveryExpirySeconds(MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS, 3_600)).toBe(MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS);
  });

  it("rejects invalid recovery expiry seconds", () => {
    expect(() => normalizeRecoveryExpirySeconds(0, 3_600)).toThrow("Recovery token expiry must be between 1 and 604800 seconds");
    expect(() => normalizeRecoveryExpirySeconds(1.5, 3_600)).toThrow("Recovery token expiry must be between 1 and 604800 seconds");
    expect(() => normalizeRecoveryExpirySeconds(MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS + 1, 3_600))
      .toThrow("Recovery token expiry must be between 1 and 604800 seconds");
  });

  it("derives recovery expiry timestamps from an injected clock value", () => {
    expect(recoveryExpiresAtFrom("2026-01-01T00:00:00.000Z", 90)).toBe("2026-01-01T00:01:30.000Z");
    expect(() => recoveryExpiresAtFrom("not-a-date", 90)).toThrow("Clock returned invalid timestamp 'not-a-date'");
  });

  it("detects expired recovery challenges at the boundary", () => {
    expect(recoveryChallengeExpired("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(recoveryChallengeExpired("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z")).toBe(true);
    expect(recoveryChallengeExpired("2026-01-01T00:00:01.000Z", "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("guards usable recovery challenges before token verification", () => {
    expect(() => ensureUserRecoveryChallengeUsable(
      accountState(),
      recoveryChallenge({ expiresAt: "2026-01-01T00:00:01.000Z" }),
      now
    )).not.toThrow();
    expect(() => ensureUserRecoveryChallengeUsable(
      accountState(),
      undefined,
      now
    )).toThrow("Invalid recovery token");
    expect(() => ensureUserRecoveryChallengeUsable(
      accountState({ exists: false }),
      recoveryChallenge({ expiresAt: "2026-01-01T00:00:01.000Z" }),
      now
    )).toThrow("Invalid recovery token");
    expect(() => ensureUserRecoveryChallengeUsable(
      accountState({ enabled: false }),
      recoveryChallenge({ expiresAt: "2026-01-01T00:00:01.000Z" }),
      now
    )).toThrow("Invalid recovery token");
    expect(() => ensureUserRecoveryChallengeUsable(
      accountState(),
      recoveryChallenge({ expiresAt: now }),
      now
    )).toThrow("Invalid recovery token");
  });

  it("plans email verification patches from provider sync intent", () => {
    expect(emailVerificationPatch(undefined, "owner@example.com", "owner@example.com", undefined, now)).toBeUndefined();
    expect(emailVerificationPatch(false, "owner@example.com", "owner@example.com", now, later)).toBeNull();
    expect(emailVerificationPatch(true, "owner@example.com", "owner@example.com", now, later)).toBe(now);
    expect(emailVerificationPatch(true, "new-owner@example.com", "owner@example.com", now, later)).toBe(later);
    expect(emailVerificationPatch(true, "owner@example.com", "owner@example.com", undefined, later)).toBe(later);
    expect(() => emailVerificationPatch(true, undefined, undefined, undefined, later))
      .toThrow("email is required when emailVerified is true");
  });
});

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-02T00:00:00.000Z";

function accountState(overrides: Partial<UserAccountState> = {}): UserAccountState {
  return {
    tenantId: "acme",
    userId: "owner@example.com",
    version: 1,
    exists: true,
    roles: ["User"],
    providers: [],
    enabled: true,
    ...overrides
  };
}

function recoveryChallenge(overrides: Partial<{ readonly tokenHash: string; readonly expiresAt: string; readonly requestedAt: string }> = {}) {
  return {
    tokenHash: "hash:tok_123",
    expiresAt: "2026-01-01T00:01:00.000Z",
    requestedAt: now,
    ...overrides
  };
}

function emailVerificationChallenge(
  overrides: Partial<{ readonly tokenHash: string; readonly expiresAt: string; readonly requestedAt: string; readonly email: string }> = {}
) {
  return {
    tokenHash: "hash:tok_123",
    expiresAt: "2026-01-01T00:01:00.000Z",
    requestedAt: now,
    email: "owner@example.com",
    ...overrides
  };
}
