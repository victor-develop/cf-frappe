import {
  InMemoryEventStore,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  deterministicIds,
  fixedClock,
  userAccountsStream,
  type PasswordHasher
} from "../../src";
import { owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("UserAccountService", () => {
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
});

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
