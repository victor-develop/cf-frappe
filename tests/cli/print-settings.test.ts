import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote print settings", () => {
  it("parses remote print settings operator commands", () => {
    expect(parseCliArgs([
      "print-settings",
      "get",
      "--url",
      "https://app.example",
      "--tenant",
      "acme/east",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "print-settings",
      action: "get",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      tenant: "acme/east"
    });

    expect(parseCliArgs([
      "print-settings",
      "update",
      "--url",
      "https://app.example",
      "--settings-json",
      '{"defaultLayout":{"pageSize":"Letter","orientation":"portrait","margins":{"topMm":12,"rightMm":11,"bottomMm":13,"leftMm":11},"font":{"family":"Inter","sizePt":10}}}',
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "print-settings",
      action: "update",
      url: "https://app.example",
      headers: [],
      settings: {
        defaultLayout: {
          pageSize: "Letter",
          orientation: "portrait",
          margins: { topMm: 12, rightMm: 11, bottomMm: 13, leftMm: 11 },
          font: { family: "Inter", sizePt: 10 }
        }
      },
      expectedVersion: 2
    });
  });

  it("rejects invalid remote print settings options before fetching", () => {
    expect(parseCliArgs(["print-settings", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown print-settings command 'unknown'"
    });
    expect(parseCliArgs(["print-settings", "get"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs([
      "print-settings",
      "update",
      "--url",
      "https://app.example"
    ])).toEqual({
      kind: "invalid",
      message: "Print settings update requires --settings-json"
    });
    expect(parseCliArgs([
      "print-settings",
      "get",
      "--url",
      "https://app.example",
      "--settings-json",
      "{}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --settings-json with print-settings get"
    });
    expect(parseCliArgs([
      "print-settings",
      "update",
      "--url",
      "https://app.example",
      "--settings-json",
      "[]"
    ])).toEqual({
      kind: "invalid",
      message: "Print settings update must be a valid JSON object"
    });
    expect(parseCliArgs([
      "print-settings",
      "update",
      "--url",
      "https://app.example",
      "--settings-json",
      '{"expectedVersion":2}'
    ])).toEqual({
      kind: "invalid",
      message: "Print settings update --settings-json cannot include expectedVersion; use --expected-version"
    });
    expect(parseCliArgs([
      "print-settings",
      "update",
      "--url",
      "https://app.example",
      "--settings-json",
      "{}",
      "--expected-version",
      "1.5"
    ])).toEqual({
      kind: "invalid",
      message: "Print settings expected version must be a non-negative integer"
    });
  });

  it("gets remote print settings through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "print-settings",
        "get",
        "--url",
        "https://app.example/cf",
        "--tenant",
        "acme/east",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            version: 2,
            settings: {
              defaultLayout: {
                pageSize: "Letter",
                orientation: "portrait",
                margins: { topMm: 12, rightMm: 11, bottomMm: 13, leftMm: 11 },
                font: { family: "Inter", sizePt: 10 }
              }
            },
            updatedAt: "2026-06-27T12:00:00.000Z"
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/print-settings?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Print settings at https://app.example/cf");
    expect(stdout.text()).toContain("Tenant: acme/east Version: 2");
    expect(stdout.text()).toContain("Updated: 2026-06-27T12:00:00.000Z");
    expect(stdout.text()).toContain(
      'Settings: {"defaultLayout":{"pageSize":"Letter","orientation":"portrait","margins":{"topMm":12,"rightMm":11,"bottomMm":13,"leftMm":11},"font":{"family":"Inter","sizePt":10}}}'
    );
  });

  it("updates remote print settings through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "print-settings",
        "update",
        "--url",
        "https://app.example",
        "--tenant",
        "acme/east",
        "--settings-json",
        '{"defaultLayout":null}',
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            version: 3,
            settings: {}
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/print-settings?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toBe(JSON.stringify({ defaultLayout: null, expectedVersion: 2 }));
    expect(stdout.text()).toContain("Updated print settings at https://app.example");
    expect(stdout.text()).toContain("Version: 3");
    expect(stdout.text()).toContain("Settings: {}");
  });

  it("maps remote print settings API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli(
      [
        "print-settings",
        "update",
        "--url",
        "https://app.example",
        "--settings-json",
        '{"unknown":"field"}'
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "BAD_REQUEST", message: "Unknown print settings field 'unknown'" }
        }, 400),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain(
      "Remote print settings request failed (400): BAD_REQUEST: Unknown print settings field 'unknown'"
    );
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
