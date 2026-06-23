import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote data patches", () => {
  it("parses remote data patch commands", () => {
    expect(parseCliArgs([
      "data-patches",
      "apply",
      "--url",
      "https://app.example",
      "--id",
      "core.seed",
      "--id",
      "crm.backfill",
      "--limit",
      "2",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "data-patches",
      action: "apply",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      patchIds: ["core.seed", "crm.backfill"],
      limit: 2
    });

    expect(parseCliArgs(["data-patches", "enqueue", "--url", "https://app.example", "--delay-seconds", "-1"])).toEqual({
      kind: "invalid",
      message: "Data patch enqueue delay must be a non-negative integer"
    });
    expect(parseCliArgs(["data-patches", "status"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
  });

  it("lists remote data patch status through the admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "data-patches",
        "status",
        "--url",
        "https://app.example/cf",
        "--header",
        "x-cf-frappe-user: admin@example.com",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            totals: { total: 2, notApplied: 1, pending: 0, applied: 1, failed: 0 },
            patches: [
              { id: "core.seed", checksum: "v1", status: "applied", appliedAt: "2026-01-01T00:00:00Z" },
              { id: "crm.backfill", label: "CRM Backfill", checksum: "v2", status: "not_applied" }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/data-patches");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(calls[0]?.headers.get("x-cf-frappe-user")).toBe("admin@example.com");
    expect(stdout.text()).toContain("Data patches at https://app.example/cf");
    expect(stdout.text()).toContain("total 2, not applied 1, pending 0, applied 1, failed 0");
    expect(stdout.text()).toContain("- core.seed [applied] checksum v1");
    expect(stdout.text()).toContain("- crm.backfill [not_applied] checksum v2 - CRM Backfill");
  });

  it("applies selected remote data patches with bounded JSON options", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      ["data-patches", "apply", "--url", "https://app.example", "--id", "core.seed", "--id", "crm.backfill", "--limit", "2"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            applied: [{ id: "core.seed", checksum: "v1", appliedAt: "2026-01-01T00:00:00Z" }],
            skipped: [{ id: "crm.backfill", checksum: "v1", appliedAt: "2026-01-01T00:00:00Z" }]
          }
        }, 201),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://app.example/api/data-patches/apply");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      patchIds: ["core.seed", "crm.backfill"],
      limit: 2
    });
    expect(stdout.text()).toContain("Applied data patches at https://app.example");
    expect(stdout.text()).toContain("Applied:");
    expect(stdout.text()).toContain("- core.seed (v1)");
    expect(stdout.text()).toContain("Skipped:");
    expect(stdout.text()).toContain("- crm.backfill (v1)");
  });

  it("enqueues remote data patch jobs without running patches inline", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "data-patches",
        "enqueue",
        "--url",
        "https://app.example",
        "--id",
        "core.seed",
        "--idempotency-key",
        "patches:seed",
        "--delay-seconds",
        "15"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            plan: { patchIds: ["core.seed"], requestedPatchIds: ["core.seed"] },
            message: {
              runId: "job_patch-001",
              jobName: "cf-frappe.data-patches.apply",
              idempotencyKey: "patches:seed"
            }
          }
        }, 202),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/data-patches/enqueue");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      patchIds: ["core.seed"],
      idempotencyKey: "patches:seed",
      delaySeconds: 15
    });
    expect(stdout.text()).toContain("Enqueued data patch job at https://app.example");
    expect(stdout.text()).toContain("Plan: core.seed");
    expect(stdout.text()).toContain("Job: cf-frappe.data-patches.apply / job_patch-001");
    expect(stdout.text()).toContain("Idempotency key: patches:seed");
  });

  it("maps remote data patch API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli(["data-patches", "apply", "--url", "https://app.example", "--id", "crm.backfill"], {
      cwd: () => "/workspace",
      fetch: fakeFetch([], {
        error: {
          code: "DATA_PATCH_ORDER_VIOLATION",
          message: "Data patch 'crm.backfill' cannot run before earlier patch 'core.seed' is applied"
        }
      }, 409),
      stdout: textBuffer(),
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain(
      "Remote data patch request failed (409): DATA_PATCH_ORDER_VIOLATION: Data patch 'crm.backfill' cannot run before earlier patch 'core.seed' is applied"
    );
  });

  it("requires environment-backed header values before making remote calls", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exitCode = await runCli(
      ["data-patches", "status", "--url", "https://app.example", "--header-env", "Authorization=CF_FRAPPE_AUTH"],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch(calls, {}),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
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
