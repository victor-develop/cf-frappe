import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote notification rules", () => {
  it("parses remote notification-rule operator commands", () => {
    expect(parseCliArgs([
      "notification-rules",
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
      kind: "notification-rules",
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
      "notification-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers on updates",
      "--event",
      "DocumentUpdated",
      "--event",
      "DocumentCommentAdded",
      "--recipient-user",
      "manager@example.com",
      "--recipient-field",
      "owner",
      "--recipient-owner",
      "--channel",
      "email",
      "--channel",
      "inbox",
      "--subject",
      "{{ doctype }} {{ name }} changed",
      "--disabled",
      "--include-actor",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "notification-rules",
      action: "save",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      ruleName: "Managers on updates",
      events: ["DocumentUpdated", "DocumentCommentAdded"],
      recipients: [
        { kind: "user", userId: "manager@example.com" },
        { kind: "field", field: "owner" },
        { kind: "documentOwner" }
      ],
      channels: ["email", "inbox"],
      subject: "{{ doctype }} {{ name }} changed",
      enabled: false,
      excludeActor: false,
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "notification-rules",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers on updates",
      "--tenant",
      "acme/east"
    ])).toEqual({
      kind: "notification-rules",
      action: "get",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      tenant: "acme/east",
      ruleName: "Managers on updates"
    });

    expect(parseCliArgs([
      "notification-rules",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers on updates",
      "--tenant",
      "acme/east",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "notification-rules",
      action: "disable",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      tenant: "acme/east",
      ruleName: "Managers on updates",
      expectedVersion: 2
    });

    expect(parseCliArgs([
      "notification-rules",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers on updates",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "notification-rules",
      action: "clear",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      ruleName: "Managers on updates",
      expectedVersion: 3
    });
  });

  it("rejects invalid remote notification-rule options before fetching", () => {
    expect(parseCliArgs(["notification-rules", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown notification-rules command 'unknown'"
    });
    expect(parseCliArgs(["notification-rules", "list", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["notification-rules", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Notification rule list requires --doctype"
    });
    expect(parseCliArgs([
      "notification-rules",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --rule with notification-rules list"
    });
    expect(parseCliArgs([
      "notification-rules",
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
      message: "Cannot use --expected-version with notification-rules get"
    });
    expect(parseCliArgs([
      "notification-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--event",
      "DocumentUpdated",
      "--recipient-user",
      "manager@example.com"
    ])).toEqual({
      kind: "invalid",
      message: "Notification rule save requires --rule"
    });
    expect(parseCliArgs([
      "notification-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--recipient-user",
      "manager@example.com"
    ])).toEqual({
      kind: "invalid",
      message: "Notification rule save requires at least one --event"
    });
    expect(parseCliArgs([
      "notification-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentUpdated"
    ])).toEqual({
      kind: "invalid",
      message: "Notification rule save requires at least one --recipient-user, --recipient-field, or --recipient-owner"
    });
    expect(parseCliArgs([
      "notification-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentUpdated",
      "--recipient-user",
      "manager@example.com",
      "--enabled",
      "--disabled"
    ])).toEqual({
      kind: "invalid",
      message: "Notification rule save cannot use both --enabled and --disabled"
    });
    expect(parseCliArgs([
      "notification-rules",
      "enable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--event",
      "DocumentUpdated"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --event with notification-rules enable"
    });
    expect(parseCliArgs([
      "notification-rules",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Notification rule disable requires --rule"
    });
    expect(parseCliArgs([
      "notification-rules",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentUpdated"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --event with notification-rules clear"
    });
    expect(parseCliArgs([
      "notification-rules",
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
      message: "Notification rule expected version must be a non-negative integer"
    });
    expect(parseCliArgs([
      "notification-rules",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--rule",
      "Managers",
      "--event",
      "DocumentUpdated",
      "--recipient-user",
      "manager@example.com",
      "--channel",
      "sms"
    ])).toEqual({
      kind: "invalid",
      message: "Notification rule channel 'sms' is not supported"
    });
  });

  it("lists remote notification rules through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "notification-rules",
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
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                rule: {
                  name: "Managers on updates",
                  events: ["DocumentUpdated"],
                  recipients: [{ kind: "user", userId: "manager@example.com" }],
                  subject: "Invoice changed"
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
    expect(calls[0]?.url).toBe("https://app.example/cf/api/notification-rules/Sales%20Invoice?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Notification rules at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 2 Total: 1");
    expect(stdout.text()).toContain("- Managers on updates enabled channels inbox events DocumentUpdated recipients user:manager@example.com subject \"Invoice changed\"");
    expect(stdout.text()).toContain("{\"name\":\"Managers on updates\"");
  });

  it("gets one remote notification rule through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "notification-rules",
        "get",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Sales Invoice",
        "--rule",
        "Managers/Updates",
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
                enabled: true,
                rule: {
                  name: "Owners",
                  events: ["DocumentCreated"],
                  recipients: [{ kind: "documentOwner" }]
                }
              },
              {
                enabled: false,
                rule: {
                  name: "Managers/Updates",
                  events: ["DocumentUpdated"],
                  recipients: [{ kind: "user", userId: "manager@example.com" }],
                  channels: ["email"]
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
    expect(calls[0]?.url).toBe("https://app.example/cf/api/notification-rules/Sales%20Invoice?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(stdout.text()).toContain("Notification rule at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 4 Total: 1");
    expect(stdout.text()).toContain("- Managers/Updates disabled channels email events DocumentUpdated recipients user:manager@example.com");
    expect(stdout.text()).toContain("{\"name\":\"Managers/Updates\"");
    expect(stdout.text()).not.toContain("Owners");
  });

  it("saves and clears remote notification rules through the generated admin API", async () => {
    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "notification-rules",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Managers/Updates",
        "--event",
        "DocumentUpdated",
        "--recipient-user",
        "manager@example.com",
        "--recipient-field",
        "owner",
        "--recipient-owner",
        "--channel",
        "email",
        "--subject",
        "{{ name }} changed",
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
                  name: "Managers/Updates",
                  events: ["DocumentUpdated"],
                  recipients: [
                    { kind: "user", userId: "manager@example.com" },
                    { kind: "field", field: "owner" },
                    { kind: "documentOwner" }
                  ],
                  channels: ["email"],
                  subject: "{{ name }} changed",
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
    expect(saveCalls[0]?.url).toBe("https://app.example/api/notification-rules/Task/Managers%2FUpdates");
    expect(saveCalls[0]?.method).toBe("PUT");
    expect(saveCalls[0]?.body).toBe(JSON.stringify({
      rule: {
        events: ["DocumentUpdated"],
        recipients: [
          { kind: "user", userId: "manager@example.com" },
          { kind: "field", field: "owner" },
          { kind: "documentOwner" }
        ],
        channels: ["email"],
        enabled: true,
        subject: "{{ name }} changed",
        excludeActor: true
      },
      expectedVersion: 0
    }));
    expect(saveStdout.text()).toContain("Saved notification rule at https://app.example");
    expect(saveStdout.text()).toContain("Version: 1 Total: 1");

    const clearCalls: RemoteCall[] = [];
    const clearStdout = textBuffer();
    const clearExit = await runCli(
      [
        "notification-rules",
        "clear",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Managers/Updates",
        "--tenant",
        "default",
        "--expected-version",
        "0"
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
    expect(clearCalls[0]?.url).toBe("https://app.example/api/notification-rules/Task/Managers%2FUpdates?tenant=default");
    expect(clearCalls[0]?.method).toBe("DELETE");
    expect(clearCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 0 }));
    expect(clearStdout.text()).toContain("Cleared notification rule at https://app.example");
    expect(clearStdout.text()).toContain("- (none)");
  });

  it("enables and disables remote notification rules by preserving the existing rule body", async () => {
    const enableCalls: RemoteCall[] = [];
    const enableStdout = textBuffer();
    const enableExit = await runCli(
      [
        "notification-rules",
        "enable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Managers/Updates",
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
                    name: "Managers/Updates",
                    enabled: false,
                    events: ["DocumentUpdated"],
                    recipients: [{ kind: "field", field: "owner" }],
                    channels: ["inbox"],
                    subject: "Task changed",
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
              rules: [{ enabled: true, rule: { name: "Managers/Updates", enabled: true } }]
            }
          }
        ]),
        stdout: enableStdout,
        stderr: textBuffer()
      }
    );

    expect(enableExit).toBe(0);
    expect(enableCalls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://app.example/api/notification-rules/Task?tenant=default",
      "PUT https://app.example/api/notification-rules/Task/Managers%2FUpdates?tenant=default"
    ]);
    expect(enableCalls[1]?.body).toBe(JSON.stringify({
      rule: {
        events: ["DocumentUpdated"],
        recipients: [{ kind: "field", field: "owner" }],
        channels: ["inbox"],
        enabled: true,
        subject: "Task changed",
        excludeActor: false
      },
      expectedVersion: 4
    }));
    expect(enableStdout.text()).toContain("Enabled notification rule at https://app.example");
    expect(enableStdout.text()).toContain("Version: 5 Total: 1");

    const disableCalls: RemoteCall[] = [];
    const disableExit = await runCli(
      [
        "notification-rules",
        "disable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Owner updates"
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
                    name: "Owner updates",
                    events: ["DocumentUpdated"],
                    recipients: [{ kind: "documentOwner" }]
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
              rules: [{ enabled: false, rule: { name: "Owner updates", enabled: false } }]
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
        recipients: [{ kind: "documentOwner" }],
        enabled: false
      },
      expectedVersion: 7
    }));
  });

  it("fails remote notification-rule toggles when the selected rule is absent", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exit = await runCli(
      [
        "notification-rules",
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
    expect(stderr.text()).toContain("Notification rule 'Missing' was not found in remote state");
  });

  it("fails remote notification-rule get when the selected rule is absent", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exit = await runCli(
      [
        "notification-rules",
        "get",
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
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://app.example/api/notification-rules/Task"
    ]);
    expect(stderr.text()).toContain("Notification rule 'Missing' was not found in remote state");
  });

  it("reports remote notification-rule toggle version conflicts before missing-rule errors", async () => {
    const calls: RemoteCall[] = [];
    const stderr = textBuffer();
    const exit = await runCli(
      [
        "notification-rules",
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
    expect(stderr.text()).toContain("Expected notification rules at version 1, found 2");
    expect(stderr.text()).not.toContain("was not found");
  });

  it("maps remote notification-rule API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "notification-rules",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--rule",
        "Bad field",
        "--event",
        "DocumentUpdated",
        "--recipient-field",
        "count"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "NOTIFICATION_RULE_INVALID", message: "Notification rule recipient field 'count' must store user ids" }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote notification rules request failed (400): NOTIFICATION_RULE_INVALID: Notification rule recipient field 'count' must store user ids"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "notification-rules",
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
