import {
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  UserProfileService,
  createResourceApi,
  deterministicIds,
  fixedClock,
  unsafeHeaderActorResolver,
  type PasswordHasher
} from "../../src";
import { createServices, now, owner } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("user profile api", () => {
  it("lets administrators and the profile owner read and update event-sourced profiles", async () => {
    const { app } = makeProfileApp();
    await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ password: "secret-123", roles: ["User"] })
    });

    const updated = await app.request("/api/users/owner%40example.com/profile", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        fullName: " Ada Lovelace ",
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada",
        language: "en",
        timeZone: "Europe/London",
        phone: "+44 20 1234",
        bio: "First programmer",
        expectedVersion: 0
      })
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        userId: "owner@example.com",
        version: 1,
        profile: {
          fullName: "Ada Lovelace",
          firstName: "Ada",
          lastName: "Lovelace",
          username: "ada",
          language: "en",
          timeZone: "Europe/London",
          phone: "+44 20 1234",
          bio: "First programmer"
        },
        updatedAt: now
      }
    });

    const selfUpdate = await app.request("/api/users/owner%40example.com/profile", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-cf-frappe-user": owner.id,
        "x-cf-frappe-roles": "User",
        "x-cf-frappe-tenant": "acme"
      },
      body: JSON.stringify({ phone: null, bio: "Analytical engine notes", expectedVersion: 1 })
    });
    expect(selfUpdate.status).toBe(200);
    await expect(selfUpdate.json()).resolves.toMatchObject({
      data: {
        version: 2,
        profile: {
          fullName: "Ada Lovelace",
          bio: "Analytical engine notes"
        }
      }
    });

    const loaded = await app.request("/api/users/owner%40example.com/profile", {
      headers: {
        "x-cf-frappe-user": owner.id,
        "x-cf-frappe-roles": "User",
        "x-cf-frappe-tenant": "acme"
      }
    });
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      data: {
        version: 2,
        profile: { fullName: "Ada Lovelace", bio: "Analytical engine notes" }
      }
    });
  });

  it("protects profile writes before parsing malformed bodies", async () => {
    const { app } = makeProfileApp();
    await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ password: "secret-123", roles: ["User"] })
    });

    const denied = await app.request("/api/users/owner%40example.com/profile", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-cf-frappe-user": "other@example.com",
        "x-cf-frappe-roles": "User",
        "x-cf-frappe-tenant": "acme"
      },
      body: "{"
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const invalid = await app.request("/api/users/owner%40example.com/profile", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ unknown: "field" })
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeProfileApp() {
  const services = createServices(["e1"], {
    savedFilterIds: ["sf1", "sfe1"],
    savedReportIds: ["sr1", "sre1"]
  });
  const userAccounts = new UserAccountService({
    events: services.events,
    passwords: deterministicPasswords(),
    ids: deterministicIds(["account-1"]),
    clock: fixedClock(now)
  });
  const userProfiles = new UserProfileService({
    events: services.events,
    ids: deterministicIds(["profile-1", "profile-2"]),
    clock: fixedClock(now)
  });
  return {
    services,
    userAccounts,
    userProfiles,
    app: createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      userAccounts,
      userProfiles
    })
  };
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
