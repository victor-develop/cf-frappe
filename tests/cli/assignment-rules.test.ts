import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote assignment rules", () => {
  it("parses remote assignment-rule operator commands", () => {
    expect(parseCliArgs([
      "assignment-rules",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--tenant",
      "acme/east",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "assignment-rules",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Task",
      tenant: "acme/east"
    });

    expect(parseCliArgs([
      "assignment-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "High priority triage",
      "--event",
      "DocumentCreated",
      "--event",
      "DocumentUpdated",
      "--assignee-user",
      "manager@example.com",
      "--assignee-field",
      "owner",
      "--condition-json",
      "{\"field\":\"priority\",\"value\":\"High\"}",
      "--disabled",
      "--include-actor",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "assignment-rules",
      action: "save",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      ruleName: "High priority triage",
      events: ["DocumentCreated", "DocumentUpdated"],
      assignees: [
        { kind: "user", userId: "manager@example.com" },
        { kind: "field", field: "owner" }
      ],
      condition: { field: "priority", value: "High" },
      enabled: false,
      excludeActor: false,
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "assignment-rules",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "High priority triage",
      "--tenant",
      "acme/east"
    ])).toEqual({
      kind: "assignment-rules",
      action: "get",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      tenant: "acme/east",
      ruleName: "High priority triage"
    });

    expect(parseCliArgs([
      "assignment-rules",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "High priority triage",
      "--tenant",
      "acme/east",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "assignment-rules",
      action: "disable",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      tenant: "acme/east",
      ruleName: "High priority triage",
      expectedVersion: 2
    });

    expect(parseCliArgs([
      "assignment-rules",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "High priority triage",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "assignment-rules",
      action: "clear",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      ruleName: "High priority triage",
      expectedVersion: 3
    });
  });

  it("rejects invalid remote assignment-rule options before fetching", () => {
    expect(parseCliArgs(["assignment-rules", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown assignment-rules command 'unknown'"
    });
    expect(parseCliArgs(["assignment-rules", "list", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["assignment-rules", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Assignment rule list requires --doctype"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --rule with assignment-rules list"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--expected-version",
      "1"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --expected-version with assignment-rules get"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--assignee-user",
      "manager@example.com"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule save requires at least one --event"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentCreated"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule save requires at least one --assignee-user or --assignee-field"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentCreated",
      "--assignee-user",
      "manager@example.com",
      "--enabled",
      "--disabled"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule save cannot use both --enabled and --disabled"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentCreated",
      "--assignee-user",
      "manager@example.com",
      "--exclude-actor",
      "--include-actor"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule save cannot use both --exclude-actor and --include-actor"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "enable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--assignee-user",
      "manager@example.com"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --assignee-user with assignment-rules enable"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "enable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule enable requires --rule"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentCreated"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --event with assignment-rules clear"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentCreated",
      "--assignee-user",
      "manager@example.com",
      "--condition-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule condition must be a valid JSON object"
    });
    expect(parseCliArgs([
      "assignment-rules",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Assignment rule expected version must be a non-negative integer"
    });
  });

  it("lists remote assignment rules through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "assignment-rules",
        "list",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Sales Invoice",
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
            doctypeName: "Sales Invoice",
            version: 2,
            rules: [
              {
                enabled: true,
                rule: {
                  name: "High priority triage",
                  events: ["DocumentCreated"],
                  assignees: [{ kind: "user", userId: "manager@example.com" }]
                }
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/assignment-rules/Sales%20Invoice?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Assignment rules at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 2 Total: 1");
    expect(stdout.text()).toContain("- High priority triage enabled events DocumentCreated assignees user:manager@example.com");
  });

  it("gets one remote assignment rule through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "assignment-rules",
        "get",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Sales Invoice",
        "--rule",
        "High/Triage",
        "--tenant",
        "acme/east"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            doctypeName: "Sales Invoice",
            version: 4,
            rules: [
              {
                enabled: false,
                rule: {
                  name: "High/Triage",
                  events: ["DocumentUpdated"],
                  assignees: [{ kind: "user", userId: "manager@example.com" }],
                  condition: { field: "priority", value: "High" }
                }
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe(
      "https://app.example/cf/api/assignment-rules/Sales%20Invoice/High%2FTriage?tenant=acme%2Feast"
    );
    expect(calls[0]?.method).toBe("GET");
    expect(stdout.text()).toContain("Assignment rule at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 4 Total: 1");
    expect(stdout.text()).toContain(
      "- High/Triage disabled events DocumentUpdated assignees user:manager@example.com"
    );
    expect(stdout.text()).toContain("{\"name\":\"High/Triage\"");
  });

  it("saves and clears remote assignment rules through the generated admin API", async () => {
    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "assignment-rules",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "High/Triage",
        "--event",
        "DocumentCreated",
        "--assignee-user",
        "manager@example.com",
        "--assignee-field",
        "owner",
        "--condition-json",
        "{\"field\":\"priority\",\"operator\":\"in\",\"value\":[\"High\",\"Urgent\"]}",
        "--enabled",
        "--exclude-actor",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(saveCalls, {
          data: {
            tenantId: "default",
            doctypeName: "Task",
            version: 1,
            rules: [
              {
                enabled: true,
                rule: {
                  name: "High/Triage",
                  events: ["DocumentCreated"],
                  assignees: [
                    { kind: "user", userId: "manager@example.com" },
                    { kind: "field", field: "owner" }
                  ],
                  condition: { field: "priority", operator: "in", value: ["High", "Urgent"] },
                  excludeActor: true
                }
              }
            ]
          }
        }),
        stdout: saveStdout,
        stderr: textBuffer()
      }
    );

    expect(saveExit).toBe(0);
    expect(saveCalls[0]?.url).toBe("https://app.example/api/assignment-rules/Task/High%2FTriage");
    expect(saveCalls[0]?.method).toBe("PUT");
    expect(saveCalls[0]?.body).toBe(JSON.stringify({
      rule: {
        events: ["DocumentCreated"],
        assignees: [
          { kind: "user", userId: "manager@example.com" },
          { kind: "field", field: "owner" }
        ],
        condition: { field: "priority", operator: "in", value: ["High", "Urgent"] },
        enabled: true,
        excludeActor: true
      },
      expectedVersion: 0
    }));
    expect(saveStdout.text()).toContain("Saved assignment rule at https://app.example");
    expect(saveStdout.text()).toContain("Version: 1 Total: 1");

    const clearCalls: RemoteCall[] = [];
    const clearStdout = textBuffer();
    const clearExit = await runCli(
      [
        "assignment-rules",
        "clear",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "High/Triage",
        "--tenant",
        "default",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(clearCalls, {
          data: {
            tenantId: "default",
            doctypeName: "Task",
            version: 2,
            rules: []
          }
        }),
        stdout: clearStdout,
        stderr: textBuffer()
      }
    );

    expect(clearExit).toBe(0);
    expect(clearCalls[0]?.url).toBe("https://app.example/api/assignment-rules/Task/High%2FTriage?tenant=default");
    expect(clearCalls[0]?.method).toBe("DELETE");
    expect(clearCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 1 }));
    expect(clearStdout.text()).toContain("Cleared assignment rule at https://app.example");
    expect(clearStdout.text()).toContain("- (none)");
  });

  it("enables and disables remote assignment rules by preserving the existing rule body", async () => {
    const enableCalls: RemoteCall[] = [];
    const enableStdout = textBuffer();
    const enableExit = await runCli(
      [
        "assignment-rules",
        "enable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "High/Triage",
        "--tenant",
        "default",
        "--expected-version",
        "4"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeSequenceFetch(enableCalls, [
          {
            data: {
              tenantId: "default",
              doctypeName: "Task",
              version: 4,
              rules: [
                {
                  enabled: false,
                  rule: {
                    name: "High/Triage",
                    enabled: false,
                    events: ["DocumentCreated"],
                    assignees: [{ kind: "field", field: "owner" }],
                    condition: { field: "priority", value: "High" },
                    excludeActor: false
                  }
                }
              ]
            }
          },
          {
            data: {
              tenantId: "default",
              doctypeName: "Task",
              version: 5,
              rules: [{ enabled: true, rule: { name: "High/Triage", enabled: true } }]
            }
          }
        ]),
        stdout: enableStdout,
        stderr: textBuffer()
      }
    );

    expect(enableExit).toBe(0);
    expect(enableCalls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://app.example/api/assignment-rules/Task?tenant=default",
      "PUT https://app.example/api/assignment-rules/Task/High%2FTriage?tenant=default"
    ]);
    expect(enableCalls[1]?.body).toBe(JSON.stringify({
      rule: {
        events: ["DocumentCreated"],
        assignees: [{ kind: "field", field: "owner" }],
        condition: { field: "priority", value: "High" },
        enabled: true,
        excludeActor: false
      },
      expectedVersion: 4
    }));
    expect(enableStdout.text()).toContain("Enabled assignment rule at https://app.example");
    expect(enableStdout.text()).toContain("Version: 5 Total: 1");

    const disableCalls: RemoteCall[] = [];
    const disableExit = await runCli(
      [
        "assignment-rules",
        "disable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Owner triage"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeSequenceFetch(disableCalls, [
          {
            data: {
              tenantId: "default",
              doctypeName: "Task",
              version: 7,
              rules: [
                {
                  enabled: true,
                  rule: {
                    name: "Owner triage",
                    events: ["DocumentUpdated"],
                    assignees: [{ kind: "field", field: "owner" }],
                    condition: { field: "system.docstatus", value: "draft" }
                  }
                }
              ]
            }
          },
          {
            data: {
              tenantId: "default",
              doctypeName: "Task",
              version: 8,
              rules: [{ enabled: false, rule: { name: "Owner triage", enabled: false } }]
            }
          }
        ]),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(disableExit).toBe(0);
    expect(disableCalls[1]?.body).toBe(JSON.stringify({
      rule: {
        events: ["DocumentUpdated"],
        assignees: [{ kind: "field", field: "owner" }],
        condition: { field: "system.docstatus", value: "draft" },
        enabled: false
      },
      expectedVersion: 7
    }));
  });

  it("fails remote assignment-rule toggles when the selected rule is absent", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exit = await runCli(
      [
        "assignment-rules",
        "enable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Missing"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "default",
            doctypeName: "Task",
            version: 3,
            rules: []
          }
        }),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exit).toBe(1);
    expect(calls).toHaveLength(1);
    expect(stderr.text()).toContain("Assignment rule 'Missing' was not found in remote state");
  });

  it("reports remote assignment-rule toggle version conflicts before missing-rule errors", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exit = await runCli(
      [
        "assignment-rules",
        "enable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Missing",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "default",
            doctypeName: "Task",
            version: 2,
            rules: []
          }
        }),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exit).toBe(1);
    expect(calls).toHaveLength(1);
    expect(stderr.text()).toContain("Expected assignment rules at version 1, found 2");
    expect(stderr.text()).not.toContain("was not found");
  });

  it("maps remote assignment-rule API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "assignment-rules",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Bad field",
        "--event",
        "DocumentUpdated",
        "--assignee-field",
        "count"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: {
            code: "ASSIGNMENT_RULE_INVALID",
            message: "Assignment rule assignee field 'count' must store user ids"
          }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote assignment rules request failed (400): ASSIGNMENT_RULE_INVALID: Assignment rule assignee field 'count' must store user ids"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "assignment-rules",
        "list",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
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

function fakeSequenceFetch(calls: RemoteCall[], responses: readonly unknown[]): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    const body = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {};
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: 200
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
