import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote dashboards", () => {
  it("parses remote dashboard commands", () => {
    expect(parseCliArgs([
      "dashboards",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "dashboards",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ]
    });

    expect(parseCliArgs([
      "dashboards",
      "run",
      "--url",
      "https://app.example",
      "--dashboard",
      "Task Dashboard"
    ])).toEqual({
      kind: "dashboards",
      action: "run",
      url: "https://app.example",
      headers: [],
      dashboard: "Task Dashboard"
    });
  });

  it("rejects invalid remote dashboard options before fetching", () => {
    expect(parseCliArgs(["dashboards", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown dashboards command 'unknown'"
    });
    expect(parseCliArgs(["dashboards", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["dashboards", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Dashboard get requires --dashboard"
    });
    expect(parseCliArgs([
      "dashboards",
      "list",
      "--url",
      "https://app.example",
      "--dashboard",
      "Task Dashboard"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --dashboard with dashboards list"
    });
  });

  it("lists remote dashboards through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "dashboards",
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
              name: "Task Dashboard",
              label: "Task Dashboard",
              cards: [
                { name: "open_tasks", source: { kind: "documentCount" } },
                { name: "priority_chart", source: { kind: "reportChart" } }
              ]
            }
          ]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/dashboards");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Dashboards at https://app.example/cf");
    expect(stdout.text()).toContain("Total: 1");
    expect(stdout.text()).toContain("- Task Dashboard cards=2 - Task Dashboard");
  });

  it("gets remote dashboard metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "dashboards",
        "get",
        "--url",
        "https://app.example",
        "--dashboard",
        "Task Dashboard"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "Task Dashboard",
            label: "Task Dashboard",
            module: "Tasks",
            roles: ["User"],
            cards: [
              {
                name: "open_tasks",
                source: {
                  kind: "documentCount",
                  filterExpression: { field: "title", operator: "contains", value: "Visible" }
                },
                indicator: "green"
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/dashboards/Task%20Dashboard");
    expect(stdout.text()).toContain("Dashboard at https://app.example");
    expect(stdout.text()).toContain("- Task Dashboard cards=1 - Task Dashboard");
    expect(stdout.text()).toContain("Module: Tasks");
    expect(stdout.text()).toContain("Roles: User");
    expect(stdout.text()).toContain("Cards: 1");
    expect(stdout.text()).toContain("- open_tasks [documentCount] filterExpression=yes indicator=green");
  });

  it("runs remote dashboards through the generated dashboard API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "dashboards",
        "run",
        "--url",
        "https://app.example",
        "--dashboard",
        "Task Dashboard"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            dashboard: { name: "Task Dashboard", label: "Task Dashboard", cards: [{ name: "open_tasks" }] },
            cards: [
              { name: "open_tasks", source: { kind: "documentCount" }, value: 3, indicator: "green" },
              {
                name: "priority_chart",
                source: { kind: "reportChart" },
                value: { name: "priority", points: [{ key: "High", value: 2 }] }
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/dashboard/Task%20Dashboard/run");
    expect(stdout.text()).toContain("Dashboard run at https://app.example");
    expect(stdout.text()).toContain("- Task Dashboard cards=1 - Task Dashboard");
    expect(stdout.text()).toContain("Cards: 2");
    expect(stdout.text()).toContain("- open_tasks [documentCount] value=3 indicator=green");
    expect(stdout.text()).toContain(
      '- priority_chart [reportChart] value={"name":"priority","points":[{"key":"High","value":2}]}'
    );
  });

  it("maps remote dashboard API errors and malformed responses to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExitCode = await runCli(
      [
        "dashboards",
        "get",
        "--url",
        "https://app.example",
        "--dashboard",
        "Managers"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot read dashboard" }
        }, 403),
        stdout: textBuffer(),
        stderr: forbidden
      }
    );

    const malformed = textBuffer();
    const malformedExitCode = await runCli(
      [
        "dashboards",
        "list",
        "--url",
        "https://app.example"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { name: "Task Dashboard" } }),
        stdout: textBuffer(),
        stderr: malformed
      }
    );

    expect(forbiddenExitCode).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote dashboards request failed (403): PERMISSION_DENIED: Actor cannot read dashboard"
    );
    expect(malformedExitCode).toBe(1);
    expect(malformed.text()).toContain("Remote dashboards response did not include a data array");
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
