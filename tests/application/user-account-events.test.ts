import {
  userAccountDisabledPayload,
  userAccountEnabledPayload,
  userPasswordChangedPayload,
  userPasswordResetCompletedPayload,
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
