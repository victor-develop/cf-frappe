import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote custom fields", () => {
  it("parses remote custom-field operator commands", () => {
    expect(parseCliArgs([
      "custom-fields",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Sales Invoice",
      "--tenant",
      "acme/east",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "custom-fields",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Sales Invoice",
      tenant: "acme/east"
    });

    expect(parseCliArgs([
      "custom-fields",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field-json",
      "{\"name\":\"reviewer\",\"type\":\"link\",\"label\":\"Reviewer\",\"linkTo\":\"User\",\"inFormView\":true}",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "custom-fields",
      action: "save",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      field: {
        name: "reviewer",
        type: "link",
        label: "Reviewer",
        linkTo: "User",
        inFormView: true
      },
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "custom-fields",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "reviewer",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "custom-fields",
      action: "disable",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      fieldName: "reviewer",
      expectedVersion: 2
    });
  });

  it("rejects invalid remote custom-field options before fetching", () => {
    expect(parseCliArgs(["custom-fields", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown custom-fields command 'unknown'"
    });
    expect(parseCliArgs(["custom-fields", "list", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["custom-fields", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Custom field list requires --doctype"
    });
    expect(parseCliArgs([
      "custom-fields",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "reviewer"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --field with custom-fields list"
    });
    expect(parseCliArgs([
      "custom-fields",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Custom field save requires --field-json"
    });
    expect(parseCliArgs([
      "custom-fields",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Custom field must be a valid JSON object"
    });
    expect(parseCliArgs([
      "custom-fields",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Custom field disable requires --field"
    });
    expect(parseCliArgs([
      "custom-fields",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "reviewer",
      "--field-json",
      "{\"name\":\"reviewer\",\"type\":\"text\"}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --field-json with custom-fields disable"
    });
    expect(parseCliArgs([
      "custom-fields",
      "disable",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "reviewer",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Custom field expected version must be a non-negative integer"
    });
  });

  it("lists remote custom fields through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "custom-fields",
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
            doctype: "Sales Invoice",
            version: 2,
            fields: [
              {
                enabled: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                field: {
                  name: "reviewer",
                  label: "Reviewer",
                  description: "Person responsible for review.",
                  type: "link",
                  linkTo: "User",
                  unique: true,
                  inFormView: true
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
    expect(calls[0]?.url).toBe("https://app.example/cf/api/custom-fields/Sales%20Invoice?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Custom fields at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 2 Total: 1");
    expect(stdout.text()).toContain('- reviewer enabled type link label "Reviewer" help "Person responsible for review." target User [unique,form]');
    expect(stdout.text()).toContain("{\"name\":\"reviewer\"");
  });

  it("saves and disables remote custom fields through the generated admin API", async () => {
    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "custom-fields",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field-json",
        "{\"name\":\"reviewer\",\"type\":\"link\",\"label\":\"Reviewer\",\"description\":\"Person responsible for review.\",\"linkTo\":\"User\",\"unique\":true,\"inFormView\":true,\"defaultValue\":\"owner@example.com\"}",
        "--tenant",
        "acme/east",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(saveCalls, {
          data: {
            tenantId: "default",
            doctype: "Task",
            version: 1,
            fields: [
              {
                enabled: true,
                field: {
                  name: "reviewer",
                  type: "link",
                  label: "Reviewer",
                  description: "Person responsible for review.",
                  linkTo: "User",
                  unique: true,
                  inFormView: true,
                  defaultValue: "owner@example.com"
                }
              }
            ]
          }
        }, 201),
        stdout: saveStdout,
        stderr: textBuffer()
      }
    );

    expect(saveExit).toBe(0);
    expect(saveCalls[0]?.url).toBe("https://app.example/api/custom-fields/Task?tenant=acme%2Feast");
    expect(saveCalls[0]?.method).toBe("POST");
    expect(saveCalls[0]?.body).toBe(JSON.stringify({
      field: {
        name: "reviewer",
        type: "link",
        label: "Reviewer",
        description: "Person responsible for review.",
        linkTo: "User",
        unique: true,
        inFormView: true,
        defaultValue: "owner@example.com"
      },
      expectedVersion: 0
    }));
    expect(saveStdout.text()).toContain("Saved custom field at https://app.example");
    expect(saveStdout.text()).toContain("Version: 1 Total: 1");
    expect(saveStdout.text()).toContain('- reviewer enabled type link label "Reviewer" help "Person responsible for review." target User [unique,form]');

    const disableCalls: RemoteCall[] = [];
    const disableStdout = textBuffer();
    const disableExit = await runCli(
      [
        "custom-fields",
        "disable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "reviewer/primary",
        "--tenant",
        "default",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(disableCalls, {
          data: {
            tenantId: "default",
            doctype: "Task",
            version: 2,
            fields: [
              {
                enabled: false,
                field: {
                  name: "reviewer/primary",
                  type: "link",
                  linkTo: "User"
                }
              }
            ]
          }
        }),
        stdout: disableStdout,
        stderr: textBuffer()
      }
    );

    expect(disableExit).toBe(0);
    expect(disableCalls[0]?.url).toBe("https://app.example/api/custom-fields/Task/reviewer%2Fprimary?tenant=default");
    expect(disableCalls[0]?.method).toBe("DELETE");
    expect(disableCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 0 }));
    expect(disableStdout.text()).toContain("Disabled custom field at https://app.example");
    expect(disableStdout.text()).toContain("- reviewer/primary disabled type link target User");

    const disableWithoutVersionCalls: RemoteCall[] = [];
    const disableWithoutVersionExit = await runCli(
      [
        "custom-fields",
        "disable",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "reviewer"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(disableWithoutVersionCalls, {
          data: {
            tenantId: "default",
            doctype: "Task",
            version: 3,
            fields: []
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(disableWithoutVersionExit).toBe(0);
    expect(disableWithoutVersionCalls[0]?.url).toBe("https://app.example/api/custom-fields/Task/reviewer");
    expect(disableWithoutVersionCalls[0]?.method).toBe("DELETE");
    expect(disableWithoutVersionCalls[0]?.body).toBeUndefined();
  });

  it("maps remote custom-field API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "custom-fields",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field-json",
        "{\"name\":\"title\",\"type\":\"text\"}"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "CUSTOM_FIELD_INVALID", message: "Custom field 'title' already exists on base DocType 'Task'" }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote custom fields request failed (400): CUSTOM_FIELD_INVALID: Custom field 'title' already exists on base DocType 'Task'"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "custom-fields",
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
