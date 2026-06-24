import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote jobs", () => {
  it("parses job history and schedule operator commands", () => {
    expect(parseCliArgs([
      "jobs",
      "list",
      "--url",
      "https://app.example",
      "--job",
      "reports.daily",
      "--run-id",
      "job_001",
      "--status",
      "succeeded",
      "--limit",
      "5",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "jobs",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      jobName: "reports.daily",
      runId: "job_001",
      status: "succeeded",
      limit: 5
    });

    expect(parseCliArgs([
      "jobs",
      "schedule-save",
      "--url",
      "https://app.example",
      "--id",
      "runtime-daily",
      "--cron",
      "15 4 * * *",
      "--job",
      "reports.daily",
      "--disabled",
      "--payload-json",
      "{\"scope\":\"runtime\"}",
      "--metadata-json",
      "{\"source\":\"cli\"}",
      "--idempotency-key",
      "reports.daily:runtime",
      "--delay-seconds",
      "30"
    ])).toEqual({
      kind: "jobs",
      action: "schedule-save",
      url: "https://app.example",
      headers: [],
      scheduleId: "runtime-daily",
      cron: "15 4 * * *",
      jobName: "reports.daily",
      scheduleEnabled: false,
      payload: { scope: "runtime" },
      metadata: { source: "cli" },
      scheduleIdempotencyKey: "reports.daily:runtime",
      delaySeconds: 30
    });

    expect(parseCliArgs(["jobs", "retry", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Job retry requires --idempotency-key"
    });
    expect(parseCliArgs(["jobs", "schedules", "--url", "https://app.example", "--limit", "5"])).toEqual({
      kind: "invalid",
      message: "Cannot use --limit with jobs schedules"
    });
    expect(parseCliArgs(["jobs", "schedule-save", "--url", "https://app.example", "--cron", "* * * * *"])).toEqual({
      kind: "invalid",
      message: "Job schedule save requires --job"
    });
    expect(parseCliArgs([
      "jobs",
      "schedule-save",
      "--url",
      "https://app.example",
      "--cron",
      "* * * * *",
      "--job",
      "reports.daily",
      "--payload-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Job schedule payload must be a valid JSON object"
    });
    expect(parseCliArgs([
      "jobs",
      "schedule-save",
      "--url",
      "https://app.example",
      "--cron",
      "* * * * *",
      "--job",
      "reports.daily",
      "--delay-seconds",
      "86401"
    ])).toEqual({
      kind: "invalid",
      message: "Job schedule delay must be an integer between 0 and 86400"
    });
  });

  it("lists remote job definitions and execution history through the admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "jobs",
        "list",
        "--url",
        "https://app.example/cf",
        "--job",
        "reports.daily",
        "--status",
        "succeeded",
        "--limit",
        "5",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            jobs: [{ name: "reports.daily", description: "Build reports", pool: "critical" }],
            executions: [
              {
                tenantId: "acme",
                idempotencyKey: "reports.daily:job_001",
                jobName: "reports.daily",
                runId: "job_001",
                status: "succeeded",
                finishedAt: "2026-01-01T00:01:00.000Z"
              }
            ],
            limit: 5
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/jobs?job=reports.daily&status=succeeded&limit=5");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Jobs at https://app.example/cf");
    expect(stdout.text()).toContain("- reports.daily [critical] - Build reports");
    expect(stdout.text()).toContain("- reports.daily:job_001 [succeeded] reports.daily/job_001 tenant acme");
  });

  it("gets and retries one remote job execution by idempotency key", async () => {
    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      ["jobs", "get", "--url", "https://app.example", "--idempotency-key", "reports.daily:job_001"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: {
            tenantId: "acme",
            idempotencyKey: "reports.daily:job_001",
            jobName: "reports.daily",
            runId: "job_001",
            status: "failed",
            error: "timeout"
          }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );

    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/jobs/executions/reports.daily%3Ajob_001");
    expect(getStdout.text()).toContain("- reports.daily:job_001 [failed] reports.daily/job_001 tenant acme error timeout");

    const retryCalls: RemoteCall[] = [];
    const retryStdout = textBuffer();
    const retryExit = await runCli(
      ["jobs", "retry", "--url", "https://app.example", "--idempotency-key", "reports.daily:job_001"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(retryCalls, {
          data: {
            message: {
              jobName: "reports.daily",
              runId: "job_retry-001",
              idempotencyKey: "reports.daily:job_001"
            }
          }
        }, 201),
        stdout: retryStdout,
        stderr: textBuffer()
      }
    );

    expect(retryExit).toBe(0);
    expect(retryCalls[0]?.url).toBe("https://app.example/api/jobs/executions/reports.daily%3Ajob_001/retry");
    expect(retryCalls[0]?.method).toBe("POST");
    expect(retryStdout.text()).toContain("Retried job execution at https://app.example");
    expect(retryStdout.text()).toContain("Message: reports.daily / job_retry-001 (reports.daily:job_001)");
  });

  it("lists and runs remote job schedules through the admin API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      ["jobs", "schedules", "--url", "https://app.example", "--job", "reports.daily", "--cron", "0 2 * * *"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(listCalls, {
          data: {
            schedules: [
              {
                id: "daily",
                cron: "0 2 * * *",
                jobName: "reports.daily",
                source: "configured",
                tenantId: "acme",
                enabled: true,
                registered: true,
                dispatchable: true
              }
            ]
          }
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe("https://app.example/api/jobs/schedules?job=reports.daily&cron=0+2+*+*+*");
    expect(listStdout.text()).toContain("Job schedules at https://app.example");
    expect(listStdout.text()).toContain("- daily [enabled] 0 2 * * * reports.daily source configured tenant acme");

    const runCalls: RemoteCall[] = [];
    const runStdout = textBuffer();
    const runExit = await runCli(["jobs", "schedule-run", "--url", "https://app.example", "--id", "daily"], {
      cwd: () => "/workspace",
      fetch: fakeFetch(runCalls, {
        data: {
          schedule: { id: "daily", cron: "0 2 * * *", jobName: "reports.daily", enabled: true },
          message: {
            jobName: "reports.daily",
            runId: "job_manual-001",
            idempotencyKey: "manual:daily"
          }
        }
      }, 201),
      stdout: runStdout,
      stderr: textBuffer()
    });

    expect(runExit).toBe(0);
    expect(runCalls[0]?.url).toBe("https://app.example/api/jobs/schedules/daily/run");
    expect(runCalls[0]?.method).toBe("POST");
    expect(runStdout.text()).toContain("Ran job schedule at https://app.example");
    expect(runStdout.text()).toContain("Message: reports.daily / job_manual-001 (manual:daily)");
  });

  it("saves, pauses, and deletes runtime job schedules through bounded JSON requests", async () => {
    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "jobs",
        "schedule-save",
        "--url",
        "https://app.example",
        "--id",
        "runtime-daily",
        "--cron",
        "15 4 * * *",
        "--job",
        "reports.daily",
        "--enabled",
        "--payload-json",
        "{\"scope\":\"runtime\"}",
        "--metadata-json",
        "{\"source\":\"cli\"}",
        "--idempotency-key",
        "reports.daily:runtime",
        "--delay-seconds",
        "30"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(saveCalls, {
          data: {
            schedule: {
              id: "runtime-daily",
              cron: "15 4 * * *",
              jobName: "reports.daily",
              source: "runtime",
              enabled: true,
              editable: true,
              delaySeconds: 30
            }
          }
        }),
        stdout: saveStdout,
        stderr: textBuffer()
      }
    );

    expect(saveExit).toBe(0);
    expect(saveCalls[0]?.url).toBe("https://app.example/api/jobs/schedules/runtime-daily");
    expect(saveCalls[0]?.method).toBe("PUT");
    expect(JSON.parse(saveCalls[0]?.body ?? "{}")).toEqual({
      cron: "15 4 * * *",
      jobName: "reports.daily",
      enabled: true,
      payload: { scope: "runtime" },
      metadata: { source: "cli" },
      idempotencyKey: "reports.daily:runtime",
      delaySeconds: 30
    });
    expect(saveStdout.text()).toContain("Saved job schedule at https://app.example");
    expect(saveStdout.text()).toContain("delay 30s");

    const createCalls: RemoteCall[] = [];
    const createExit = await runCli(
      [
        "jobs",
        "schedule-save",
        "--url",
        "https://app.example",
        "--cron",
        "45 6 * * *",
        "--job",
        "reports.daily",
        "--disabled"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(createCalls, {
          data: {
            schedule: {
              id: "generated-runtime",
              cron: "45 6 * * *",
              jobName: "reports.daily",
              source: "runtime",
              enabled: false
            }
          }
        }, 201),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );
    expect(createExit).toBe(0);
    expect(createCalls[0]?.url).toBe("https://app.example/api/jobs/schedules");
    expect(createCalls[0]?.method).toBe("POST");
    expect(JSON.parse(createCalls[0]?.body ?? "{}")).toEqual({
      cron: "45 6 * * *",
      jobName: "reports.daily",
      enabled: false
    });

    const pauseCalls: RemoteCall[] = [];
    const pauseExit = await runCli(
      [
        "jobs",
        "schedule-pause",
        "--url",
        "https://app.example",
        "--id",
        "runtime-daily",
        "--until",
        "2026-01-02T00:00:00.000Z"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(pauseCalls, {
          data: {
            schedule: {
              id: "runtime-daily",
              cron: "15 4 * * *",
              jobName: "reports.daily",
              enabled: false,
              pausedUntil: "2026-01-02T00:00:00.000Z"
            }
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );
    expect(pauseExit).toBe(0);
    expect(pauseCalls[0]?.url).toBe("https://app.example/api/jobs/schedules/runtime-daily/pause");
    expect(JSON.parse(pauseCalls[0]?.body ?? "{}")).toEqual({ pauseUntil: "2026-01-02T00:00:00.000Z" });

    const deleteCalls: RemoteCall[] = [];
    const deleteExit = await runCli(["jobs", "schedule-delete", "--url", "https://app.example", "--id", "runtime-daily"], {
      cwd: () => "/workspace",
      fetch: fakeFetch(deleteCalls, {
        data: {
          schedule: {
            id: "runtime-daily",
            cron: "15 4 * * *",
            jobName: "reports.daily",
            enabled: false,
            deleted: true
          }
        }
      }),
      stdout: textBuffer(),
      stderr: textBuffer()
    });
    expect(deleteExit).toBe(0);
    expect(deleteCalls[0]?.url).toBe("https://app.example/api/jobs/schedules/runtime-daily");
    expect(deleteCalls[0]?.method).toBe("DELETE");
  });

  it("enables, disables, and resets remote job schedule overrides", async () => {
    const actions = [
      { command: "schedule-enable", route: "enable", label: "Enabled job schedule", enabled: true },
      { command: "schedule-disable", route: "disable", label: "Disabled job schedule", enabled: false },
      { command: "schedule-reset", route: "reset", label: "Reset job schedule", enabled: true }
    ] as const;

    for (const action of actions) {
      const calls: RemoteCall[] = [];
      const stdout = textBuffer();
      const exitCode = await runCli(
        ["jobs", action.command, "--url", "https://app.example/cf", "--id", "daily"],
        {
          cwd: () => "/workspace",
          fetch: fakeFetch(calls, {
            data: {
              schedule: {
                id: "daily",
                cron: "0 2 * * *",
                jobName: "reports.daily",
                enabled: action.enabled,
                overridden: action.route !== "reset"
              }
            }
          }),
          stdout,
          stderr: textBuffer()
        }
      );

      expect(exitCode).toBe(0);
      expect(calls[0]?.url).toBe(`https://app.example/cf/api/jobs/schedules/daily/${action.route}`);
      expect(calls[0]?.method).toBe("POST");
      expect(stdout.text()).toContain(`${action.label} at https://app.example/cf`);
    }
  });

  it("maps remote job API errors and missing env headers to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      ["jobs", "schedule-run", "--url", "https://app.example", "--id", "missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: {
            code: "JOB_SCHEDULE_NOT_FOUND",
            message: "Job schedule 'missing' was not found"
          }
        }, 404),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote job request failed (404): JOB_SCHEDULE_NOT_FOUND: Job schedule 'missing' was not found"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      ["jobs", "list", "--url", "https://app.example", "--header-env", "Authorization=CF_FRAPPE_AUTH"],
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

  it("maps shared remote-admin transport and response validation errors", async () => {
    const invalidUrlStderr = textBuffer();
    const invalidUrlCalls: RemoteCall[] = [];
    const invalidUrlExit = await runCli(["jobs", "list", "--url", "not-a-url"], {
      cwd: () => "/workspace",
      fetch: fakeFetch(invalidUrlCalls, {}),
      stdout: textBuffer(),
      stderr: invalidUrlStderr
    });

    expect(invalidUrlExit).toBe(1);
    expect(invalidUrlStderr.text()).toContain("Remote job URL 'not-a-url' is not a valid absolute URL");
    expect(invalidUrlCalls).toEqual([]);

    const invalidJsonStderr = textBuffer();
    const invalidJsonExit = await runCli(["jobs", "list", "--url", "https://app.example"], {
      cwd: () => "/workspace",
      fetch: fakeTextFetch([], "not-json"),
      stdout: textBuffer(),
      stderr: invalidJsonStderr
    });

    expect(invalidJsonExit).toBe(1);
    expect(invalidJsonStderr.text()).toContain("Remote job response was not valid JSON (200)");

    const missingDataStderr = textBuffer();
    const missingDataExit = await runCli(["jobs", "list", "--url", "https://app.example"], {
      cwd: () => "/workspace",
      fetch: fakeFetch([], { data: [] }),
      stdout: textBuffer(),
      stderr: missingDataStderr
    });

    expect(missingDataExit).toBe(1);
    expect(missingDataStderr.text()).toContain("Remote job response did not include a data object");
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

function fakeTextFetch(calls: RemoteCall[], responseText: string, status = 200): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    return new Response(responseText, {
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
