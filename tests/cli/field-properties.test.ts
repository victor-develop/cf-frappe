import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote field properties", () => {
  it("parses remote field-property operator commands", () => {
    expect(parseCliArgs([
      "field-properties",
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
      kind: "field-properties",
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
      "field-properties",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority",
      "--overrides-json",
      "{\"label\":\"Urgency\",\"required\":true,\"inListFilter\":true}",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "field-properties",
      action: "save",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      fieldName: "priority",
      overrides: {
        label: "Urgency",
        required: true,
        inListFilter: true
      },
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "field-properties",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "field-properties",
      action: "clear",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      fieldName: "priority",
      expectedVersion: 2
    });
  });

  it("rejects invalid remote field-property options before fetching", () => {
    expect(parseCliArgs(["field-properties", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown field-properties command 'unknown'"
    });
    expect(parseCliArgs(["field-properties", "list", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["field-properties", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Field property list requires --doctype"
    });
    expect(parseCliArgs([
      "field-properties",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --field with field-properties list"
    });
    expect(parseCliArgs([
      "field-properties",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--overrides-json",
      "{\"label\":\"Urgency\"}"
    ])).toEqual({
      kind: "invalid",
      message: "Field property save requires --field"
    });
    expect(parseCliArgs([
      "field-properties",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority"
    ])).toEqual({
      kind: "invalid",
      message: "Field property save requires --overrides-json"
    });
    expect(parseCliArgs([
      "field-properties",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority",
      "--overrides-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Field property overrides must be a valid JSON object"
    });
    expect(parseCliArgs([
      "field-properties",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Field property clear requires --field"
    });
    expect(parseCliArgs([
      "field-properties",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority",
      "--overrides-json",
      "{\"label\":\"Urgency\"}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --overrides-json with field-properties clear"
    });
    expect(parseCliArgs([
      "field-properties",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "priority",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Field property expected version must be a non-negative integer"
    });
  });

  it("lists remote field property overrides through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "field-properties",
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
                fieldName: "priority",
                overrides: {
                  label: "Urgency",
                  description: "Pick the operational urgency.",
                  noCopy: true,
                  required: true,
                  inListFilter: true
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
    expect(calls[0]?.url).toBe("https://app.example/cf/api/field-properties/Sales%20Invoice?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Field property overrides at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 2 Total: 1");
    expect(stdout.text()).toContain("- priority overrides label, description, noCopy, required, inListFilter");
    expect(stdout.text()).toContain("{\"label\":\"Urgency\"");
  });

  it("saves and clears remote field property overrides through the generated admin API", async () => {
    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "field-properties",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "priority/level",
        "--overrides-json",
        "{\"label\":\"Urgency\",\"description\":\"Pick the operational urgency.\",\"noCopy\":true,\"options\":[\"Low\",\"High\"],\"defaultValue\":\"High\",\"inListFilter\":true}",
        "--tenant",
        "acme/east",
        "--expected-version",
        "0"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(saveCalls, {
          data: {
            tenantId: "acme/east",
            doctype: "Task",
            version: 1,
            fields: [
              {
                fieldName: "priority/level",
                overrides: {
                  label: "Urgency",
                  description: "Pick the operational urgency.",
                  noCopy: true,
                  options: ["Low", "High"],
                  defaultValue: "High",
                  inListFilter: true
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
    expect(saveCalls[0]?.url).toBe("https://app.example/api/field-properties/Task/priority%2Flevel?tenant=acme%2Feast");
    expect(saveCalls[0]?.method).toBe("PUT");
    expect(saveCalls[0]?.body).toBe(JSON.stringify({
      overrides: {
        label: "Urgency",
        description: "Pick the operational urgency.",
        noCopy: true,
        options: ["Low", "High"],
        defaultValue: "High",
        inListFilter: true
      },
      expectedVersion: 0
    }));
    expect(saveStdout.text()).toContain("Saved field property override at https://app.example");
    expect(saveStdout.text()).toContain("Version: 1 Total: 1");

    const clearCalls: RemoteCall[] = [];
    const clearStdout = textBuffer();
    const clearExit = await runCli(
      [
        "field-properties",
        "clear",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "priority/level",
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
            doctype: "Task",
            version: 2,
            fields: []
          }
        }),
        stdout: clearStdout,
        stderr: textBuffer()
      }
    );

    expect(clearExit).toBe(0);
    expect(clearCalls[0]?.url).toBe("https://app.example/api/field-properties/Task/priority%2Flevel?tenant=default");
    expect(clearCalls[0]?.method).toBe("DELETE");
    expect(clearCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 1 }));
    expect(clearStdout.text()).toContain("Cleared field property override at https://app.example");
    expect(clearStdout.text()).toContain("- (none)");

    const clearWithoutVersionCalls: RemoteCall[] = [];
    const clearWithoutVersionExit = await runCli(
      [
        "field-properties",
        "clear",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "priority"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(clearWithoutVersionCalls, {
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

    expect(clearWithoutVersionExit).toBe(0);
    expect(clearWithoutVersionCalls[0]?.url).toBe("https://app.example/api/field-properties/Task/priority");
    expect(clearWithoutVersionCalls[0]?.method).toBe("DELETE");
    expect(clearWithoutVersionCalls[0]?.body).toBeUndefined();
  });

  it("maps remote field-property API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "field-properties",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "items",
        "--overrides-json",
        "{\"inListFilter\":true}"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "FIELD_PROPERTY_INVALID", message: "Table field 'items' cannot be a list filter" }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote field properties request failed (400): FIELD_PROPERTY_INVALID: Table field 'items' cannot be a list filter"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "field-properties",
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
