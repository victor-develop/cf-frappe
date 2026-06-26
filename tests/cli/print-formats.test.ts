import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote print formats", () => {
  it("parses remote print metadata commands", () => {
    expect(parseCliArgs([
      "print-formats",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "print-formats",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Task"
    });

    expect(parseCliArgs([
      "print-formats",
      "get",
      "--url",
      "https://app.example",
      "--format",
      "Task Standard"
    ])).toEqual({
      kind: "print-formats",
      action: "get",
      url: "https://app.example",
      headers: [],
      format: "Task Standard"
    });

    expect(parseCliArgs([
      "print-formats",
      "letterhead",
      "--url",
      "https://app.example",
      "--letterhead",
      "Company Letterhead"
    ])).toEqual({
      kind: "print-formats",
      action: "letterhead",
      url: "https://app.example",
      headers: [],
      letterhead: "Company Letterhead"
    });
  });

  it("rejects invalid remote print metadata options before fetching", () => {
    expect(parseCliArgs(["print-formats", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown print-formats command 'unknown'"
    });
    expect(parseCliArgs(["print-formats", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["print-formats", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Print format get requires --format"
    });
    expect(parseCliArgs(["print-formats", "letterhead", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Print format letterhead requires --letterhead"
    });
    expect(parseCliArgs([
      "print-formats",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --doctype with print-formats get"
    });
    expect(parseCliArgs([
      "print-formats",
      "letterheads",
      "--url",
      "https://app.example",
      "--letterhead",
      "Company Letterhead"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --letterhead with print-formats letterheads"
    });
  });

  it("lists remote print formats through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "print-formats",
        "list",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Task",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: [
            {
              name: "Task Standard",
              label: "Task Standard",
              doctype: "Task",
              letterhead: "Company Letterhead"
            }
          ]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/print-formats?doctype=Task");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Print formats at https://app.example/cf");
    expect(stdout.text()).toContain("Total: 1");
    expect(stdout.text()).toContain("- Task Standard [Task] letterhead=Company Letterhead - Task Standard");
  });

  it("gets remote print format metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "print-formats",
        "get",
        "--url",
        "https://app.example",
        "--format",
        "Task Standard"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "Task Standard",
            doctype: "Task",
            sections: [{ fields: [{ field: "title" }] }],
            template: "<h1>{{ doc.name }}</h1>",
            layout: { pageSize: "Letter" }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/print-formats/Task%20Standard");
    expect(stdout.text()).toContain("Print format at https://app.example");
    expect(stdout.text()).toContain("- Task Standard [Task]");
    expect(stdout.text()).toContain("Sections: 1");
    expect(stdout.text()).toContain("Template: yes");
    expect(stdout.text()).toContain('Layout: {"pageSize":"Letter"}');
  });

  it("reads remote print letterhead metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "print-formats",
        "letterhead",
        "--url",
        "https://app.example",
        "--letterhead",
        "Company Letterhead"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "Company Letterhead",
            label: "Company",
            roles: ["System Manager"],
            headerHtml: "<strong>ACME</strong>"
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/print-letterheads/Company%20Letterhead");
    expect(stdout.text()).toContain("Print letterhead at https://app.example");
    expect(stdout.text()).toContain("- Company Letterhead - Company");
    expect(stdout.text()).toContain("Roles: System Manager");
    expect(stdout.text()).toContain("Header HTML: yes");
    expect(stdout.text()).toContain("Footer HTML: no");
  });

  it("lists remote print letterhead metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "print-formats",
        "letterheads",
        "--url",
        "https://app.example"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: [
            { name: "Company Letterhead", label: "Company" },
            { name: "Warehouse Letterhead" }
          ]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/print-letterheads");
    expect(stdout.text()).toContain("Print letterheads at https://app.example");
    expect(stdout.text()).toContain("Total: 2");
    expect(stdout.text()).toContain("- Company Letterhead - Company");
    expect(stdout.text()).toContain("- Warehouse Letterhead");
  });

  it("maps remote print metadata API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli(
      [
        "print-formats",
        "get",
        "--url",
        "https://app.example",
        "--format",
        "Managers Only"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot read print format" }
        }, 403),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain(
      "Remote print metadata request failed (403): PERMISSION_DENIED: Actor cannot read print format"
    );
  });

  it("rejects malformed remote print metadata list responses", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli(
      [
        "print-formats",
        "list",
        "--url",
        "https://app.example"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { name: "Task Standard" } }),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("Remote print formats response did not include a data array");
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
