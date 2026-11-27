import {
  InMemoryScimTokenStore,
  RoleService,
  ScimService,
  ScimTokenService,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  createScimApi,
  deterministicIds,
  fixedClock,
  unsafeHeaderActorResolver,
  userAccountsStream,
  type ActorResolver,
  type PasswordHasher
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("scim api", () => {
  it("issues tenant bearer tokens, provisions users idempotently, and maps groups", async () => {
    const { app, services, userAccounts } = makeScimApp();
    const issued = await app.request("/api/scim/tokens", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Okta", expiresInSeconds: 60 })
    });
    expect(issued.status).toBe(201);
    const issueResult = (await issued.json()) as { data: { token: string; record: Record<string, unknown> } };
    expect(issueResult.data.record).not.toHaveProperty("tokenHash");
    const headers = { authorization: `Bearer ${issueResult.data.token}`, "content-type": "application/json" };

    const unauthorized = await app.request("/scim/v2/Users", { headers: { "content-type": "application/json" } });
    expect(unauthorized.status).toBe(403);
    await expect(unauthorized.json()).resolves.toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "403"
    });

    const created = await app.request("/scim/v2/Users", {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "ada@example.com",
        externalId: "ada-id",
        emails: [{ value: "ADA@example.com", primary: true }],
        roles: [{ value: "User" }]
      })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      userName: "ada@example.com",
      externalId: "ada-id",
      email: "ada@example.com",
      roles: ["User"],
      active: true,
      meta: { resourceType: "User" }
    });

    const adminActor = {
      id: "admin@example.com",
      roles: [SYSTEM_MANAGER_ROLE],
      tenantId: "acme"
    };
    await userAccounts.create({
      actor: adminActor,
      userId: "session@example.com",
      password: "secret-123",
      roles: ["User"],
      tenantId: "acme"
    });
    const authenticated = await userAccounts.authenticateAccount({
      userId: "session@example.com",
      password: "secret-123",
      tenantId: "acme"
    });
    await expect(
      userAccounts.resolveSessionActor(authenticated.actor, authenticated.account.version)
    ).resolves.toMatchObject({ id: "session@example.com" });

    const deprovisioned = await app.request("/scim/v2/Users/session@example.com", {
      method: "DELETE",
      headers
    });
    expect(deprovisioned.status).toBe(204);
    await expect(
      userAccounts.resolveSessionActor(authenticated.actor, authenticated.account.version)
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    const replacement = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "ada@example.com",
      externalId: "ada-id",
      emails: [{ value: "ada@example.com" }],
      roles: [{ value: "User" }, { value: "Task Manager" }],
      active: false
    };
    const replaced = await app.request("/scim/v2/Users/ada@example.com", {
      method: "PUT",
      headers,
      body: JSON.stringify(replacement)
    });
    expect(replaced.status).toBe(200);
    await expect(replaced.json()).resolves.toMatchObject({
      roles: ["Task Manager", "User"],
      active: false
    });
    const streamBeforeReplay = await services.events.readStream(userAccountsStream("acme", "ada@example.com"));
    expect(streamBeforeReplay.filter((event) => event.payload.kind === "UserAccountDisabled")).toHaveLength(1);

    const replay = await app.request("/scim/v2/Users/ada@example.com", {
      method: "PUT",
      headers,
      body: JSON.stringify(replacement)
    });
    expect(replay.status).toBe(200);
    const streamAfterReplay = await services.events.readStream(userAccountsStream("acme", "ada@example.com"));
    expect(streamAfterReplay.filter((event) => event.payload.kind === "UserAccountDisabled")).toHaveLength(1);

    const patched = await app.request("/scim/v2/Users/ada@example.com", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:PatchOp"],
        Operations: [
          { op: "replace", path: "active", value: true },
          { op: "replace", path: "roles", value: [{ value: "User" }] }
        ]
      })
    });
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({ roles: ["User"], active: true });

    const group = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers,
      body: JSON.stringify({ displayName: "Engineering", description: "IdP Engineering" })
    });
    expect(group.status).toBe(201);
    await expect(group.json()).resolves.toMatchObject({ id: "Engineering", displayName: "Engineering" });

    const membersAdded = await app.request("/scim/v2/Groups/Engineering", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:PatchOp"],
        Operations: [{ op: "add", path: "members", value: [{ value: "ada@example.com" }] }]
      })
    });
    expect(membersAdded.status).toBe(200);
    const userAfterMembership = await app.request("/scim/v2/Users/ada@example.com", { headers });
    await expect(userAfterMembership.json()).resolves.toMatchObject({ roles: ["Engineering", "User"] });

    const membersRemoved = await app.request("/scim/v2/Groups/Engineering", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:PatchOp"],
        Operations: [{ op: "remove", path: "members[value eq \"ada@example.com\"]" }]
      })
    });
    expect(membersRemoved.status).toBe(200);
    const userAfterRemoval = await app.request("/scim/v2/Users/ada@example.com", { headers });
    await expect(userAfterRemoval.json()).resolves.toMatchObject({ roles: ["User"] });

    const discovery = await app.request("/scim/v2/ServiceProviderConfig", { headers });
    expect(discovery.status).toBe(200);
    await expect(discovery.json()).resolves.toMatchObject({ authenticationSchemes: [{ type: "httpbearertoken" }] });

    const revoked = await app.request("/api/scim/tokens/scim_token-1/revoke", {
      method: "POST",
      headers: adminHeaders
    });
    expect(revoked.status).toBe(200);
    const afterRevocation = await app.request("/scim/v2/Users", { headers });
    expect(afterRevocation.status).toBe(403);
    await expect(afterRevocation.json()).resolves.toMatchObject({ status: "403" });
  });

  it("filters and paginates users", async () => {
    const { app } = makeScimApp();
    const token = await issueToken(app);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const createUsers = async (userName: string, externalId: string) => {
      await app.request("/scim/v2/Users", {
        method: "POST",
        headers,
        body: JSON.stringify({ userName, externalId })
      });
    };
    await createUsers("ada@example.com", "ada-id");
    await createUsers("grace@example.com", "grace-id");

    const filtered = await app.request("/scim/v2/Users?filter=externalId%20eq%20%22grace-id%22", { headers });
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({
      totalResults: 1,
      Resources: [{ userName: "grace@example.com", externalId: "grace-id" }]
    });

    const paged = await app.request("/scim/v2/Users?startIndex=2&count=1", { headers });
    expect(paged.status).toBe(200);
    await expect(paged.json()).resolves.toMatchObject({
      totalResults: 2,
      startIndex: 2,
      itemsPerPage: 1,
      Resources: [{ userName: "grace@example.com" }]
    });
  });
});

function makeScimApp() {
  const services = createServices(["user-event-1", "user-event-2", "user-event-3", "user-event-4", "user-event-5"]);
  const userAccounts = new UserAccountService({
    events: services.events,
    passwords: deterministicPasswords(),
    ids: deterministicIds([
      "user-event-6", "user-event-7", "user-event-8", "user-event-9", "user-event-10",
      "user-event-11", "user-event-12", "user-event-13", "user-event-14", "user-event-15",
      "user-event-16", "user-event-17", "user-event-18", "user-event-19", "user-event-20"
    ]),
    clock: fixedClock(now)
  });
  const roles = new RoleService({
    events: services.events,
    ids: deterministicIds(["role-event-1", "role-event-2", "role-event-3", "role-event-4", "role-event-5"]),
    clock: fixedClock(now)
  });
  const scim = new ScimService({ users: userAccounts, roles });
  const tokens = new ScimTokenService({
    tokens: new InMemoryScimTokenStore(),
    tokenSecrets: deterministicPasswords(),
    ids: deterministicIds(["token-1", "secret-1", "token-2", "secret-2"]),
    clock: fixedClock(now)
  });
  const adminActor: ActorResolver = unsafeHeaderActorResolver;
  const app = createScimApi({
    scim,
    actor: (request) => tokens.actorFromBearer(request),
    tokenActor: adminActor,
    tokens
  });
  return { app, services, userAccounts, roles, scim, tokens };
}

async function issueToken(app: ReturnType<typeof makeScimApp>["app"]): Promise<string> {
  const response = await app.request("/api/scim/tokens", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Okta" })
  });
  const result = (await response.json()) as { data: { token: string } };
  return result.data.token;
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
