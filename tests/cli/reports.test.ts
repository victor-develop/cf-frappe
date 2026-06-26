import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote reports", () => {
  it("parses remote report commands", () => {
    expect(parseCliArgs([
      "reports",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "reports",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      filters: []
    });

    expect(parseCliArgs([
      "reports",
      "run",
      "--url",
      "https://app.example",
      "--report",
      "Open Tasks",
      "--filter",
      "priority=High",
      "--filter",
      "count_range=2",
      "--filter",
      "count_range=8",
      "--filter-expression-json",
      '{"kind":"group","match":"all","filters":[{"filter":"priority","value":"High"}]}',
      "--order-by",
      "title",
      "--order",
      "desc",
      "--limit",
      "5",
      "--offset",
      "10"
    ])).toEqual({
      kind: "reports",
      action: "run",
      url: "https://app.example",
      headers: [],
      report: "Open Tasks",
      filters: [
        { name: "priority", value: "High" },
        { name: "count_range", value: "2" },
        { name: "count_range", value: "8" }
      ],
      filterExpression: {
        kind: "group",
        match: "all",
        filters: [{ filter: "priority", value: "High" }]
      },
      orderBy: "title",
      order: "desc",
      limit: 5,
      offset: 10
    });
  });

  it("rejects invalid remote report options before fetching", () => {
    expect(parseCliArgs(["reports", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown reports command 'unknown'"
    });
    expect(parseCliArgs(["reports", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["reports", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Report get requires --report"
    });
    expect(parseCliArgs(["reports", "list", "--url", "https://app.example", "--report", "Open Tasks"])).toEqual({
      kind: "invalid",
      message: "Cannot use --report with reports list"
    });
    expect(parseCliArgs(["reports", "get", "--url", "https://app.example", "--report", "Open Tasks", "--filter", "priority=High"])).toEqual({
      kind: "invalid",
      message: "Can only use --filter with reports run/export"
    });
    expect(parseCliArgs(["reports", "run", "--url", "https://app.example", "--report", "Open Tasks", "--filter", "filter_priority=High"])).toEqual({
      kind: "invalid",
      message: "Report filter name must be non-empty and omit the filter_ prefix"
    });
    expect(parseCliArgs(["reports", "run", "--url", "https://app.example", "--report", "Open Tasks", "--order", "sideways"])).toEqual({
      kind: "invalid",
      message: "Report order must be asc or desc"
    });
    expect(parseCliArgs(["reports", "export", "--url", "https://app.example", "--report", "Open Tasks", "--offset", "1"])).toEqual({
      kind: "invalid",
      message: "Can only use --offset with reports run"
    });
  });

  it("lists remote reports through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "reports",
        "list",
        "--url",
        "https://app.example/cf",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: [
            {
              name: "Open Tasks",
              label: "Open Tasks",
              doctype: "Task",
              source: { kind: "documents" }
            }
          ]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/reports");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Reports at https://app.example/cf");
    expect(stdout.text()).toContain("Total: 1");
    expect(stdout.text()).toContain("- Open Tasks [Task] source=documents - Open Tasks");
  });

  it("gets remote report metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "reports",
        "get",
        "--url",
        "https://app.example",
        "--report",
        "Open Tasks"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "Open Tasks",
            label: "Open Tasks",
            module: "Tasks",
            description: "Open task report",
            doctype: "Task",
            source: { kind: "documents" },
            roles: ["User"],
            columns: [{ name: "title" }, { name: "priority" }],
            filters: [{ name: "priority" }],
            summaries: [{ name: "task_count" }],
            groups: [{ name: "by_priority" }],
            charts: [{ name: "tasks_by_priority" }]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/reports/Open%20Tasks");
    expect(stdout.text()).toContain("Report at https://app.example");
    expect(stdout.text()).toContain("- Open Tasks [Task] source=documents - Open Tasks");
    expect(stdout.text()).toContain("Module: Tasks");
    expect(stdout.text()).toContain("Description: Open task report");
    expect(stdout.text()).toContain("Roles: User");
    expect(stdout.text()).toContain("Columns: 2");
    expect(stdout.text()).toContain("Filters: 1");
    expect(stdout.text()).toContain("Summaries: 1");
    expect(stdout.text()).toContain("Groups: 1");
    expect(stdout.text()).toContain("Charts: 1");
  });

  it("runs remote reports with query filters, ordering, and pagination", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "reports",
        "run",
        "--url",
        "https://app.example",
        "--report",
        "Open Tasks",
        "--filter",
        "priority=High",
        "--filter",
        "count_range=2",
        "--filter",
        "count_range=8",
        "--filter-expression-json",
        '{"filter":"priority","value":"High"}',
        "--order-by",
        "title",
        "--order",
        "asc",
        "--limit",
        "5",
        "--offset",
        "10"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          report: { name: "Open Tasks", label: "Open Tasks", doctype: "Task", source: { kind: "documents" } },
          columns: [{ name: "title" }, { name: "priority" }],
          filters: [{ name: "priority", value: "High" }],
          summary: [{ name: "task_count", aggregate: "count", value: 2, indicator: "green" }],
          groups: [{ name: "by_priority", rows: [{ key: "High" }] }],
          charts: [{ name: "tasks_by_priority", points: [{ key: "High", value: 2 }] }],
          rows: [
            { title: "Alpha", priority: "High" },
            { title: "Beta", priority: "High" }
          ],
          limit: 5,
          offset: 10,
          total: 12
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    const query = new URL(calls[0]!.url).searchParams;
    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toContain("https://app.example/api/report/Open%20Tasks/run?");
    expect(query.get("filter_priority")).toBe("High");
    expect(query.getAll("filter_count_range")).toEqual(["2", "8"]);
    expect(query.get("filter_expression")).toBe('{"filter":"priority","value":"High"}');
    expect(query.get("order_by")).toBe("title");
    expect(query.get("order")).toBe("asc");
    expect(query.get("limit")).toBe("5");
    expect(query.get("offset")).toBe("10");
    expect(stdout.text()).toContain("Report run at https://app.example");
    expect(stdout.text()).toContain("- Open Tasks [Task] source=documents - Open Tasks");
    expect(stdout.text()).toContain("Rows: 2 of 12 limit=5 offset=10");
    expect(stdout.text()).toContain("- task_count count=2 indicator=green");
    expect(stdout.text()).toContain("- by_priority rows=1");
    expect(stdout.text()).toContain("- tasks_by_priority points=1");
    expect(stdout.text()).toContain('- {"title":"Alpha","priority":"High"}');
  });

  it("exports remote report CSV through the generated report API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "reports",
        "export",
        "--url",
        "https://app.example",
        "--report",
        "Open Tasks",
        "--filter",
        "priority=High",
        "--order-by",
        "title",
        "--order",
        "desc",
        "--limit",
        "10"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, "Title,Priority\nBeta,High\nAlpha,High", 200, "text/csv"),
        stdout,
        stderr: textBuffer()
      }
    );

    const query = new URL(calls[0]!.url).searchParams;
    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toContain("https://app.example/api/report/Open%20Tasks/export.csv?");
    expect(calls[0]?.headers.get("accept")).toBe("text/csv");
    expect(query.get("filter_priority")).toBe("High");
    expect(query.get("order_by")).toBe("title");
    expect(query.get("order")).toBe("desc");
    expect(query.get("limit")).toBe("10");
    expect(stdout.text()).toBe("Title,Priority\nBeta,High\nAlpha,High");
  });

  it("maps remote report API errors and malformed metadata responses to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExitCode = await runCli(
      [
        "reports",
        "run",
        "--url",
        "https://app.example",
        "--report",
        "Managers"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot read report" }
        }, 403),
        stdout: textBuffer(),
        stderr: forbidden
      }
    );

    const malformed = textBuffer();
    const malformedExitCode = await runCli(
      [
        "reports",
        "list",
        "--url",
        "https://app.example"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { name: "Open Tasks" } }),
        stdout: textBuffer(),
        stderr: malformed
      }
    );

    expect(forbiddenExitCode).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote reports request failed (403): PERMISSION_DENIED: Actor cannot read report"
    );
    expect(malformedExitCode).toBe(1);
    expect(malformed.text()).toContain("Remote reports response did not include a data array");
  });
});

interface RemoteCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

function fakeFetch(
  calls: RemoteCall[],
  responseBody: unknown,
  status = 200,
  contentType = "application/json"
): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    return new Response(contentType === "application/json" ? JSON.stringify(responseBody) : String(responseBody), {
      headers: { "content-type": contentType },
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
