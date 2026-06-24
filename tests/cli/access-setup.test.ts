import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe Cloudflare Access setup CLI", () => {
  it("parses Cloudflare Access setup plans as typed commands", () => {
    expect(parseCliArgs([
      "access",
      "plan",
      "--account-id",
      "acct_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com",
      "--email-domain",
      "example.com",
      "--group",
      "grp_123",
      "--allowed-idp",
      "idp_123",
      "--session-duration",
      "8h"
    ])).toEqual({
      kind: "access-setup",
      action: "plan",
      scope: { kind: "account", id: "acct_123" },
      teamDomain: "team.cloudflareaccess.com",
      name: "Demo Admin",
      domain: "admin.example.com",
      policyName: "Demo Admin allow",
      includes: [
        { kind: "email-domain", domain: "example.com" },
        { kind: "group", id: "grp_123" }
      ],
      allowedIdps: ["idp_123"],
      sessionDuration: "8h"
    });
  });

  it("prints reviewable Cloudflare Access application and policy plans", async () => {
    const stdout = textBuffer();
    const exitCode = await runCli([
      "access",
      "plan",
      "--zone-id",
      "zone_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com",
      "--policy-name",
      "Demo allow employees",
      "--email",
      "owner@example.com",
      "--everyone"
    ], {
      cwd: () => "/workspace",
      stdout,
      stderr: textBuffer()
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain("Cloudflare Access setup plan");
    expect(stdout.text()).toContain("Scope: zone zone_123");
    expect(stdout.text()).toContain("Create Access application: POST /zones/zone_123/access/apps");
    expect(stdout.text()).toContain('"type": "self_hosted"');
    expect(stdout.text()).toContain('"app_launcher_visible": false');
    expect(stdout.text()).toContain("Create application policy: POST /zones/zone_123/access/apps/<created-access-application-id>/policies");
    expect(stdout.text()).toContain('"decision": "allow"');
    expect(stdout.text()).toContain('"email": "owner@example.com"');
    expect(stdout.text()).toContain('"everyone": {}');
    expect(stdout.text()).toContain("CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com");
    expect(stdout.text()).toContain("CF_ACCESS_AUD=<created-access-application-aud>");
  });

  it("creates Cloudflare Access resources with an environment-backed API token", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli([
      "access",
      "apply",
      "--account-id",
      "acct_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com",
      "--email-domain",
      "example.com",
      "--allowed-idp",
      "idp_123",
      "--api-token-env",
      "CF_API_TOKEN",
      "--api-base-url",
      "https://api.test/client/v4"
    ], {
      cwd: () => "/workspace",
      env: (name) => name === "CF_API_TOKEN" ? "secret-token" : undefined,
      fetch: accessSetupFetch(calls),
      stdout,
      stderr: textBuffer()
    });

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: "https://api.test/client/v4/accounts/acct_123/access/apps",
      method: "POST"
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      name: "Demo Admin",
      domain: "admin.example.com",
      type: "self_hosted",
      app_launcher_visible: false,
      allowed_idps: ["idp_123"]
    });
    expect(calls[1]).toMatchObject({
      url: "https://api.test/client/v4/accounts/acct_123/access/apps/app_123/policies",
      method: "POST"
    });
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      name: "Demo Admin allow",
      decision: "allow",
      include: [{ email_domain: { domain: "example.com" } }]
    });
    expect(stdout.text()).toContain("Created Cloudflare Access resources");
    expect(stdout.text()).toContain("Application: app_123");
    expect(stdout.text()).toContain("Policy: policy_123");
    expect(stdout.text()).toContain("CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com");
    expect(stdout.text()).toContain("CF_ACCESS_AUD=aud_123");
  });

  it("requires an environment-backed token before making Access apply calls", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exitCode = await runCli([
      "access",
      "apply",
      "--account-id",
      "acct_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com",
      "--email-domain",
      "example.com",
      "--api-token-env",
      "CF_API_TOKEN"
    ], {
      cwd: () => "/workspace",
      env: () => undefined,
      fetch: accessSetupFetch(calls),
      stdout: textBuffer(),
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("Environment variable 'CF_API_TOKEN' is not set for Cloudflare API token");
    expect(calls).toEqual([]);
  });

  it("validates Access setup command shape before planning", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli([
      "access",
      "plan",
      "--account-id",
      "acct_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com"
    ], {
      cwd: () => "/workspace",
      stdout: textBuffer(),
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("Cloudflare Access setup requires at least one policy include selector");
  });

  it("rejects missing Access option values instead of treating the next flag as data", async () => {
    const parsed = parseCliArgs([
      "access",
      "plan",
      "--account-id",
      "acct_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com",
      "--email",
      "--everyone"
    ]);

    expect(parsed).toEqual({
      kind: "invalid",
      message: "Missing value for --email"
    });
  });

  it("maps Cloudflare Access API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli([
      "access",
      "apply",
      "--account-id",
      "acct_123",
      "--team-domain",
      "team.cloudflareaccess.com",
      "--name",
      "Demo Admin",
      "--domain",
      "admin.example.com",
      "--email-domain",
      "example.com",
      "--api-token-env",
      "CF_API_TOKEN"
    ], {
      cwd: () => "/workspace",
      env: () => "secret-token",
      fetch: async () => new Response(JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: "Authentication error" }]
      }), { status: 403 }),
      stdout: textBuffer(),
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain(
      "Cloudflare Access setup request failed (403): 10000: Authentication error"
    );
  });
});

interface RemoteCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

function accessSetupFetch(calls: RemoteCall[]): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    const url = String(input);
    if (url.endsWith("/access/apps")) {
      return jsonResponse({ result: { id: "app_123", aud: "aud_123" } }, 201);
    }
    return jsonResponse({ result: { id: "policy_123" } }, 201);
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ success: true, ...body }), {
    headers: { "content-type": "application/json" },
    status
  });
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
