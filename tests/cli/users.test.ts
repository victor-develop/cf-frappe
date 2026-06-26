import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote users", () => {
  it("parses remote user account operator commands", () => {
    expect(parseCliArgs([
      "users",
      "get",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--tenant",
      "acme/east",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "users",
      action: "get",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      userId: "owner@example.com",
      tenant: "acme/east"
    });

    expect(parseCliArgs([
      "users",
      "create",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--password-env",
      "CF_FRAPPE_USER_PASSWORD",
      "--role",
      "User",
      "--role",
      "Task Manager",
      "--email",
      "owner@example.com",
      "--disabled",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "users",
      action: "create",
      url: "https://app.example",
      headers: [],
      userId: "owner@example.com",
      passwordEnv: "CF_FRAPPE_USER_PASSWORD",
      roles: ["User", "Task Manager"],
      email: "owner@example.com",
      enabled: false,
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "users",
      "provider-sync",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--provider",
      "oidc",
      "--subject",
      "sub-123",
      "--email-verified",
      "--role",
      "OIDC:Ops"
    ])).toEqual({
      kind: "users",
      action: "provider-sync",
      url: "https://app.example",
      headers: [],
      userId: "owner@example.com",
      provider: "oidc",
      subject: "sub-123",
      emailVerified: true,
      roles: ["OIDC:Ops"]
    });
  });

  it("rejects invalid remote user options before fetching", () => {
    expect(parseCliArgs(["users", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown users command 'unknown'"
    });
    expect(parseCliArgs(["users", "get", "--user-id", "owner@example.com"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["users", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "User get requires --user-id"
    });
    expect(parseCliArgs([
      "users",
      "create",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--role",
      "User"
    ])).toEqual({
      kind: "invalid",
      message: "User create requires --password-env"
    });
    expect(parseCliArgs([
      "users",
      "create",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--password-env",
      "CF_FRAPPE_USER_PASSWORD"
    ])).toEqual({
      kind: "invalid",
      message: "User create requires at least one --role"
    });
    expect(parseCliArgs([
      "users",
      "password",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--password-env",
      "bad-name"
    ])).toEqual({
      kind: "invalid",
      message: "User password env var 'bad-name' is invalid"
    });
    expect(parseCliArgs([
      "users",
      "get",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--role",
      "User"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --role with users get"
    });
    expect(parseCliArgs([
      "users",
      "provider-sync",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--provider",
      "oidc"
    ])).toEqual({
      kind: "invalid",
      message: "User provider-sync requires --subject"
    });
    expect(parseCliArgs([
      "users",
      "disable",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "User expected version must be a non-negative integer"
    });
  });

  it("gets remote user accounts through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "users",
        "get",
        "--url",
        "https://app.example/cf",
        "--user-id",
        "owner@example.com",
        "--tenant",
        "acme/east",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            userId: "owner@example.com",
            version: 2,
            email: "owner@example.com",
            emailVerifiedAt: "2026-06-26T12:00:00.000Z",
            roles: ["Task Manager", "User"],
            providers: [
              { provider: "oidc", subject: "sub-123", enabled: true, roles: ["OIDC:Ops"] }
            ],
            enabled: true
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/users/owner%40example.com?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("User account at https://app.example/cf");
    expect(stdout.text()).toContain("User: owner@example.com Tenant: acme/east Version: 2 enabled");
    expect(stdout.text()).toContain("Roles: Task Manager, User");
    expect(stdout.text()).toContain("Email: owner@example.com verified");
    expect(stdout.text()).toContain("Providers: 1");
    expect(stdout.text()).toContain("- oidc:sub-123 enabled roles OIDC:Ops");
  });

  it("mutates remote user accounts through the generated admin API", async () => {
    const createCalls: RemoteCall[] = [];
    const createStdout = textBuffer();
    const createExit = await runCli(
      [
        "users",
        "create",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--password-env",
        "CF_FRAPPE_USER_PASSWORD",
        "--role",
        "User",
        "--role",
        "Task Manager",
        "--email",
        "owner@example.com",
        "--disabled",
        "--tenant",
        "acme/east",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_USER_PASSWORD" ? "secret-123" : undefined,
        fetch: fakeFetch(createCalls, {
          data: {
            tenantId: "acme/east",
            userId: "owner@example.com",
            version: 1,
            email: "owner@example.com",
            roles: ["Task Manager", "User"],
            enabled: false
          }
        }, 201),
        stdout: createStdout,
        stderr: textBuffer()
      }
    );

    expect(createExit).toBe(0);
    expect(createCalls[0]?.url).toBe("https://app.example/api/users/owner%40example.com?tenant=acme%2Feast");
    expect(createCalls[0]?.method).toBe("POST");
    expect(createCalls[0]?.body).toBe(JSON.stringify({
      password: "secret-123",
      roles: ["User", "Task Manager"],
      email: "owner@example.com",
      enabled: false,
      expectedVersion: 0
    }));
    expect(createStdout.text()).toContain("Created user account at https://app.example");
    expect(createStdout.text()).toContain("Version: 1 disabled");

    const passwordCalls: RemoteCall[] = [];
    const passwordExit = await runCli(
      [
        "users",
        "password",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--password-env",
        "CF_FRAPPE_USER_PASSWORD",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_USER_PASSWORD" ? "secret-456" : undefined,
        fetch: fakeFetch(passwordCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 2,
            roles: ["User"],
            enabled: true
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(passwordExit).toBe(0);
    expect(passwordCalls[0]?.url).toBe("https://app.example/api/users/owner%40example.com/password");
    expect(passwordCalls[0]?.method).toBe("PUT");
    expect(passwordCalls[0]?.body).toBe(JSON.stringify({
      password: "secret-456",
      expectedVersion: 1
    }));

    const rolesCalls: RemoteCall[] = [];
    const rolesExit = await runCli(
      [
        "users",
        "roles",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--role",
        "Support Manager",
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(rolesCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 3,
            roles: ["Support Manager"],
            enabled: true
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(rolesExit).toBe(0);
    expect(rolesCalls[0]?.url).toBe("https://app.example/api/users/owner%40example.com/roles");
    expect(rolesCalls[0]?.method).toBe("PUT");
    expect(rolesCalls[0]?.body).toBe(JSON.stringify({
      roles: ["Support Manager"],
      expectedVersion: 2
    }));

    const providerCalls: RemoteCall[] = [];
    const providerExit = await runCli(
      [
        "users",
        "provider-sync",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--provider",
        "oidc",
        "--subject",
        "sub-123",
        "--email",
        "owner@example.com",
        "--role",
        "OIDC:Ops",
        "--enabled",
        "--email-verified",
        "--expected-version",
        "3"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(providerCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 4,
            roles: ["OIDC:Ops"],
            providers: [{ provider: "oidc", subject: "sub-123", roles: ["OIDC:Ops"] }],
            enabled: true
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(providerExit).toBe(0);
    expect(providerCalls[0]?.url).toBe("https://app.example/api/users/owner%40example.com/provider-sync");
    expect(providerCalls[0]?.method).toBe("POST");
    expect(providerCalls[0]?.body).toBe(JSON.stringify({
      provider: "oidc",
      subject: "sub-123",
      email: "owner@example.com",
      roles: ["OIDC:Ops"],
      enabled: true,
      emailVerified: true,
      expectedVersion: 3
    }));

    const disableCalls: RemoteCall[] = [];
    const disableExit = await runCli(
      [
        "users",
        "disable",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--expected-version",
        "4"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(disableCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 5,
            roles: ["OIDC:Ops"],
            enabled: false
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(disableExit).toBe(0);
    expect(disableCalls[0]?.url).toBe("https://app.example/api/users/owner%40example.com/disable");
    expect(disableCalls[0]?.method).toBe("POST");
    expect(disableCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 4 }));

    const enableCalls: RemoteCall[] = [];
    const enableExit = await runCli(
      [
        "users",
        "enable",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(enableCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 6,
            roles: ["OIDC:Ops"],
            enabled: true
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(enableExit).toBe(0);
    expect(enableCalls[0]?.url).toBe("https://app.example/api/users/owner%40example.com/enable");
    expect(enableCalls[0]?.method).toBe("POST");
    expect(enableCalls[0]?.body).toBe("{}");
  });

  it("maps remote user API and env errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "users",
        "roles",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--role",
        "Missing Role"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "ROLE_NOT_FOUND", message: "Role 'Missing Role' is disabled or missing" }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote users request failed (400): ROLE_NOT_FOUND: Role 'Missing Role' is disabled or missing"
    );

    const envCalls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "users",
        "password",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--password-env",
        "CF_FRAPPE_USER_PASSWORD"
      ],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch(envCalls, {}),
        stdout: textBuffer(),
        stderr: envStderr
      }
    );

    expect(envExit).toBe(1);
    expect(envStderr.text()).toContain("Environment variable 'CF_FRAPPE_USER_PASSWORD' is not set for user password");
    expect(envCalls).toEqual([]);
  });
});

interface RemoteCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

function fakeFetch(calls: RemoteCall[], responseBody: unknown, status = 200): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    return new Response(JSON.stringify(responseBody), {
      headers: { "content-type": "application/json" },
      status
    });
  };
}

function textBuffer(): WritableText & { readonly text: () => string } {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}
