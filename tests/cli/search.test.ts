import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote search", () => {
  it("parses remote search commands", () => {
    expect(parseCliArgs([
      "search",
      "--url",
      "https://app.example",
      "--query",
      "launch plan",
      "--tenant",
      "acme",
      "--limit",
      "5",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "search",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      query: "launch plan",
      tenant: "acme",
      limit: 5
    });

    expect(parseCliArgs(["search", "--url", "https://app.example", "-q", "task"])).toEqual({
      kind: "search",
      url: "https://app.example",
      headers: [],
      query: "task"
    });
  });

  it("rejects invalid remote search options before fetching", () => {
    expect(parseCliArgs(["search", "--query", "launch"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["search", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Search requires --query"
    });
    expect(parseCliArgs(["search", "--url", "https://app.example", "--query", "launch", "--limit", "many"])).toEqual({
      kind: "invalid",
      message: "Search limit must be a non-negative integer"
    });
    expect(parseCliArgs(["search", "--url", "https://app.example", "--query", "launch", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Unknown search option '--doctype'"
    });
  });

  it("runs permissioned global search through the generated API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "search",
        "--url",
        "https://app.example/cf",
        "--query",
        "launch plan",
        "--tenant",
        "acme",
        "--limit",
        "5",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            query: "launch plan",
            limit: 5,
            total: 2,
            data: [
              {
                doctype: "Task",
                name: "TASK-1",
                label: "Launch plan",
                matchedField: "title",
                matchedText: "Launch plan",
                route: "/desk/Task/TASK-1",
                updatedAt: "2026-01-01T00:00:00.000Z"
              },
              {
                doctype: "Note",
                name: "Launch Note",
                label: "Launch Note",
                matchedField: "body",
                matchedText: "Final launch checklist",
                route: "/desk/Note/Launch%20Note"
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    const url = new URL(calls[0]!.url);
    expect(exitCode).toBe(0);
    expect(url.origin + url.pathname).toBe("https://app.example/cf/api/search");
    expect(url.searchParams.get("q")).toBe("launch plan");
    expect(url.searchParams.get("tenant")).toBe("acme");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Search at https://app.example/cf");
    expect(stdout.text()).toContain("Query: launch plan");
    expect(stdout.text()).toContain("Total: 2 limit=5");
    expect(stdout.text()).toContain("- Task/TASK-1 - Launch plan match=title:Launch plan route=/desk/Task/TASK-1 updated=2026-01-01T00:00:00.000Z");
    expect(stdout.text()).toContain("- Note/Launch Note - Launch Note match=body:Final launch checklist route=/desk/Note/Launch%20Note");
  });

  it("maps empty and malformed search responses", async () => {
    const empty = textBuffer();
    const emptyExit = await runCli(
      ["search", "--url", "https://app.example", "--query", "missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { query: "missing", limit: 20, total: 0, data: [] } }),
        stdout: empty,
        stderr: textBuffer()
      }
    );

    const malformed = textBuffer();
    const malformedExit = await runCli(
      ["search", "--url", "https://app.example", "--query", "launch"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: [{ name: "TASK-1" }] }),
        stdout: textBuffer(),
        stderr: malformed
      }
    );

    expect(emptyExit).toBe(0);
    expect(empty.text()).toContain("- (none)");
    expect(malformedExit).toBe(1);
    expect(malformed.text()).toContain("Remote search result response did not include a data object");
  });

  it("maps remote search API and env header errors to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExit = await runCli(
      [
        "search",
        "--url",
        "https://app.example",
        "--query",
        "launch"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot search" }
        }, 403),
        stdout: textBuffer(),
        stderr: forbidden
      }
    );

    const missingEnv = textBuffer();
    const missingEnvExit = await runCli(
      [
        "search",
        "--url",
        "https://app.example",
        "--query",
        "launch",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch([], { data: { query: "launch", data: [] } }),
        stdout: textBuffer(),
        stderr: missingEnv
      }
    );

    expect(forbiddenExit).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote search request failed (403): PERMISSION_DENIED: Actor cannot search"
    );
    expect(missingEnvExit).toBe(1);
    expect(missingEnv.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
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
