import {
  userAccountDisabledPayload,
  userAccountEnabledPayload,
  userEmailVerificationDeliveryFailedPayload,
  userEmailVerificationRequestedPayload,
  userEmailVerifiedPayload,
  userPasswordChangedPayload,
  userPasswordResetDeliveryFailedPayload,
  userPasswordResetCompletedPayload,
  userPasswordResetRequestedPayload,
  userRolesChangedPayload
} from "../../src";
import type { UserAccountEventPayload } from "../../src";

describe("user account events", () => {
  it("builds password change payloads", () => {
    expect(userAccountPayload(userPasswordChangedPayload({
      userId: "owner@example.com",
      passwordHash: "hash:secret-456"
    }))).toEqual({
      kind: "UserPasswordChanged",
      userId: "owner@example.com",
      passwordHash: "hash:secret-456"
    });
  });

  it("builds password reset completion payloads", () => {
    expect(userAccountPayload(userPasswordResetCompletedPayload({
      userId: "owner@example.com",
      passwordHash: "hash:reset-456"
    }))).toEqual({
      kind: "UserPasswordResetCompleted",
      userId: "owner@example.com",
      passwordHash: "hash:reset-456"
    });
  });

  it("builds password reset request and delivery-failure payloads", () => {
    expect(userAccountPayload(userPasswordResetRequestedPayload({
      userId: "owner@example.com",
      tokenHash: "hash:tok_1",
      expiresAt: "2026-01-01T01:00:00.000Z"
    }))).toEqual({
      kind: "UserPasswordResetRequested",
      userId: "owner@example.com",
      tokenHash: "hash:tok_1",
      expiresAt: "2026-01-01T01:00:00.000Z"
    });
    expect(userAccountPayload(userPasswordResetDeliveryFailedPayload({
      userId: "owner@example.com"
    }))).toEqual({
      kind: "UserPasswordResetDeliveryFailed",
      userId: "owner@example.com"
    });
  });

  it("builds email verification request, verified, and delivery-failure payloads", () => {
    expect(userAccountPayload(userEmailVerificationRequestedPayload({
      userId: "owner@example.com",
      email: "owner@example.com",
      tokenHash: "hash:tok_2",
      expiresAt: "2026-01-01T02:00:00.000Z"
    }))).toEqual({
      kind: "UserEmailVerificationRequested",
      userId: "owner@example.com",
      email: "owner@example.com",
      tokenHash: "hash:tok_2",
      expiresAt: "2026-01-01T02:00:00.000Z"
    });
    expect(userAccountPayload(userEmailVerifiedPayload({
      userId: "owner@example.com",
      email: "owner@example.com"
    }))).toEqual({
      kind: "UserEmailVerified",
      userId: "owner@example.com",
      email: "owner@example.com"
    });
    expect(userAccountPayload(userEmailVerificationDeliveryFailedPayload({
      userId: "owner@example.com",
      email: "owner@example.com"
    }))).toEqual({
      kind: "UserEmailVerificationDeliveryFailed",
      userId: "owner@example.com",
      email: "owner@example.com"
    });
  });

  it("builds role change payloads", () => {
    expect(userAccountPayload(userRolesChangedPayload({
      userId: "owner@example.com",
      roles: ["System Manager", "User"]
    }))).toEqual({
      kind: "UserRolesChanged",
      userId: "owner@example.com",
      roles: ["System Manager", "User"]
    });
  });

  it("builds account status payloads", () => {
    expect(userAccountPayload(userAccountEnabledPayload({ userId: "owner@example.com" }))).toEqual({
      kind: "UserAccountEnabled",
      userId: "owner@example.com"
    });
    expect(userAccountPayload(userAccountDisabledPayload({ userId: "owner@example.com" }))).toEqual({
      kind: "UserAccountDisabled",
      userId: "owner@example.com"
    });
  });
});

function userAccountPayload(payload: UserAccountEventPayload): UserAccountEventPayload {
  return payload;
}
