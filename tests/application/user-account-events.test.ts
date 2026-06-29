import {
  replayUserAccountAppend,
  userAccountCreatedPayload,
  userAccountDisabledPayload,
  userAccountEnabledPayload,
  userAccountDocumentName,
  userAccountEvent,
  userAuthProviderLinkedPayload,
  userAuthProviderSyncedPayload,
  userEmailVerificationDeliveryFailedPayload,
  userEmailVerificationRequestedPayload,
  userEmailVerifiedPayload,
  userPasswordChangedPayload,
  userPasswordResetDeliveryFailedPayload,
  userPasswordResetCompletedPayload,
  userPasswordResetRequestedPayload,
  userRolesChangedPayload,
  USER_ACCOUNT_PAYLOAD_KINDS
} from "../../src";
import type { DomainEvent, UserAccountEventPayload } from "../../src";

describe("user account events", () => {
  it("builds account creation payloads", () => {
    expect(userAccountPayload(userAccountCreatedPayload({
      userId: "owner@example.com",
      email: "owner@example.com",
      roles: ["User"],
      passwordHash: "hash:secret-123",
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    }))).toEqual({
      kind: "UserAccountCreated",
      userId: "owner@example.com",
      email: "owner@example.com",
      roles: ["User"],
      passwordHash: "hash:secret-123",
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("builds auth provider linked and synced payloads", () => {
    expect(userAccountPayload(userAuthProviderLinkedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: null
    }))).toEqual({
      kind: "UserAuthProviderLinked",
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: null
    });

    expect(userAccountPayload(userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    }))).toEqual({
      kind: "UserAuthProviderSynced",
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    });
  });

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

  it("creates typed user account events from payload identity", () => {
    const payload = userPasswordChangedPayload({
      userId: "owner@example.com",
      passwordHash: "hash:secret-456"
    });

    expect(userAccountEvent({
      id: "evt_account",
      tenantId: "acme",
      stream: "acme:__UserAccounts:owner@example.com",
      actorId: "admin@example.com",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload,
      metadata: { reason: "rotation" }
    })).toMatchObject({
      id: "evt_account",
      type: "UserPasswordChanged",
      doctype: "__UserAccounts",
      documentName: "owner@example.com",
      actorId: "admin@example.com",
      payload,
      metadata: { reason: "rotation" }
    });
  });

  it("derives document names from user account payloads", () => {
    expect(userAccountDocumentName(userAccountDisabledPayload({ userId: "owner@example.com" }))).toBe("owner@example.com");
  });

  it("replays appended account events against the previous stream prefix", () => {
    const previous = [accountCreatedEvent(1)];
    const saved = [rolesChangedEvent(2)];

    expect(replayUserAccountAppend("acme", "owner@example.com", previous, saved)).toMatchObject({
      tenantId: "acme",
      userId: "owner@example.com",
      version: 2,
      roles: ["System Manager", "User"]
    });
  });

  it("exposes the bounded user account payload kind set", () => {
    expect(USER_ACCOUNT_PAYLOAD_KINDS).toEqual([
      "UserAccountCreated",
      "UserAuthProviderLinked",
      "UserAuthProviderSynced",
      "UserPasswordChanged",
      "UserPasswordResetRequested",
      "UserPasswordResetCompleted",
      "UserPasswordResetDeliveryFailed",
      "UserEmailVerificationRequested",
      "UserEmailVerified",
      "UserEmailVerificationDeliveryFailed",
      "UserRolesChanged",
      "UserAccountEnabled",
      "UserAccountDisabled"
    ]);
  });
});

function userAccountPayload(payload: UserAccountEventPayload): UserAccountEventPayload {
  return payload;
}

function accountCreatedEvent(sequence: number): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__UserAccounts:owner@example.com",
    sequence,
    type: "UserAccountCreated",
    doctype: "__UserAccounts",
    documentName: "owner@example.com",
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: {
      kind: "UserAccountCreated",
      userId: "owner@example.com",
      email: "owner@example.com",
      roles: ["User"],
      passwordHash: "hash:secret-123",
      enabled: true
    },
    metadata: {}
  };
}

function rolesChangedEvent(sequence: number): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__UserAccounts:owner@example.com",
    sequence,
    type: "UserRolesChanged",
    doctype: "__UserAccounts",
    documentName: "owner@example.com",
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:05:00.000Z",
    payload: {
      kind: "UserRolesChanged",
      userId: "owner@example.com",
      roles: ["System Manager", "User"]
    },
    metadata: {}
  };
}
