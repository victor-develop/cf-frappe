import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote resources", () => {
  it("parses remote resource CRUD commands", () => {
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter",
      "status=Open",
      "--filter",
      "priority__ne=Low",
      "--filter-expression-json",
      "{\"kind\":\"group\",\"match\":\"all\",\"filters\":[]}",
      "--limit",
      "10",
      "--offset",
      "5",
      "--order-by",
      "priority",
      "--order",
      "desc",
      "--no-default-filters",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "resources",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Task",
      filters: [
        { key: "status", value: "Open" },
        { key: "priority__ne", value: "Low" }
      ],
      filterExpression: { kind: "group", match: "all", filters: [] },
      limit: 10,
      offset: 5,
      orderBy: "priority",
      order: "desc",
      useDefaultFilters: false
    });

    expect(parseCliArgs([
      "resources",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK/001"
    ])).toEqual({
      kind: "resources",
      action: "get",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK/001"
    });

    expect(parseCliArgs([
      "resources",
      "create",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--data-json",
      "{\"title\":\"Ship it\"}"
    ])).toEqual({
      kind: "resources",
      action: "create",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      data: { title: "Ship it" }
    });

    expect(parseCliArgs([
      "resources",
      "update",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--data-json",
      "{\"status\":\"Closed\"}",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "resources",
      action: "update",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK-1",
      data: { status: "Closed" },
      expectedVersion: 3
    });
  });

  it("rejects invalid remote resource options before fetching", () => {
    expect(parseCliArgs(["resources", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Resource command requires --doctype"
    });
    expect(parseCliArgs(["resources", "get", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Resource get requires --name"
    });
    expect(parseCliArgs(["resources", "create", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Resource create requires --data-json"
    });
    expect(parseCliArgs([
      "resources",
      "delete",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--data-json",
      "{}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --data-json with resources delete"
    });
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter",
      "status"
    ])).toEqual({
      kind: "invalid",
      message: "Resource filter must use <field[__operator]>=<value>"
    });
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--order",
      "sideways"
    ])).toEqual({
      kind: "invalid",
      message: "Resource list order must be asc or desc"
    });
  });

  it("lists and gets remote DocType resources through the generated resource API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      [
        "resources",
        "list",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Task",
        "--filter",
        "status=Open",
        "--filter",
        "body=",
        "--limit",
        "2",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(listCalls, {
          data: [
            { name: "TASK-1", version: 1, docstatus: "draft", data: { title: "First" } },
            { name: "TASK-2", version: 2, docstatus: "submitted", data: { title: "Second" } }
          ],
          limit: 2,
          offset: 0,
          total: 7
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe(
      "https://app.example/cf/api/resource/Task?filter_status=Open&filter_body=&empty_filter=filter_body&limit=2"
    );
    expect(listCalls[0]?.method).toBe("GET");
    expect(listCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(listStdout.text()).toContain("Resources Task at https://app.example/cf");
    expect(listStdout.text()).toContain("Total: 7 Offset: 0 Limit: 2");
    expect(listStdout.text()).toContain("- TASK-2 version 2 status submitted");
    expect(listStdout.text()).toContain("{\"name\":\"TASK-1\"");

    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      ["resources", "get", "--url", "https://app.example", "--doctype", "Task", "--name", "TASK/001"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: { name: "TASK/001", version: 3, docstatus: "draft", data: { title: "Encoded" } }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );

    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK%2F001");
    expect(getStdout.text()).toContain("Resource Task at https://app.example");
    expect(getStdout.text()).toContain("- TASK/001 version 3 status draft");
  });

  it("creates, updates, and deletes remote DocType resources through the generated resource API", async () => {
    const createCalls: RemoteCall[] = [];
    const createStdout = textBuffer();
    const createExit = await runCli(
      [
        "resources",
        "create",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--data-json",
        "{\"name\":\"TASK-1\",\"title\":\"First\"}"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(createCalls, {
          data: { name: "TASK-1", version: 1, docstatus: "draft", data: { title: "First" } }
        }, 201),
        stdout: createStdout,
        stderr: textBuffer()
      }
    );

    expect(createExit).toBe(0);
    expect(createCalls[0]?.url).toBe("https://app.example/api/resource/Task");
    expect(createCalls[0]?.method).toBe("POST");
    expect(createCalls[0]?.body).toBe("{\"name\":\"TASK-1\",\"title\":\"First\"}");
    expect(createStdout.text()).toContain("Created resource Task at https://app.example");

    const updateCalls: RemoteCall[] = [];
    const updateExit = await runCli(
      [
        "resources",
        "update",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--data-json",
        "{\"status\":\"Closed\"}",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(updateCalls, {
          data: { name: "TASK-1", version: 2, docstatus: "draft", data: { status: "Closed" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(updateExit).toBe(0);
    expect(updateCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1");
    expect(updateCalls[0]?.method).toBe("PUT");
    expect(updateCalls[0]?.body).toBe("{\"status\":\"Closed\",\"expectedVersion\":1}");

    const deleteCalls: RemoteCall[] = [];
    const deleteExit = await runCli(
      [
        "resources",
        "delete",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(deleteCalls, {
          data: { name: "TASK-1", version: 3, docstatus: "draft", data: { title: "First" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(deleteExit).toBe(0);
    expect(deleteCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1");
    expect(deleteCalls[0]?.method).toBe("DELETE");
    expect(deleteCalls[0]?.body).toBe("{\"expectedVersion\":2}");
  });

  it("maps remote resource API errors and missing env headers to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      ["resources", "get", "--url", "https://app.example", "--doctype", "Task", "--name", "missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "NOT_FOUND", message: "Document not found" }
        }, 404),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain("Remote resource request failed (404): NOT_FOUND: Document not found");

    const envCalls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "resources",
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
        fetch: fakeFetch(envCalls, {}),
        stdout: textBuffer(),
        stderr: envStderr
      }
    );

    expect(envExit).toBe(1);
    expect(envStderr.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
    expect(envCalls).toEqual([]);
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
    const body = init?.body === undefined || init.body === null
      ? undefined
      : await new Response(init.body).text();
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(body === undefined ? {} : { body })
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
