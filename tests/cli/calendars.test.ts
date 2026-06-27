import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote calendars", () => {
  it("parses remote calendar commands", () => {
    expect(parseCliArgs([
      "calendars",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "calendars",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ]
    });

    expect(parseCliArgs([
      "calendars",
      "run",
      "--url",
      "https://app.example",
      "--calendar",
      "Task Calendar",
      "--from",
      "2026-01-01",
      "--to",
      "2026-01-31",
      "--limit",
      "10"
    ])).toEqual({
      kind: "calendars",
      action: "run",
      url: "https://app.example",
      headers: [],
      calendar: "Task Calendar",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 10
    });
  });

  it("rejects invalid remote calendar options before fetching", () => {
    expect(parseCliArgs(["calendars", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown calendars command 'unknown'"
    });
    expect(parseCliArgs(["calendars", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["calendars", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Calendar get requires --calendar"
    });
    expect(parseCliArgs(["calendars", "list", "--url", "https://app.example", "--calendar", "Task Calendar"])).toEqual({
      kind: "invalid",
      message: "Cannot use --calendar with calendars list"
    });
    expect(parseCliArgs(["calendars", "run", "--url", "https://app.example", "--calendar", "Tasks", "--limit", "0"])).toEqual({
      kind: "invalid",
      message: "Calendar run --limit must be a positive integer"
    });
  });

  it("lists remote calendars through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      ["calendars", "list", "--url", "https://app.example/cf", "--header-env", "Authorization=CF_FRAPPE_AUTH"],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: [{ name: "Task Calendar", label: "Tasks", doctype: "Task", startField: "starts_on" }]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/calendars");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Calendars at https://app.example/cf");
    expect(stdout.text()).toContain("- Task Calendar Task.starts_on - Tasks");
  });

  it("gets and runs remote calendars", async () => {
    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      ["calendars", "get", "--url", "https://app.example", "--calendar", "Task Calendar"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: {
            name: "Task Calendar",
            doctype: "Task",
            startField: "starts_on",
            endField: "ends_on",
            description: "Task dates",
            filterExpression: {
              kind: "group",
              match: "any",
              filters: [{ field: "title", operator: "contains", value: "Launch" }]
            }
          }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );
    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/meta/calendars/Task%20Calendar");
    expect(getStdout.text()).toContain("Description: Task dates");
    expect(getStdout.text()).toContain("Filter expression: yes");

    const runCalls: RemoteCall[] = [];
    const runStdout = textBuffer();
    const runExit = await runCli(
      [
        "calendars",
        "run",
        "--url",
        "https://app.example",
        "--calendar",
        "Task Calendar",
        "--from",
        "2026-01-01",
        "--to",
        "2026-01-31",
        "--limit",
        "5"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(runCalls, {
          data: {
            calendar: { name: "Task Calendar", doctype: "Task", startField: "starts_on" },
            from: "2026-01-01",
            to: "2026-01-31",
            total: 1,
            hasMore: false,
            events: [{ name: "TASK-1", title: "First Task", start: "2026-01-10", color: "High" }]
          }
        }),
        stdout: runStdout,
        stderr: textBuffer()
      }
    );

    expect(runExit).toBe(0);
    expect(runCalls[0]?.url).toBe("https://app.example/api/calendar/Task%20Calendar/run?from=2026-01-01&to=2026-01-31&limit=5");
    expect(runStdout.text()).toContain("Window: 2026-01-01 to 2026-01-31");
    expect(runStdout.text()).toContain("- 2026-01-10 First Task (TASK-1) High");
  });

  it("maps remote calendar API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exit = await runCli(
      ["calendars", "run", "--url", "https://app.example", "--calendar", "Missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "CALENDAR_NOT_FOUND", message: "Calendar 'Missing' is not registered" }
        }, 404),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exit).toBe(1);
    expect(stderr.text()).toContain(
      "Remote calendars request failed (404): CALENDAR_NOT_FOUND: Calendar 'Missing' is not registered"
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
