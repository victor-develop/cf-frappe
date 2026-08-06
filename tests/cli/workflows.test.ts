import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote workflows", () => {
  it("parses remote workflow operator commands", () => {
    expect(parseCliArgs([
      "workflows",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Sales Invoice"
    ])).toEqual({
      kind: "workflows",
      action: "list",
      url: "https://app.example",
      headers: [],
      doctype: "Sales Invoice"
    });

    expect(parseCliArgs([
      "workflows",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Sales Invoice",
      "--workflow",
      "approval",
      "--tenant",
      "acme/east",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "workflows",
      action: "get",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Sales Invoice",
      tenant: "acme/east",
      workflowName: "approval"
    });

    expect(parseCliArgs([
      "workflows",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle",
      "--workflow-json",
      "{\"name\":\"lifecycle\",\"stateField\":\"status\",\"initialState\":\"Open\",\"states\":[\"Open\",\"Done\"],\"transitions\":[{\"action\":\"Finish\",\"from\":\"Open\",\"to\":\"Done\"}]}",
      "--expected-version",
      "0"
    ])).toEqual({
      kind: "workflows",
      action: "save",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      workflowName: "lifecycle",
      workflow: {
        name: "lifecycle",
        stateField: "status",
        initialState: "Open",
        states: ["Open", "Done"],
        transitions: [{ action: "Finish", from: "Open", to: "Done" }]
      },
      expectedVersion: 0
    });

    expect(parseCliArgs([
      "workflows",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "workflows",
      action: "clear",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      workflowName: "lifecycle",
      expectedVersion: 2
    });
  });

  it("rejects invalid remote workflow options before fetching", () => {
    expect(parseCliArgs(["workflows", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown workflows command 'unknown'"
    });
    expect(parseCliArgs(["workflows", "get", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["workflows", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Workflow get requires --doctype"
    });
    expect(parseCliArgs([
      "workflows",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Workflow get requires --workflow"
    });
    expect(parseCliArgs([
      "workflows",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --workflow with workflows list"
    });
    expect(parseCliArgs([
      "workflows",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Workflow save requires --workflow-json"
    });
    expect(parseCliArgs([
      "workflows",
      "save",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle",
      "--workflow-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Workflow must be a valid JSON object"
    });
    expect(parseCliArgs([
      "workflows",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle",
      "--workflow-json",
      "{\"initialState\":\"Open\"}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --workflow-json with workflows clear"
    });
    expect(parseCliArgs([
      "workflows",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle",
      "--expected-version",
      "1"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --expected-version with workflows get"
    });
    expect(parseCliArgs([
      "workflows",
      "clear",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--workflow",
      "lifecycle",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Workflow expected version must be a non-negative integer"
    });
  });

  it("lists and gets remote workflow definitions through the generated admin API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      [
        "workflows",
        "list",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Sales Invoice"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(listCalls, {
          data: [
            {
              tenantId: "default",
              doctypeName: "Sales Invoice",
              workflowName: "approval",
              version: 2,
              workflow: {
                name: "approval",
                stateField: "approval_status",
                initialState: "Draft",
                states: ["Draft", "Approved"],
                transitions: [{ action: "Approve", from: "Draft", to: "Approved" }]
              }
            }
          ]
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe("https://app.example/cf/api/workflows/Sales%20Invoice");
    expect(listCalls[0]?.method).toBe("GET");
    expect(listStdout.text()).toContain("Workflow definitions at https://app.example/cf");
    expect(listStdout.text()).toContain("- approval: state approval_status initial Draft states Draft, Approved transitions 1 v2");

    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "workflows",
        "get",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Sales Invoice",
        "--workflow",
        "approval",
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
            workflowName: "approval",
            version: 2,
            workflow: {
              name: "approval",
              stateField: "status",
              initialState: "Open",
              states: ["Open", "Closed"],
              transitions: [
                { action: "Close", from: "Open", to: "Closed", roles: ["Manager"] }
              ]
            }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/workflows/Sales%20Invoice/approval?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Workflow definition at https://app.example/cf");
    expect(stdout.text()).toContain("DocType: Sales Invoice Tenant: acme/east Version: 2");
    expect(stdout.text()).toContain("- approval: state status initial Open states Open, Closed transitions 1");
    expect(stdout.text()).toContain("{\"name\":\"approval\",\"stateField\":\"status\"");
  });

  it("saves and clears remote workflow definitions through the generated admin API", async () => {
    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "workflows",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type",
        "--workflow",
        "lifecycle",
        "--workflow-json",
        "{\"name\":\"lifecycle\",\"stateField\":\"status\",\"initialState\":\"Open\",\"states\":[\"Open\",\"Closed\"],\"transitions\":[{\"action\":\"Close\",\"from\":\"Open\",\"to\":\"Closed\",\"roles\":[\"Support Manager\"],\"eventType\":\"TaskClosed\"}]}",
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
            doctypeName: "Task Type",
            workflowName: "lifecycle",
            version: 1,
            workflow: {
              name: "lifecycle",
              stateField: "status",
              initialState: "Open",
              states: ["Open", "Closed"],
              transitions: [
                {
                  action: "Close",
                  from: "Open",
                  to: "Closed",
                  roles: ["Support Manager"],
                  eventType: "TaskClosed"
                }
              ]
            }
          }
        }),
        stdout: saveStdout,
        stderr: textBuffer()
      }
    );

    expect(saveExit).toBe(0);
    expect(saveCalls[0]?.url).toBe("https://app.example/api/workflows/Task%20Type/lifecycle?tenant=acme%2Feast");
    expect(saveCalls[0]?.method).toBe("PUT");
    expect(saveCalls[0]?.body).toBe(JSON.stringify({
      workflow: {
        name: "lifecycle",
        stateField: "status",
        initialState: "Open",
        states: ["Open", "Closed"],
        transitions: [
          {
            action: "Close",
            from: "Open",
            to: "Closed",
            roles: ["Support Manager"],
            eventType: "TaskClosed"
          }
        ]
      },
      expectedVersion: 0
    }));
    expect(saveStdout.text()).toContain("Saved workflow definition at https://app.example");
    expect(saveStdout.text()).toContain("Version: 1");

    const clearCalls: RemoteCall[] = [];
    const clearStdout = textBuffer();
    const clearExit = await runCli(
      [
        "workflows",
        "clear",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type",
        "--workflow",
        "lifecycle",
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
            doctypeName: "Task Type",
            workflowName: "lifecycle",
            version: 2
          }
        }),
        stdout: clearStdout,
        stderr: textBuffer()
      }
    );

    expect(clearExit).toBe(0);
    expect(clearCalls[0]?.url).toBe("https://app.example/api/workflows/Task%20Type/lifecycle?tenant=default");
    expect(clearCalls[0]?.method).toBe("DELETE");
    expect(clearCalls[0]?.body).toBe(JSON.stringify({ expectedVersion: 1 }));
    expect(clearStdout.text()).toContain("Cleared workflow definition at https://app.example");
    expect(clearStdout.text()).toContain("- (none)");

    const clearWithoutVersionCalls: RemoteCall[] = [];
    const clearWithoutVersionExit = await runCli(
      [
        "workflows",
        "clear",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--workflow",
        "lifecycle"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(clearWithoutVersionCalls, {
          data: {
            tenantId: "default",
            doctypeName: "Task",
            workflowName: "lifecycle",
            version: 3
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(clearWithoutVersionExit).toBe(0);
    expect(clearWithoutVersionCalls[0]?.url).toBe("https://app.example/api/workflows/Task/lifecycle");
    expect(clearWithoutVersionCalls[0]?.method).toBe("DELETE");
    expect(clearWithoutVersionCalls[0]?.body).toBeUndefined();
  });

  it("maps remote workflow API and env header errors to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      [
        "workflows",
        "save",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--workflow",
        "lifecycle",
        "--workflow-json",
        "{\"name\":\"lifecycle\",\"stateField\":\"missing_state\",\"initialState\":\"Open\",\"states\":[\"Open\",\"Done\"],\"transitions\":[{\"action\":\"Finish\",\"from\":\"Open\",\"to\":\"Done\"}]}"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "WORKFLOW_INVALID", message: "Workflow 'lifecycle' state field 'missing_state' is not defined on Task" }
        }, 400),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote workflows request failed (400): WORKFLOW_INVALID: Workflow 'lifecycle' state field 'missing_state' is not defined on Task"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "workflows",
        "get",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--workflow",
        "lifecycle",
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
