import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote web forms", () => {
  it("parses remote web form commands", () => {
    expect(parseCliArgs([
      "web-forms",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "web-forms",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ]
    });

    expect(parseCliArgs([
      "web-forms",
      "submit",
      "--url",
      "https://app.example",
      "--web-form",
      "Lead Intake",
      "--data-json",
      "{\"title\":\"Jane Buyer\"}"
    ])).toEqual({
      kind: "web-forms",
      action: "submit",
      url: "https://app.example",
      headers: [],
      webForm: "Lead Intake",
      data: { title: "Jane Buyer" }
    });
  });

  it("rejects invalid remote web form options before fetching", () => {
    expect(parseCliArgs(["web-forms", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown web-forms command 'unknown'"
    });
    expect(parseCliArgs(["web-forms", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["web-forms", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Web form get requires --web-form"
    });
    expect(parseCliArgs(["web-forms", "list", "--url", "https://app.example", "--web-form", "Lead Intake"])).toEqual({
      kind: "invalid",
      message: "Cannot use --web-form with web-forms list"
    });
    expect(parseCliArgs(["web-forms", "get", "--url", "https://app.example", "--web-form", "Lead Intake", "--data-json", "{}"])).toEqual({
      kind: "invalid",
      message: "Cannot use --data-json with web-forms get"
    });
  });

  it("lists and gets remote web forms through the generated metadata API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      ["web-forms", "list", "--url", "https://app.example/cf", "--header-env", "Authorization=CF_FRAPPE_AUTH"],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(listCalls, {
          data: [{ name: "Lead Intake", label: "Lead Intake", route: "lead/intake", successUrl: "/page/thanks", doctype: "Lead" }]
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe("https://app.example/cf/api/meta/web-forms");
    expect(listCalls[0]?.method).toBe("GET");
    expect(listCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(listStdout.text()).toContain("Web forms at https://app.example/cf");
    expect(listStdout.text()).toContain("- Lead Intake Lead - Lead Intake");
    expect(listStdout.text()).toContain("route:lead/intake");
    expect(listStdout.text()).toContain("success:/page/thanks");

    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      ["web-forms", "get", "--url", "https://app.example", "--web-form", "Lead Intake"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: {
            form: { name: "Lead Intake", label: "Lead Intake", route: "lead/intake", successUrl: "/page/thanks" },
            doctype: "Lead",
            fields: [{ field: "title", label: "Name", type: "text", required: true }]
          }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );

    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/meta/web-forms/Lead%20Intake");
    expect(getStdout.text()).toContain("  - title text required - Name");
    expect(getStdout.text()).toContain("route:lead/intake");
    expect(getStdout.text()).toContain("success:/page/thanks");
  });

  it("submits remote web forms", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exit = await runCli(
      [
        "web-forms",
        "submit",
        "--url",
        "https://app.example",
        "--web-form",
        "Lead Intake",
        "--data-json",
        "{\"title\":\"Jane Buyer\"}"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            form: { name: "Lead Intake", doctype: "Lead" },
            document: { doctype: "Lead", name: "Jane Buyer", version: 1 }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exit).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/web-form/Lead%20Intake/submit");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe("{\"data\":{\"title\":\"Jane Buyer\"}}");
    expect(stdout.text()).toContain("Created: Lead/Jane Buyer v1");
  });

  it("maps remote web form API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exit = await runCli(
      ["web-forms", "get", "--url", "https://app.example", "--web-form", "Missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "WEB_FORM_NOT_FOUND", message: "Web form 'Missing' is not registered" }
        }, 404),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exit).toBe(1);
    expect(stderr.text()).toContain(
      "Remote web forms request failed (404): WEB_FORM_NOT_FOUND: Web form 'Missing' is not registered"
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
