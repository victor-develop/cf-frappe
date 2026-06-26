import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote profiles", () => {
  it("parses remote user profile operator commands", () => {
    expect(parseCliArgs([
      "profiles",
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
      kind: "profiles",
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
      "profiles",
      "update",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--profile-json",
      '{"fullName":"Ada Lovelace","deskTheme":null}',
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "profiles",
      action: "update",
      url: "https://app.example",
      headers: [],
      userId: "owner@example.com",
      profile: { fullName: "Ada Lovelace", deskTheme: null },
      expectedVersion: 2
    });
  });

  it("rejects invalid remote profile options before fetching", () => {
    expect(parseCliArgs(["profiles", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown profiles command 'unknown'"
    });
    expect(parseCliArgs(["profiles", "get", "--user-id", "owner@example.com"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["profiles", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Profile get requires --user-id"
    });
    expect(parseCliArgs([
      "profiles",
      "update",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com"
    ])).toEqual({
      kind: "invalid",
      message: "Profile update requires --profile-json"
    });
    expect(parseCliArgs([
      "profiles",
      "get",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--profile-json",
      "{}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --profile-json with profiles get"
    });
    expect(parseCliArgs([
      "profiles",
      "update",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--profile-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Profile update must be a valid JSON object"
    });
    expect(parseCliArgs([
      "profiles",
      "update",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--profile-json",
      '{"expectedVersion":2}'
    ])).toEqual({
      kind: "invalid",
      message: "Profile update --profile-json cannot include expectedVersion; use --expected-version"
    });
    expect(parseCliArgs([
      "profiles",
      "update",
      "--url",
      "https://app.example",
      "--user-id",
      "owner@example.com",
      "--profile-json",
      "{}",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Profile expected version must be a non-negative integer"
    });
  });

  it("gets remote user profiles through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "profiles",
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
            profile: {
              fullName: "Ada Lovelace",
              deskTheme: "dark",
              language: "en"
            },
            updatedAt: "2026-06-26T12:00:00.000Z"
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/users/owner%40example.com/profile?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("User profile at https://app.example/cf");
    expect(stdout.text()).toContain("User: owner@example.com Tenant: acme/east Version: 2");
    expect(stdout.text()).toContain("Updated: 2026-06-26T12:00:00.000Z");
    expect(stdout.text()).toContain("- deskTheme: dark");
    expect(stdout.text()).toContain("- fullName: Ada Lovelace");
    expect(stdout.text()).toContain("- language: en");
  });

  it("updates remote user profiles through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "profiles",
        "update",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--tenant",
        "acme/east",
        "--profile-json",
        '{"fullName":"Ada Lovelace","deskTheme":null,"bio":"Analytical engine notes"}',
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            userId: "owner@example.com",
            version: 3,
            profile: {
              fullName: "Ada Lovelace",
              bio: "Analytical engine notes"
            }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/users/owner%40example.com/profile?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toBe(JSON.stringify({
      fullName: "Ada Lovelace",
      deskTheme: null,
      bio: "Analytical engine notes",
      expectedVersion: 2
    }));
    expect(stdout.text()).toContain("Updated user profile at https://app.example");
    expect(stdout.text()).toContain("Version: 3");
    expect(stdout.text()).toContain("- bio: Analytical engine notes");
  });

  it("maps remote profile API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli(
      [
        "profiles",
        "update",
        "--url",
        "https://app.example",
        "--user-id",
        "owner@example.com",
        "--profile-json",
        '{"unknown":"field"}'
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "BAD_REQUEST", message: "Unknown user profile field 'unknown'" }
        }, 400),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain(
      "Remote profiles request failed (400): BAD_REQUEST: Unknown user profile field 'unknown'"
    );
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
