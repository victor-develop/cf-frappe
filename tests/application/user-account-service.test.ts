import {
  createInMemoryAccountRecoveryNotifier,
  InMemoryEventStore,
  RoleCatalogUserRoleValidator,
  RoleService,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  deterministicIds,
  fixedClock,
  userAccountsStream,
  type DocumentEventPayload,
  type PasswordHasher,
  type UserAccountEventPayload
} from "../../src";
import { owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("UserAccountService", () => {
  it("registers user account payloads through the domain event extension map", () => {
    const payload = userAccountPayload({
      kind: "UserAuthProviderSynced",
      userId: owner.id,
      provider: "oidc",
      subject: "00u_owner",
      email: "owner@example.com",
      roles: ["User"],
      enabled: true
    });

    expect(payload.provider).toBe("oidc");
  });

  it("creates event-sourced user accounts and authenticates folded actors", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });

    const created = await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: " Owner@Example.COM ",
      password: "secret-123",
      roles: ["User", "Task Manager", "User"]
    });
    const actor = await userAccounts.authenticate({
      tenantId: "acme",
      userId: "owner@example.com",
      password: "secret-123"
    });

    expect(created).toEqual({
      tenantId: "acme",
      userId: "owner@example.com",
      version: 1,
      email: "owner@example.com",
      roles: ["Task Manager", "User"],
      enabled: true,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    expect(actor).toEqual({
      id: "owner@example.com",
      email: "owner@example.com",
      roles: ["Task Manager", "User"],
      tenantId: "acme"
    });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      {
        id: "evt_create-1",
        type: "UserAccountCreated",
        doctype: "__UserAccounts",
        documentName: "owner@example.com",
        payload: {
          kind: "UserAccountCreated",
          userId: "owner@example.com",
          email: "owner@example.com",
          roles: ["Task Manager", "User"],
          passwordHash: "hash:secret-123",
          enabled: true
        }
      }
    ]);
  });

  it("lists folded accounts for administrators and keeps disabled accounts visible to callers", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-enabled", "create-disabled"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });

    await userAccounts.create({
      actor: admin,
      userId: "enabled@example.com",
      password: "secret-123",
      roles: ["User"],
      enabled: true
    });
    await userAccounts.create({
      actor: admin,
      userId: "disabled@example.com",
      password: "secret-123",
      roles: ["User"],
      enabled: false
    });

    await expect(userAccounts.list(admin)).resolves.toMatchObject({
      tenantId: "acme",
      accounts: [
        { userId: "disabled@example.com", enabled: false },
        { userId: "enabled@example.com", enabled: true }
      ]
    });
    await expect(userAccounts.list(owner)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("changes roles, password, and enabled state through optimistic account events", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-1", "roles-1", "password-1", "disable-1", "enable-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });

    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    const roles = await userAccounts.changeRoles({
      actor: admin,
      userId: "owner@example.com",
      roles: ["System Manager", "User"],
      expectedVersion: 1
    });
    const duplicateRoles = await userAccounts.changeRoles({
      actor: admin,
      userId: "owner@example.com",
      roles: ["User", "System Manager"],
      expectedVersion: 2
    });
    const password = await userAccounts.changePassword({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-456",
      expectedVersion: 2
    });
    const disabled = await userAccounts.disable({
      actor: admin,
      userId: "owner@example.com",
      expectedVersion: 3
    });
    const duplicateDisabled = await userAccounts.disable({
      actor: admin,
      userId: "owner@example.com",
      expectedVersion: 4
    });
    const enabled = await userAccounts.enable({
      actor: admin,
      userId: "owner@example.com",
      expectedVersion: 4
    });

    expect(roles).toMatchObject({ version: 2, roles: ["System Manager", "User"] });
    expect(duplicateRoles.version).toBe(2);
    expect(password.version).toBe(3);
    expect(disabled).toMatchObject({ version: 4, enabled: false });
    expect(duplicateDisabled.version).toBe(4);
    expect(enabled).toMatchObject({ version: 5, enabled: true });
    await expect(
      userAccounts.authenticate({ tenantId: "acme", userId: "owner@example.com", password: "secret-123" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      userAccounts.authenticate({ tenantId: "acme", userId: "owner@example.com", password: "secret-456" })
    ).resolves.toMatchObject({ id: "owner@example.com", roles: ["System Manager", "User"] });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      { payload: { kind: "UserRolesChanged", roles: ["System Manager", "User"] } },
      { payload: { kind: "UserPasswordChanged", passwordHash: "hash:secret-456" } },
      { payload: { kind: "UserAccountDisabled" } },
      { payload: { kind: "UserAccountEnabled" } }
    ]);
  });

  it("creates passwordless provider-linked accounts from auth-provider sync events", async () => {
    const events = new InMemoryEventStore();
    const notifier = createInMemoryAccountRecoveryNotifier();
    let currentTime = "2026-01-02T00:00:00.000Z";
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: notifier,
      ids: deterministicIds(["create-1", "link-1"]),
      clock: { now: () => currentTime }
    });

    const synced = await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      email: " OWNER@EXAMPLE.COM ",
      roles: ["User", "Task Manager"],
      emailVerified: true
    });

    expect(synced).toEqual({
      tenantId: "acme",
      userId: "owner@example.com",
      version: 2,
      email: "owner@example.com",
      emailVerifiedAt: "2026-01-02T00:00:00.000Z",
      roles: ["Task Manager", "User"],
      providers: [
        {
          provider: "cloudflare-access",
          subject: "access-subject-1",
          email: "owner@example.com",
          roles: ["Task Manager", "User"],
          enabled: true,
          emailVerifiedAt: "2026-01-02T00:00:00.000Z",
          linkedAt: "2026-01-02T00:00:00.000Z",
          lastSyncedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      enabled: true,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    await expect(
      userAccounts.authenticate({ tenantId: "acme", userId: "owner@example.com", password: "secret-123" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      {
        id: "evt_create-1",
        payload: {
          kind: "UserAccountCreated",
          userId: "owner@example.com",
          email: "owner@example.com",
          roles: ["Task Manager", "User"],
          enabled: true,
          emailVerifiedAt: "2026-01-02T00:00:00.000Z"
        }
      },
      {
        id: "evt_link-1",
        payload: {
          kind: "UserAuthProviderLinked",
          provider: "cloudflare-access",
          subject: "access-subject-1"
        }
      }
    ]);
    currentTime = "2026-01-03T00:00:00.000Z";
    const duplicate = await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      email: "owner@example.com",
      roles: ["Task Manager", "User"],
      emailVerified: true,
      expectedVersion: 2
    });
    expect(duplicate).toMatchObject({
      version: 2,
      emailVerifiedAt: "2026-01-02T00:00:00.000Z",
      providers: [{ lastSyncedAt: "2026-01-02T00:00:00.000Z" }]
    });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toHaveLength(2);
    await expect(
      userAccounts.requestPasswordReset({ tenantId: "acme", userId: "owner@example.com" })
    ).resolves.toEqual({ tenantId: "acme", userId: "owner@example.com", delivered: false });
    expect(notifier.passwordResetMessages).toEqual([]);
  });

  it("links and syncs provider claims onto existing accounts without repeating identical events", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-1", "link-1", "sync-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "old@example.com",
      password: "secret-123",
      roles: ["User"]
    });

    const linked = await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      email: "owner@example.com",
      roles: ["Support"],
      enabled: false,
      expectedVersion: 1
    });
    const duplicate = await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      email: "owner@example.com",
      roles: ["Support"],
      enabled: false,
      expectedVersion: 2
    });
    const synced = await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      roles: ["Support", "User"],
      enabled: true,
      emailVerified: true,
      expectedVersion: 2
    });

    expect(linked).toMatchObject({
      version: 2,
      email: "owner@example.com",
      roles: ["Support"],
      enabled: false
    });
    expect(duplicate.version).toBe(2);
    expect(synced).toMatchObject({
      version: 3,
      emailVerifiedAt: "2026-01-02T00:00:00.000Z",
      roles: ["Support", "User"],
      enabled: true,
      providers: [
        {
          provider: "cloudflare-access",
          subject: "access-subject-1",
          roles: ["Support", "User"],
          enabled: true
        }
      ]
    });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      { payload: { kind: "UserAuthProviderLinked", enabled: false, roles: ["Support"] } },
      { payload: { kind: "UserAuthProviderSynced", enabled: true, roles: ["Support", "User"] } }
    ]);
  });

  it("clears pending recovery challenges when provider sync disables an account", async () => {
    const events = new InMemoryEventStore();
    const notifier = createInMemoryAccountRecoveryNotifier();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: notifier,
      ids: deterministicIds(["create-1", "reset-request-1", "link-1", "sync-1"]),
      recoveryTokens: deterministicIds(["reset-token"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    await expect(
      userAccounts.requestPasswordReset({ tenantId: "acme", userId: "owner@example.com" })
    ).resolves.toEqual({ tenantId: "acme", userId: "owner@example.com", delivered: true });

    await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      enabled: false,
      expectedVersion: 2
    });
    await userAccounts.syncProvider({
      actor: admin,
      userId: "owner@example.com",
      provider: "cloudflare-access",
      subject: "access-subject-1",
      enabled: true,
      expectedVersion: 3
    });

    await expect(
      userAccounts.resetPassword({
        tenantId: "acme",
        userId: "owner@example.com",
        token: "tok_reset-token",
        password: "secret-456"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      { payload: { kind: "UserPasswordResetRequested" } },
      { payload: { kind: "UserAuthProviderLinked", enabled: false } },
      { payload: { kind: "UserAuthProviderSynced", enabled: true } }
    ]);
  });

  it("revalidates signed-session actors against the current account stream version", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-1", "password-1", "roles-1", "disable-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    const first = await userAccounts.authenticateAccount({
      tenantId: "acme",
      userId: "owner@example.com",
      password: "secret-123"
    });

    await expect(userAccounts.resolveSessionActor(first.actor, first.account.version)).resolves.toEqual(first.actor);
    await userAccounts.changePassword({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-456",
      expectedVersion: 1
    });
    await expect(userAccounts.resolveSessionActor(first.actor, first.account.version)).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });

    const second = await userAccounts.authenticateAccount({
      tenantId: "acme",
      userId: "owner@example.com",
      password: "secret-456"
    });
    await userAccounts.changeRoles({
      actor: admin,
      userId: "owner@example.com",
      roles: ["Task Manager"],
      expectedVersion: 2
    });
    await expect(userAccounts.resolveSessionActor(second.actor, second.account.version)).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });

    const third = await userAccounts.authenticateAccount({
      tenantId: "acme",
      userId: "owner@example.com",
      password: "secret-456"
    });
    await userAccounts.disable({ actor: admin, userId: "owner@example.com", expectedVersion: 3 });
    await expect(userAccounts.resolveSessionActor(third.actor, third.account.version)).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("can validate assigned account roles against the event-sourced role catalog", async () => {
    const events = new InMemoryEventStore();
    const roles = new RoleService({
      events,
      ids: deterministicIds(["user-role", "auditor-role"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await roles.create({ actor: admin, role: "Task Manager", expectedVersion: 0 });
    await roles.create({ actor: admin, role: "Auditor", enabled: false, expectedVersion: 1 });
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z"),
      roleValidator: new RoleCatalogUserRoleValidator({ events })
    });

    await expect(
      userAccounts.create({
        actor: admin,
        userId: "missing@example.com",
        password: "secret-123",
        roles: ["Ghost"]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [{ field: "roles", code: "role_not_found" }]
    });
    await expect(
      userAccounts.create({
        actor: admin,
        userId: "disabled@example.com",
        password: "secret-123",
        roles: ["Auditor"]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [{ field: "roles", code: "role_disabled" }]
    });

    const created = await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-123",
      roles: [" Task   Manager "]
    });
    expect(created).toMatchObject({ roles: ["Task Manager"], version: 1 });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated", roles: ["Task Manager"] } }
    ]);
    await expect(
      userAccounts.changeRoles({
        actor: admin,
        userId: "owner@example.com",
        roles: ["Ghost"],
        expectedVersion: 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [{ field: "roles", code: "role_not_found" }]
    });
  });


  it("requires admin authority, current versions, valid input, and enabled accounts", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["create-1", "disable-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });

    await expect(
      userAccounts.create({
        actor: owner,
        userId: "owner@example.com",
        password: "secret-123",
        roles: ["User"]
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      userAccounts.create({
        actor: admin,
        tenantId: "globex",
        userId: "owner@example.com",
        password: "secret-123",
        roles: ["User"]
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      userAccounts.create({
        actor: admin,
        userId: "owner@example.com",
        password: "short",
        roles: ["User"]
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userAccounts.create({
        actor: admin,
        userId: "owner@example.com",
        password: "secret-123",
        roles: []
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userAccounts.create({
        actor: admin,
        userId: "owner@example.com",
        password: "secret-123",
        roles: ["User"],
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    await expect(
      userAccounts.create({
        actor: admin,
        userId: "owner@example.com",
        password: "secret-123",
        roles: ["User"],
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await userAccounts.disable({ actor: admin, userId: "owner@example.com", expectedVersion: 1 });
    await expect(
      userAccounts.authenticate({ tenantId: "acme", userId: "owner@example.com", password: "secret-123" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Invalid credentials" });
    await expect(userAccounts.get(admin, "missing@example.com")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("requests and consumes password reset tokens through account stream events", async () => {
    const events = new InMemoryEventStore();
    const notifier = createInMemoryAccountRecoveryNotifier();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: notifier,
      ids: deterministicIds(["create-1", "reset-request-1", "reset-complete-1"]),
      recoveryTokens: deterministicIds(["reset-token"]),
      passwordResetExpiresInSeconds: 900,
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });

    const requested = await userAccounts.requestPasswordReset({
      tenantId: "acme",
      userId: "owner@example.com"
    });

    expect(requested).toEqual({
      tenantId: "acme",
      userId: "owner@example.com",
      delivered: true
    });
    expect(notifier.passwordResetMessages).toEqual([
      {
        tenantId: "acme",
        userId: "owner@example.com",
        email: "owner@example.com",
        token: "tok_reset-token",
        expiresAt: "2026-01-02T00:15:00.000Z"
      }
    ]);
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      {
        payload: {
          kind: "UserPasswordResetRequested",
          userId: "owner@example.com",
          tokenHash: "hash:tok_reset-token",
          expiresAt: "2026-01-02T00:15:00.000Z"
        }
      }
    ]);

    const reset = await userAccounts.resetPassword({
      tenantId: "acme",
      userId: "owner@example.com",
      token: "tok_reset-token",
      password: "secret-456"
    });

    expect(reset).toMatchObject({ version: 3 });
    await expect(
      userAccounts.authenticate({ tenantId: "acme", userId: "owner@example.com", password: "secret-456" })
    ).resolves.toMatchObject({ id: "owner@example.com" });
    await expect(
      userAccounts.resetPassword({
        tenantId: "acme",
        userId: "owner@example.com",
        token: "tok_reset-token",
        password: "secret-789"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("requests and consumes email verification tokens through account stream events", async () => {
    const events = new InMemoryEventStore();
    const notifier = createInMemoryAccountRecoveryNotifier();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: notifier,
      ids: deterministicIds(["create-1", "verify-request-1", "verify-complete-1"]),
      recoveryTokens: deterministicIds(["verify-token"]),
      emailVerificationExpiresInSeconds: 600,
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "Owner@Example.COM",
      password: "secret-123",
      roles: ["User"]
    });

    const requested = await userAccounts.requestEmailVerification({
      tenantId: "acme",
      userId: "owner@example.com"
    });
    const verified = await userAccounts.verifyEmail({
      tenantId: "acme",
      userId: "owner@example.com",
      token: "tok_verify-token"
    });

    expect(requested.delivered).toBe(true);
    expect(notifier.emailVerificationMessages).toEqual([
      {
        tenantId: "acme",
        userId: "owner@example.com",
        email: "owner@example.com",
        token: "tok_verify-token",
        expiresAt: "2026-01-02T00:10:00.000Z"
      }
    ]);
    expect(verified).toMatchObject({
      email: "owner@example.com",
      emailVerifiedAt: "2026-01-02T00:00:00.000Z",
      version: 3
    });
    await expect(
      userAccounts.verifyEmail({
        tenantId: "acme",
        userId: "owner@example.com",
        token: "tok_verify-token"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("keeps recovery requests generic for missing, disabled, or undeliverable accounts", async () => {
    const events = new InMemoryEventStore();
    const notifier = createInMemoryAccountRecoveryNotifier();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: notifier,
      ids: deterministicIds(["create-1", "disable-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "no-email@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    await userAccounts.disable({ actor: admin, userId: "no-email@example.com", expectedVersion: 1 });

    await expect(
      userAccounts.requestPasswordReset({ tenantId: "acme", userId: "missing@example.com" })
    ).resolves.toEqual({ tenantId: "acme", userId: "missing@example.com", delivered: false });
    await expect(
      userAccounts.requestPasswordReset({ tenantId: "acme", userId: "no-email@example.com" })
    ).resolves.toEqual({ tenantId: "acme", userId: "no-email@example.com", delivered: false });
    await expect(
      userAccounts.requestEmailVerification({ tenantId: "acme", userId: "no-email@example.com" })
    ).resolves.toEqual({ tenantId: "acme", userId: "no-email@example.com", delivered: false });
    await expect(
      userAccounts.resetPassword({
        tenantId: "acme",
        userId: "no-email@example.com",
        token: "missing",
        password: "secret-456"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(notifier.passwordResetMessages).toEqual([]);
    expect(notifier.emailVerificationMessages).toEqual([]);
    await expect(events.readStream(userAccountsStream("acme", "missing@example.com"))).resolves.toEqual([]);
  });

  it("invalidates pending recovery challenges when an account is disabled", async () => {
    const events = new InMemoryEventStore();
    const notifier = createInMemoryAccountRecoveryNotifier();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: notifier,
      ids: deterministicIds(["create-1", "reset-request-1", "disable-1", "enable-1"]),
      recoveryTokens: deterministicIds(["reset-token"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    await userAccounts.requestPasswordReset({ tenantId: "acme", userId: "owner@example.com" });
    await userAccounts.disable({ actor: admin, userId: "owner@example.com", expectedVersion: 2 });
    await userAccounts.enable({ actor: admin, userId: "owner@example.com", expectedVersion: 3 });

    await expect(
      userAccounts.resetPassword({
        tenantId: "acme",
        userId: "owner@example.com",
        token: "tok_reset-token",
        password: "secret-456"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("clears requested recovery challenges when delivery fails", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery: {
        sendPasswordReset() {
          throw new Error("delivery unavailable");
        },
        sendEmailVerification() {
          throw new Error("delivery unavailable");
        }
      },
      ids: deterministicIds(["create-1", "reset-request-1", "reset-failed-1"]),
      recoveryTokens: deterministicIds(["reset-token"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });

    await expect(
      userAccounts.requestPasswordReset({ tenantId: "acme", userId: "owner@example.com" })
    ).resolves.toEqual({ tenantId: "acme", userId: "owner@example.com", delivered: false });
    await expect(
      userAccounts.resetPassword({
        tenantId: "acme",
        userId: "owner@example.com",
        token: "tok_reset-token",
        password: "secret-456"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      { payload: { kind: "UserPasswordResetRequested" } },
      { payload: { kind: "UserPasswordResetDeliveryFailed" } }
    ]);
  });
});

function userAccountPayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "UserAuthProviderSynced" }>
): Extract<UserAccountEventPayload, { readonly kind: "UserAuthProviderSynced" }> {
  return payload;
}

function deterministicPasswords(): PasswordHasher {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hash:${password}`;
    }
  };
}
