import {
  emailVerificationPatch,
  MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS,
  normalizeRecoveryExpirySeconds,
  recoveryChallengeExpired,
  recoveryExpiresAtFrom
} from "../../src";

describe("user account policy", () => {
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
