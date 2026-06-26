import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote link options", () => {
  it("parses remote link option commands", () => {
    expect(parseCliArgs([
      "link-options",
      "--url",
      "https://app.example",
      "--doctype",
      "Task Type",
      "--field",
      "Project Link",
      "--query",
      "apollo",
      "--limit",
      "5",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "link-options",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Task Type",
      field: "Project Link",
      query: "apollo",
      limit: 5
    });

    expect(parseCliArgs([
      "link-options",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "project",
      "-q",
      "apo"
    ])).toEqual({
      kind: "link-options",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      field: "project",
      query: "apo"
    });
  });

  it("rejects invalid remote link option arguments before fetching", () => {
    expect(parseCliArgs(["link-options", "--doctype", "Task", "--field", "project"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["link-options", "--url", "https://app.example", "--field", "project"])).toEqual({
      kind: "invalid",
      message: "Link options require --doctype"
    });
    expect(parseCliArgs(["link-options", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Link options require --field"
    });
    expect(parseCliArgs([
      "link-options",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "project",
      "--limit",
      "0"
    ])).toEqual({
      kind: "invalid",
      message: "Link options limit must be a positive integer"
    });
    expect(parseCliArgs([
      "link-options",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--field",
      "project",
      "--tenant",
      "acme"
    ])).toEqual({
      kind: "invalid",
      message: "Unknown link-options option '--tenant'"
    });
  });

  it("lists permissioned link options through the generated API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "link-options",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Task Type",
        "--field",
        "Project Link",
        "--query",
        "apollo",
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
            doctype: "Task Type",
            field: "Project Link",
            target: "Project",
            options: [
              { value: "PROJECT/1", label: "Apollo" },
              { value: "PROJECT/2", label: "Apollo Archive" }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    const url = new URL(calls[0]!.url);
    expect(exitCode).toBe(0);
    expect(url.origin + url.pathname).toBe("https://app.example/cf/api/link-options/Task%20Type/Project%20Link");
    expect(url.searchParams.get("q")).toBe("apollo");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Link options at https://app.example/cf");
    expect(stdout.text()).toContain("Task Type.Project Link -> Project");
    expect(stdout.text()).toContain("Total: 2");
    expect(stdout.text()).toContain("- PROJECT/1 - Apollo");
    expect(stdout.text()).toContain("- PROJECT/2 - Apollo Archive");
  });

  it("maps empty and malformed link option responses", async () => {
    const empty = textBuffer();
    const emptyExit = await runCli(
      ["link-options", "--url", "https://app.example", "--doctype", "Task", "--field", "project"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { doctype: "Task", field: "project", target: "Project", options: [] } }),
        stdout: empty,
        stderr: textBuffer()
      }
    );

    const malformedData = textBuffer();
    const malformedDataExit = await runCli(
      ["link-options", "--url", "https://app.example", "--doctype", "Task", "--field", "project"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: [{ value: "PROJECT/1" }] }),
        stdout: textBuffer(),
        stderr: malformedData
      }
    );

    const malformedOptions = textBuffer();
    const malformedOptionsExit = await runCli(
      ["link-options", "--url", "https://app.example", "--doctype", "Task", "--field", "project"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { doctype: "Task", field: "project", target: "Project", options: "bad" } }),
        stdout: textBuffer(),
        stderr: malformedOptions
      }
    );

    const malformedOption = textBuffer();
    const malformedOptionExit = await runCli(
      ["link-options", "--url", "https://app.example", "--doctype", "Task", "--field", "project"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { doctype: "Task", field: "project", target: "Project", options: [null] } }),
        stdout: textBuffer(),
        stderr: malformedOption
      }
    );

    expect(emptyExit).toBe(0);
    expect(empty.text()).toContain("- (none)");
    expect(malformedDataExit).toBe(1);
    expect(malformedData.text()).toContain("Remote link options response did not include a data object");
    expect(malformedOptionsExit).toBe(1);
    expect(malformedOptions.text()).toContain("Remote link options response did not include an options array");
    expect(malformedOptionExit).toBe(1);
    expect(malformedOption.text()).toContain("Remote link options response included a malformed option");
  });

  it("maps remote link option API and env header errors to CLI failures", async () => {
    const badField = textBuffer();
    const badFieldExit = await runCli(
      [
        "link-options",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "title"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "BAD_REQUEST", message: "Field 'title' on Task is not a link field" }
        }, 400),
        stdout: textBuffer(),
        stderr: badField
      }
    );

    const missingEnv = textBuffer();
    const missingEnvExit = await runCli(
      [
        "link-options",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--field",
        "project",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch([], { data: { doctype: "Task", field: "project", target: "Project", options: [] } }),
        stdout: textBuffer(),
        stderr: missingEnv
      }
    );

    expect(badFieldExit).toBe(1);
    expect(badField.text()).toContain(
      "Remote link options request failed (400): BAD_REQUEST: Field 'title' on Task is not a link field"
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
