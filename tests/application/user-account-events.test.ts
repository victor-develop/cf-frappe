import {
  findUserAuthProviderLink,
  foldUserAccount,
  isUserAccountEvent,
  isUserAccountPayloadKind,
  providerSyncChangesState,
  replayUserAccountAppend,
  userAccountCreatedPayload,
  userAccountDisabledPayload,
  userAccountEnabledPayload,
  userAccountDocumentName,
  userAccountEvent,
  userAccountEventType,
  userAccountStatusChangedPayload,
  userAuthProviderChangePayload,
  userAuthProviderCreatedPayloads,
  userAuthProviderLinkedPayload,
  userAuthProviderPayloadInput,
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
import type { DomainEvent, UserAccountEventPayload, UserAccountState, UserAuthProviderLink } from "../../src";

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

  it("builds provider-created account and link payloads together", () => {
    const [created, linked] = userAuthProviderCreatedPayloads({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(userAccountPayload(created)).toEqual({
      kind: "UserAccountCreated",
      userId: "owner@example.com",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(userAccountPayload(linked)).toEqual({
      kind: "UserAuthProviderLinked",
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("omits cleared provider verification from account-created payloads", () => {
    const [created, linked] = userAuthProviderCreatedPayloads({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: null
    });

    expect(userAccountPayload(created)).toEqual({
      kind: "UserAccountCreated",
      userId: "owner@example.com",
      roles: ["User"],
      enabled: true
    });
    expect(userAccountPayload(linked)).toEqual({
      kind: "UserAuthProviderLinked",
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: null
    });
  });

  it("selects provider link or sync payloads from link state", () => {
    expect(userAccountPayload(userAuthProviderChangePayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    }, undefined))).toEqual({
      kind: "UserAuthProviderLinked",
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    });
    expect(userAccountPayload(userAuthProviderChangePayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    }, baseProviderLink()))).toEqual({
      kind: "UserAuthProviderSynced",
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    });
  });

  it("shapes provider payload input with only identity fields when optional values are absent", () => {
    expect(userAuthProviderPayloadInput({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    })).toEqual({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    });
  });

  it("preserves provider payload input values that intentionally clear or disable state", () => {
    expect(userAuthProviderPayloadInput({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      enabled: false,
      emailVerifiedAt: null
    })).toEqual({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      enabled: false,
      emailVerifiedAt: null
    });
  });

  it("shapes complete provider payload input for link and sync event construction", () => {
    expect(userAuthProviderPayloadInput({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["System Manager", "User"],
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    })).toEqual({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["System Manager", "User"],
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
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

  it("builds account status payloads from enabled state", () => {
    expect(userAccountPayload(userAccountStatusChangedPayload({ userId: "owner@example.com", enabled: true }))).toEqual({
      kind: "UserAccountEnabled",
      userId: "owner@example.com"
    });
    expect(userAccountPayload(userAccountStatusChangedPayload({ userId: "owner@example.com", enabled: false }))).toEqual({
      kind: "UserAccountDisabled",
      userId: "owner@example.com"
    });
  });

  it("derives user account event types from payload identity", () => {
    expect(userAccountEventType(userAccountCreatedPayload({
      userId: "owner@example.com",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true
    }))).toBe("UserAccountCreated");
    expect(userAccountEventType(userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123"
    }))).toBe("UserAuthProviderSynced");
    expect(userAccountEventType(userPasswordResetCompletedPayload({
      userId: "owner@example.com",
      passwordHash: "hash:reset-456"
    }))).toBe("UserPasswordResetCompleted");
    expect(userAccountEventType(userRolesChangedPayload({
      userId: "owner@example.com",
      roles: ["System Manager", "User"]
    }))).toBe("UserRolesChanged");
    expect(userAccountEventType(userAccountDisabledPayload({ userId: "owner@example.com" }))).toBe("UserAccountDisabled");
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

  it("narrows user account events by payload kind when event type names are custom", () => {
    const created = {
      ...accountCreatedEvent(1),
      type: "AccessUserProvisioned"
    };

    expect(isUserAccountPayloadKind("UserAccountCreated")).toBe(true);
    expect(isUserAccountPayloadKind("DocumentDeleted")).toBe(false);
    expect(isUserAccountEvent(created)).toBe(true);
    expect(isUserAccountEvent(otherEvent({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds user account state by payload kind when event type names are custom", () => {
    const misleadingUnrelated = otherEvent({ kind: "DocumentDeleted" }, "UserAccountCreated");
    const customTypedCreated = {
      ...accountCreatedEvent(2),
      type: "AccessUserProvisioned"
    };

    const state = foldUserAccount("acme", "owner@example.com", [misleadingUnrelated, customTypedCreated]);

    expect(state).toMatchObject({
      tenantId: "acme",
      userId: "owner@example.com",
      version: 2,
      exists: true,
      email: "owner@example.com",
      roles: ["User"],
      enabled: true
    });
  });

  it("finds provider links by provider and subject", () => {
    expect(findUserAuthProviderLink([
      baseProviderLink(),
      { ...baseProviderLink(), provider: "github", subject: "gh_456" }
    ], "github", "gh_456")).toMatchObject({
      provider: "github",
      subject: "gh_456"
    });
  });

  it("does not match provider links by provider or subject alone", () => {
    expect(findUserAuthProviderLink([baseProviderLink()], "google", "other_sub")).toBeUndefined();
    expect(findUserAuthProviderLink([baseProviderLink()], "github", "sub_123")).toBeUndefined();
  });

  it("detects no-op provider sync payloads", () => {
    expect(providerSyncChangesState(baseState(), baseProviderLink(), userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true,
      emailVerifiedAt: "2026-01-01T00:00:00.000Z"
    }))).toBe(false);
  });

  it("detects provider sync account and link field drift", () => {
    expect(providerSyncChangesState(baseState(), baseProviderLink(), userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      email: "new-owner@example.com"
    }))).toBe(true);
    expect(providerSyncChangesState(baseState(), baseProviderLink(), userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      roles: ["System Manager", "User"]
    }))).toBe(true);
    expect(providerSyncChangesState(baseState(), baseProviderLink(), userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      enabled: false
    }))).toBe(true);
  });

  it("detects provider sync email verification changes including clears", () => {
    expect(providerSyncChangesState(baseState(), baseProviderLink(), userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      emailVerifiedAt: "2026-01-02T00:00:00.000Z"
    }))).toBe(true);
    expect(providerSyncChangesState(baseState(), baseProviderLink(), userAuthProviderSyncedPayload({
      userId: "owner@example.com",
      provider: "google",
      subject: "sub_123",
      emailVerifiedAt: null
    }))).toBe(true);
  });
});

function userAccountPayload(payload: UserAccountEventPayload): UserAccountEventPayload {
  return payload;
}

function otherEvent(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_other",
    tenantId: "acme",
    stream: "acme:Note:NOTE-1",
    sequence: 1,
    type,
    doctype: "Note",
    documentName: "NOTE-1",
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
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

function baseState(): UserAccountState {
  return {
    tenantId: "acme",
    userId: "owner@example.com",
    version: 1,
    exists: true,
    email: "owner@example.com",
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    roles: ["User"],
    providers: [baseProviderLink()],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function baseProviderLink(): UserAuthProviderLink {
  return {
    provider: "google",
    subject: "sub_123",
    email: "owner@example.com",
    roles: ["User"],
    enabled: true,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    linkedAt: "2026-01-01T00:00:00.000Z",
    lastSyncedAt: "2026-01-01T00:00:00.000Z"
  };
}
