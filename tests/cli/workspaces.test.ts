import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote workspaces", () => {
  it("parses remote workspace commands", () => {
    expect(parseCliArgs([
      "workspaces",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "workspaces",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ]
    });

    expect(parseCliArgs([
      "workspaces",
      "get",
      "--url",
      "https://app.example",
      "--workspace",
      "Operations"
    ])).toEqual({
      kind: "workspaces",
      action: "get",
      url: "https://app.example",
      headers: [],
      workspace: "Operations"
    });
  });

  it("rejects invalid remote workspace options before fetching", () => {
    expect(parseCliArgs(["workspaces", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown workspaces command 'unknown'"
    });
    expect(parseCliArgs(["workspaces", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["workspaces", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Workspace get requires --workspace"
    });
    expect(parseCliArgs([
      "workspaces",
      "list",
      "--url",
      "https://app.example",
      "--workspace",
      "Operations"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --workspace with workspaces list"
    });
  });

  it("lists remote workspaces through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "workspaces",
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
              name: "Operations",
              label: "Operations",
              sections: [
                {
                  name: "Daily",
                  shortcuts: [
                    { name: "tasks", kind: "doctype", target: "Task" },
                    { name: "task_dashboard", kind: "dashboard", target: "Task Dashboard" }
                  ]
                }
              ]
            }
          ]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/workspaces");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Workspaces at https://app.example/cf");
    expect(stdout.text()).toContain("Total: 1");
    expect(stdout.text()).toContain("- Operations sections=1 - Operations");
  });

  it("gets remote workspace metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "workspaces",
        "get",
        "--url",
        "https://app.example",
        "--workspace",
        "Operations"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "Operations",
            label: "Operations",
            module: "Tasks",
            description: "Daily workspace",
            roles: ["User"],
            sections: [
              {
                name: "Daily",
                label: "Daily Work",
                shortcuts: [
                  { name: "tasks", label: "Tasks", kind: "doctype", target: "Task" },
                  { name: "new_task", kind: "newDoc", target: "Task" },
                  { name: "files", kind: "file" },
                  { name: "help", kind: "url", href: "https://docs.example/tasks" }
                ]
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/workspaces/Operations");
    expect(stdout.text()).toContain("Workspace at https://app.example");
    expect(stdout.text()).toContain("- Operations sections=1 - Operations");
    expect(stdout.text()).toContain("Module: Tasks");
    expect(stdout.text()).toContain("Description: Daily workspace");
    expect(stdout.text()).toContain("Roles: User");
    expect(stdout.text()).toContain("Sections: 1");
    expect(stdout.text()).toContain("- Daily shortcuts=4 - Daily Work");
    expect(stdout.text()).toContain("  - tasks [doctype] -> Task - Tasks");
    expect(stdout.text()).toContain("  - new_task [newDoc] -> Task");
    expect(stdout.text()).toContain("  - files [file]");
    expect(stdout.text()).toContain("  - help [url] -> https://docs.example/tasks");
  });

  it("maps remote workspace API errors and malformed responses to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExitCode = await runCli(
      [
        "workspaces",
        "get",
        "--url",
        "https://app.example",
        "--workspace",
        "Managers"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot read workspace" }
        }, 403),
        stdout: textBuffer(),
        stderr: forbidden
      }
    );

    const malformed = textBuffer();
    const malformedExitCode = await runCli(
      [
        "workspaces",
        "list",
        "--url",
        "https://app.example"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { name: "Operations" } }),
        stdout: textBuffer(),
        stderr: malformed
      }
    );

    expect(forbiddenExitCode).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote workspaces request failed (403): PERMISSION_DENIED: Actor cannot read workspace"
    );
    expect(malformedExitCode).toBe(1);
    expect(malformed.text()).toContain("Remote workspaces response did not include a data array");
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
