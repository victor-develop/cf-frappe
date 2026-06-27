import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote kanbans", () => {
  it("parses remote kanban commands", () => {
    expect(parseCliArgs([
      "kanbans",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "kanbans",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ]
    });

    expect(parseCliArgs([
      "kanbans",
      "run",
      "--url",
      "https://app.example",
      "--kanban",
      "Task Board"
    ])).toEqual({
      kind: "kanbans",
      action: "run",
      url: "https://app.example",
      headers: [],
      kanban: "Task Board"
    });
  });

  it("rejects invalid remote kanban options before fetching", () => {
    expect(parseCliArgs(["kanbans", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown kanbans command 'unknown'"
    });
    expect(parseCliArgs(["kanbans", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["kanbans", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Kanban get requires --kanban"
    });
    expect(parseCliArgs(["kanbans", "list", "--url", "https://app.example", "--kanban", "Task Board"])).toEqual({
      kind: "invalid",
      message: "Cannot use --kanban with kanbans list"
    });
  });

  it("lists remote kanbans through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      ["kanbans", "list", "--url", "https://app.example/cf", "--header-env", "Authorization=CF_FRAPPE_AUTH"],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: [{ name: "Task Board", label: "Tasks", doctype: "Task", columnField: "status", columns: [{ value: "Open" }] }]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/kanbans");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Kanbans at https://app.example/cf");
    expect(stdout.text()).toContain("- Task Board Task.status columns=1 - Tasks");
  });

  it("gets and runs remote kanbans", async () => {
    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      ["kanbans", "get", "--url", "https://app.example", "--kanban", "Task Board"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: {
            name: "Task Board",
            doctype: "Task",
            columnField: "status",
            description: "Task flow",
            filterExpression: {
              kind: "group",
              match: "any",
              filters: [{ field: "title", operator: "contains", value: "Launch" }]
            },
            columns: [{ value: "Open", label: "Open" }, { value: "Done", label: "Done" }]
          }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );
    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/meta/kanbans/Task%20Board");
    expect(getStdout.text()).toContain("Description: Task flow");
    expect(getStdout.text()).toContain("Filter expression: yes");
    expect(getStdout.text()).toContain("- Done - Done");

    const runCalls: RemoteCall[] = [];
    const runStdout = textBuffer();
    const runExit = await runCli(
      ["kanbans", "run", "--url", "https://app.example", "--kanban", "Task Board"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(runCalls, {
          data: {
            board: { name: "Task Board", doctype: "Task", columnField: "status" },
            columns: [
              {
                value: "Open",
                label: "Open",
                total: 2,
                hasMore: true,
                cards: [{ name: "TASK-1", title: "First Task" }]
              }
            ]
          }
        }),
        stdout: runStdout,
        stderr: textBuffer()
      }
    );

    expect(runExit).toBe(0);
    expect(runCalls[0]?.url).toBe("https://app.example/api/kanban/Task%20Board/run");
    expect(runStdout.text()).toContain("- Open total=2 cards=1 more");
    expect(runStdout.text()).toContain("  - First Task (TASK-1)");
  });

  it("maps remote kanban API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exit = await runCli(
      ["kanbans", "run", "--url", "https://app.example", "--kanban", "Missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "KANBAN_NOT_FOUND", message: "Kanban 'Missing' is not registered" }
        }, 404),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exit).toBe(1);
    expect(stderr.text()).toContain(
      "Remote kanbans request failed (404): KANBAN_NOT_FOUND: Kanban 'Missing' is not registered"
    );
  });
});

interface RemoteCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string | undefined;
}

function fakeFetch(calls: RemoteCall[], payload: unknown, status = 200): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body === null ? undefined : await request.text()
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function textBuffer(): WritableText & { text(): string } {
  let value = "";
  return {
    write(chunk: string) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}
