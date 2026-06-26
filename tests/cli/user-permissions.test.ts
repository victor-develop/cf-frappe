import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote user permissions", () => {
  it("parses remote user-permission operator commands", () => {
    expect(parseCliArgs([
      "user-permissions",
      "list",
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
      kind: "user-permissions",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      userId: "owner@example.com",
      tenant: "acme/east"
    });

    expect(parseCliArgs([
      "user-permissions",
      "allow",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--target-doctype",
      "Project",
      "--target-name",
      "Apollo",
      "--applicable-doctype",
      "Task",
      "--applicable-doctype",
      "Issue",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "user-permissions",
      action: "allow",
      url: "https://app.example",
      headers: [],
      userId: "owner@example.com",
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Task", "Issue"],
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "user-permissions",
      "revoke",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--target-doctype",
      "Project",
      "--target-name",
      "Apollo"
    ])).toEqual({
      kind: "user-permissions",
      action: "revoke",
      url: "https://app.example",
      headers: [],
      userId: "owner@example.com",
      targetDoctype: "Project",
      targetName: "Apollo"
    });
  });

  it("rejects invalid remote user-permission options before fetching", () => {
    expect(parseCliArgs(["user-permissions", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown user-permissions command 'unknown'"
    });
    expect(parseCliArgs(["user-permissions", "list", "--user-id", "owner@example.com"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["user-permissions", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "User permission list requires --user-id"
    });
    expect(parseCliArgs([
      "user-permissions",
      "allow",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--target-name",
      "Apollo"
    ])).toEqual({
      kind: "invalid",
      message: "User permission allow requires --target-doctype"
    });
    expect(parseCliArgs([
      "user-permissions",
      "revoke",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--target-doctype",
      "Project"
    ])).toEqual({
      kind: "invalid",
      message: "User permission revoke requires --target-name"
    });
    expect(parseCliArgs([
      "user-permissions",
      "list",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--target-doctype",
      "Project"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --target-doctype with user-permissions list"
    });
    expect(parseCliArgs([
      "user-permissions",
      "allow",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--target-doctype",
      "Project",
      "--target-name",
      "Apollo",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "User permission expected version must be a non-negative integer"
    });
  });

  it("lists remote user permissions through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "user-permissions",
        "list",
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
            grants: [
              {
                targetDoctype: "Project",
                targetName: "Apollo",
                applicableDoctypes: ["Issue", "Task"]
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/user-permissions/owner%40example.com?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("User permissions at https://app.example/cf");
    expect(stdout.text()).toContain("User: owner@example.com Tenant: acme/east Version: 2 Total: 1");
    expect(stdout.text()).toContain("- Project/Apollo applies Issue, Task");
    expect(stdout.text()).toContain("{\"targetDoctype\":\"Project\"");
  });

  it("allows and revokes remote user permission grants through the generated admin API", async () => {
    const allowCalls: RemoteCall[] = [];
    const allowStdout = textBuffer();
    const allowExit = await runCli(
      [
        "user-permissions",
        "allow",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--target-doctype",
        "Project",
        "--target-name",
        "Apollo/2026",
        "--applicable-doctype",
        "Task",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(allowCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 3,
            grants: [{ targetDoctype: "Project", targetName: "Apollo/2026", applicableDoctypes: ["Task"] }]
          }
        }, 201),
        stdout: allowStdout,
        stderr: textBuffer()
      }
    );

    expect(allowExit).toBe(0);
    expect(allowCalls[0]?.url).toBe("https://app.example/api/user-permissions/owner%40example.com");
    expect(allowCalls[0]?.method).toBe("POST");
    expect(allowCalls[0]?.body).toBe(JSON.stringify({
      targetDoctype: "Project",
      targetName: "Apollo/2026",
      applicableDoctypes: ["Task"],
      expectedVersion: 0
    }));
    expect(allowStdout.text()).toContain("Allowed user permission at https://app.example");
    expect(allowStdout.text()).toContain("Version: 3 Total: 1");

    const revokeCalls: RemoteCall[] = [];
    const revokeStdout = textBuffer();
    const revokeExit = await runCli(
      [
        "user-permissions",
        "revoke",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--target-doctype",
        "Project",
        "--target-name",
        "Apollo/2026",
        "--tenant",
        "default",
        "--expected-version",
        "3"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(revokeCalls, {
          data: {
            tenantId: "default",
            userId: "owner@example.com",
            version: 4,
            grants: []
          }
        }),
        stdout: revokeStdout,
        stderr: textBuffer()
      }
    );

    expect(revokeExit).toBe(0);
    expect(revokeCalls[0]?.url).toBe("https://app.example/api/user-permissions/owner%40example.com?tenant=default");
    expect(revokeCalls[0]?.method).toBe("DELETE");
    expect(revokeCalls[0]?.body).toBe(JSON.stringify({
      targetDoctype: "Project",
      targetName: "Apollo/2026",
      expectedVersion: 3
    }));
    expect(revokeStdout.text()).toContain("Revoked user permission at https://app.example");
    expect(revokeStdout.text()).toContain("- (none)");
  });

  it("maps remote user-permission API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "user-permissions",
        "allow",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--target-doctype",
        "Project",
        "--target-name",
        "Missing"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "VALIDATION_FAILED", message: "Target document not found" }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote user permissions request failed (400): VALIDATION_FAILED: Target document not found"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "user-permissions",
        "list",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
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
