import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote roles", () => {
  it("parses remote role catalog operator commands", () => {
    expect(parseCliArgs([
      "roles",
      "list",
      "--url",
      "https://app.example",
      "--tenant",
      "acme/east",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "roles",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      tenant: "acme/east"
    });

    expect(parseCliArgs([
      "roles",
      "create",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager",
      "--description",
      "Can manage task queues",
      "--disabled",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "roles",
      action: "create",
      url: "https://app.example",
      headers: [],
      role: "Task Manager",
      description: "Can manage task queues",
      enabled: false,
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "roles",
      "describe",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager",
      "--description",
      "Updated description",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "roles",
      action: "describe",
      url: "https://app.example",
      headers: [],
      role: "Task Manager",
      description: "Updated description",
      expectedVersion: 2
    });

    expect(parseCliArgs([
      "roles",
      "disable",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "roles",
      action: "disable",
      url: "https://app.example",
      headers: [],
      role: "Task Manager",
      expectedVersion: 3
    });
  });

  it("rejects invalid remote role options before fetching", () => {
    expect(parseCliArgs(["roles", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown roles command 'unknown'"
    });
    expect(parseCliArgs(["roles", "list", "--role", "Task Manager"])).toEqual({
      kind: "invalid",
      message: "Cannot use --role with roles list"
    });
    expect(parseCliArgs(["roles", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["roles", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Role get requires --role"
    });
    expect(parseCliArgs([
      "roles",
      "describe",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager"
    ])).toEqual({
      kind: "invalid",
      message: "Role describe requires --description"
    });
    expect(parseCliArgs([
      "roles",
      "create",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager",
      "--enabled",
      "--disabled"
    ])).toEqual({
      kind: "invalid",
      message: "Role create cannot use both --enabled and --disabled"
    });
    expect(parseCliArgs([
      "roles",
      "get",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager",
      "--expected-version",
      "1"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --expected-version with roles get"
    });
    expect(parseCliArgs([
      "roles",
      "enable",
      "--url",
      "https://app.example",
      "--role",
      "Task Manager",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Role expected version must be a non-negative integer"
    });
  });

  it("lists and gets remote roles through the generated admin API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      [
        "roles",
        "list",
        "--url",
        "https://app.example/cf",
        "--tenant",
        "acme/east",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(listCalls, {
          data: {
            tenantId: "acme/east",
            version: 2,
            roles: [
              { name: "Task Manager", version: 1, enabled: true, description: "Can manage task queues" },
              { name: "Auditor", version: 2, enabled: false }
            ]
          }
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe("https://app.example/cf/api/roles?tenant=acme%2Feast");
    expect(listCalls[0]?.method).toBe("GET");
    expect(listCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(listStdout.text()).toContain("Role catalog at https://app.example/cf");
    expect(listStdout.text()).toContain("Tenant: acme/east Version: 2 Total: 2");
    expect(listStdout.text()).toContain("- Task Manager enabled v1 - Can manage task queues");
    expect(listStdout.text()).toContain("- Auditor disabled v2");

    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      [
        "roles",
        "get",
        "--url",
        "https://app.example",
        "--role",
        "Task Manager"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: {
            name: "Task Manager",
            version: 3,
            enabled: true,
            description: "Can manage task queues"
          }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );

    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/roles/Task%20Manager");
    expect(getCalls[0]?.method).toBe("GET");
    expect(getStdout.text()).toContain("Role at https://app.example");
    expect(getStdout.text()).toContain("- Task Manager enabled v3 - Can manage task queues");

    const emptyCalls: RemoteCall[] = [];
    const emptyStdout = textBuffer();
    const emptyExit = await runCli(
      [
        "roles",
        "list",
        "--url",
        "https://app.example"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(emptyCalls, {
          data: {
            tenantId: "default",
            version: 0,
            roles: []
          }
        }),
        stdout: emptyStdout,
        stderr: textBuffer()
      }
    );

    expect(emptyExit).toBe(0);
    expect(emptyCalls[0]?.url).toBe("https://app.example/api/roles");
    expect(emptyStdout.text()).toContain("Tenant: default Version: 0 Total: 0");
    expect(emptyStdout.text()).toContain("- (none)");
  });

  it("mutates remote role catalogs through the generated admin API", async () => {
    const createCalls: RemoteCall[] = [];
    const createStdout = textBuffer();
    const createExit = await runCli(
      [
        "roles",
        "create",
        "--url",
        "https://app.example",
        "--role",
        "Support Lead",
        "--description",
        "Can triage support queues",
        "--disabled",
        "--tenant",
        "acme/east",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(createCalls, {
          data: {
            tenantId: "acme/east",
            version: 1,
            roles: [
              { name: "Support Lead", version: 1, enabled: false, description: "Can triage support queues" }
            ]
          }
        }),
        stdout: createStdout,
        stderr: textBuffer()
      }
    );

    expect(createExit).toBe(0);
    expect(createCalls[0]?.url).toBe("https://app.example/api/roles/Support%20Lead?tenant=acme%2Feast");
    expect(createCalls[0]?.method).toBe("POST");
    expect(createCalls[0]?.body).toBe(JSON.stringify({
      description: "Can triage support queues",
      enabled: false,
      expectedVersion: 0
    }));
    expect(createStdout.text()).toContain("Created role at https://app.example");

    const defaultEnabledCalls: RemoteCall[] = [];
    const defaultEnabledExit = await runCli(
      [
        "roles",
        "create",
        "--url",
        "https://app.example",
        "--role",
        "Task Reviewer",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(defaultEnabledCalls, {
          data: {
            tenantId: "default",
            version: 2,
            roles: [
              { name: "Task Reviewer", version: 2, enabled: true }
            ]
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(defaultEnabledExit).toBe(0);
    expect(defaultEnabledCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 1 }));

    const describeCalls: RemoteCall[] = [];
    const describeStdout = textBuffer();
    const describeExit = await runCli(
      [
        "roles",
        "describe",
        "--url",
        "https://app.example",
        "--role",
        "Support Lead",
        "--description",
        "Owns queue triage",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(describeCalls, {
          data: {
            tenantId: "default",
            version: 2,
            roles: [
              { name: "Support Lead", version: 2, enabled: false, description: "Owns queue triage" }
            ]
          }
        }),
        stdout: describeStdout,
        stderr: textBuffer()
      }
    );

    expect(describeExit).toBe(0);
    expect(describeCalls[0]?.url).toBe("https://app.example/api/roles/Support%20Lead/description");
    expect(describeCalls[0]?.method).toBe("PUT");
    expect(describeCalls[0]?.body).toBe(JSON.stringify({
      description: "Owns queue triage",
      expectedVersion: 1
    }));
    expect(describeStdout.text()).toContain("Changed role description at https://app.example");

    const enableCalls: RemoteCall[] = [];
    const enableExit = await runCli(
      [
        "roles",
        "enable",
        "--url",
        "https://app.example",
        "--role",
        "Support Lead",
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(enableCalls, {
          data: {
            tenantId: "default",
            version: 3,
            roles: [
              { name: "Support Lead", version: 3, enabled: true }
            ]
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(enableExit).toBe(0);
    expect(enableCalls[0]?.url).toBe("https://app.example/api/roles/Support%20Lead/enable");
    expect(enableCalls[0]?.method).toBe("POST");
    expect(enableCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 2 }));

    const disableCalls: RemoteCall[] = [];
    const disableExit = await runCli(
      [
        "roles",
        "disable",
        "--url",
        "https://app.example",
        "--role",
        "Support Lead"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(disableCalls, {
          data: {
            tenantId: "default",
            version: 4,
            roles: [
              { name: "Support Lead", version: 4, enabled: false }
            ]
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(disableExit).toBe(0);
    expect(disableCalls[0]?.url).toBe("https://app.example/api/roles/Support%20Lead/disable");
    expect(disableCalls[0]?.method).toBe("POST");
    expect(disableCalls[0]?.body).toBe("{}");
  });

  it("maps remote role API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "roles",
        "create",
        "--url",
        "https://app.example",
        "--role",
        "Task Manager"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "ROLE_EXISTS", message: "Role 'Task Manager' already exists" }
        }, 409),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote roles request failed (409): ROLE_EXISTS: Role 'Task Manager' already exists"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "roles",
        "list",
        "--url",
        "https://app.example",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch(calls, {}),
        stdout: textBuffer(),
        stderr: envStderr
      }
    );

    expect(envExit).toBe(1);
    expect(envStderr.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
    expect(calls).toEqual([]);
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
