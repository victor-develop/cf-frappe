import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

const definition = { columns: [{ name: "title" }, { name: "count" }], orderBy: "count", order: "desc" };

describe("cf-frappe CLI remote report-builder", () => {
  it("parses remote report-builder commands", () => {
    expect(parseCliArgs([
      "report-builder",
      "create",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--label",
      "High counts",
      "--definition-json",
      JSON.stringify(definition),
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "report-builder",
      action: "create",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      filters: [],
      doctype: "Task",
      label: "High counts",
      definition
    });

    expect(parseCliArgs([
      "report-builder",
      "run",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_high-counts",
      "--filter",
      "priority=High",
      "--order-by",
      "count",
      "--order",
      "asc",
      "--limit",
      "5",
      "--offset",
      "10"
    ])).toEqual({
      kind: "report-builder",
      action: "run",
      url: "https://app.example",
      headers: [],
      filters: [{ name: "priority", value: "High" }],
      doctype: "Task",
      id: "report_high-counts",
      orderBy: "count",
      order: "asc",
      limit: 5,
      offset: 10
    });
  });

  it("rejects invalid remote report-builder options before fetching", () => {
    expect(parseCliArgs(["report-builder", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown report-builder command 'unknown'"
    });
    expect(parseCliArgs(["report-builder", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Report builder list requires --doctype"
    });
    expect(parseCliArgs(["report-builder", "get", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Report builder get requires --id"
    });
    expect(parseCliArgs([
      "report-builder",
      "create",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_1"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --id with report-builder create"
    });
    expect(parseCliArgs([
      "report-builder",
      "create",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--label",
      "High counts"
    ])).toEqual({
      kind: "invalid",
      message: "Report builder create requires --definition-json"
    });
    expect(parseCliArgs([
      "report-builder",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_1",
      "--filter",
      "priority=High"
    ])).toEqual({
      kind: "invalid",
      message: "Can only use --filter with report-builder run/export"
    });
    expect(parseCliArgs([
      "report-builder",
      "export",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_1",
      "--offset",
      "1"
    ])).toEqual({
      kind: "invalid",
      message: "Can only use --offset with report-builder run"
    });
  });

  it("creates, updates, lists, gets, and deletes saved reports through the generated API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const common = ["--url", "https://app.example", "--doctype", "Task"] as const;

    const createExit = await runCli([
      "report-builder",
      "create",
      ...common,
      "--label",
      "High counts",
      "--definition-json",
      JSON.stringify(definition)
    ], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, { data: savedReport({ label: "High counts" }) }, 201),
      stdout,
      stderr: textBuffer()
    });

    const listExit = await runCli(["report-builder", "list", ...common], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, { data: [savedReport({ label: "High counts" })] }),
      stdout,
      stderr: textBuffer()
    });

    const getExit = await runCli(["report-builder", "get", ...common, "--id", "report_high-counts"], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, { data: savedReport({ label: "High counts" }) }),
      stdout,
      stderr: textBuffer()
    });

    const updateExit = await runCli([
      "report-builder",
      "update",
      ...common,
      "--id",
      "report_high-counts",
      "--label",
      "Titles only",
      "--definition-json",
      JSON.stringify({ columns: [{ name: "title" }] })
    ], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, { data: savedReport({ label: "Titles only", definition: { columns: [{ name: "title" }] } }) }),
      stdout,
      stderr: textBuffer()
    });

    const deleteExit = await runCli(["report-builder", "delete", ...common, "--id", "report_high-counts"], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, "", 204, "application/json"),
      stdout,
      stderr: textBuffer()
    });

    expect([createExit, listExit, getExit, updateExit, deleteExit]).toEqual([0, 0, 0, 0, 0]);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://app.example/api/report-builder/Task",
      "GET https://app.example/api/report-builder/Task",
      "GET https://app.example/api/report-builder/Task/report_high-counts",
      "PUT https://app.example/api/report-builder/Task/report_high-counts",
      "DELETE https://app.example/api/report-builder/Task/report_high-counts"
    ]);
    expect(JSON.parse(calls[0]!.body ?? "{}")).toEqual({ label: "High counts", definition });
    expect(JSON.parse(calls[3]!.body ?? "{}")).toEqual({ label: "Titles only", definition: { columns: [{ name: "title" }] } });
    expect(stdout.text()).toContain("Saved report at https://app.example");
    expect(stdout.text()).toContain("Saved reports at https://app.example");
    expect(stdout.text()).toContain("- report_high-counts [Task] - Titles only");
    expect(stdout.text()).toContain("Deleted saved report at https://app.example");
  });

  it("runs saved reports with query filters, ordering, and pagination", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli([
      "report-builder",
      "run",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_high-counts",
      "--filter",
      "priority=High",
      "--filter-expression-json",
      '{"filter":"priority","value":"High"}',
      "--order-by",
      "count",
      "--order",
      "asc",
      "--limit",
      "5",
      "--offset",
      "10"
    ], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, {
        report: { name: "High counts", label: "High counts", doctype: "Task", source: { kind: "documents" } },
        columns: [{ name: "title" }, { name: "count" }],
        filters: [{ name: "priority", value: "High" }],
        summary: [{ name: "total_count", aggregate: "sum", value: 10 }],
        groups: [{ name: "by_priority", rows: [{ key: "High" }] }],
        charts: [{ name: "counts_by_priority", points: [{ key: "High", value: 10 }] }],
        rows: [{ title: "High A", count: 3 }],
        limit: 5,
        offset: 10,
        total: 2
      }),
      stdout,
      stderr: textBuffer()
    });

    const query = new URL(calls[0]!.url).searchParams;
    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toContain("https://app.example/api/report-builder/Task/report_high-counts/run?");
    expect(query.get("filter_priority")).toBe("High");
    expect(query.get("filter_expression")).toBe('{"filter":"priority","value":"High"}');
    expect(query.get("order_by")).toBe("count");
    expect(query.get("order")).toBe("asc");
    expect(query.get("limit")).toBe("5");
    expect(query.get("offset")).toBe("10");
    expect(stdout.text()).toContain("Saved report run at https://app.example");
    expect(stdout.text()).toContain("Rows: 1 of 2 limit=5 offset=10");
    expect(stdout.text()).toContain("- total_count sum=10");
  });

  it("exports saved report CSV through the generated API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli([
      "report-builder",
      "export",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_high-counts",
      "--filter",
      "priority=High",
      "--order-by",
      "count",
      "--order",
      "desc",
      "--limit",
      "10"
    ], {
      cwd: () => "/workspace",
      fetch: fakeFetch(calls, "Title,Count\nHigh B,7\nHigh A,3", 200, "text/csv"),
      stdout,
      stderr: textBuffer()
    });

    const query = new URL(calls[0]!.url).searchParams;
    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toContain("https://app.example/api/report-builder/Task/report_high-counts/export.csv?");
    expect(calls[0]?.headers.get("accept")).toBe("text/csv");
    expect(query.get("filter_priority")).toBe("High");
    expect(query.get("order_by")).toBe("count");
    expect(query.get("order")).toBe("desc");
    expect(query.get("limit")).toBe("10");
    expect(stdout.text()).toBe("Title,Count\nHigh B,7\nHigh A,3");
  });

  it("maps remote report-builder API errors and malformed responses to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExit = await runCli([
      "report-builder",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--id",
      "report_hidden"
    ], {
      cwd: () => "/workspace",
      fetch: fakeFetch([], { error: { code: "PERMISSION_DENIED", message: "Actor cannot read Task" } }, 403),
      stdout: textBuffer(),
      stderr: forbidden
    });

    const malformed = textBuffer();
    const malformedExit = await runCli([
      "report-builder",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ], {
      cwd: () => "/workspace",
      fetch: fakeFetch([], { data: { id: "report_high-counts" } }),
      stdout: textBuffer(),
      stderr: malformed
    });

    expect(forbiddenExit).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote report builder request failed (403): PERMISSION_DENIED: Actor cannot read Task"
    );
    expect(malformedExit).toBe(1);
    expect(malformed.text()).toContain("Remote saved reports response did not include a data array");
  });
});

interface RemoteCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

function savedReport(input: {
  readonly label: string;
  readonly definition?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: "report_high-counts",
    doctype: "Task",
    ownerId: "owner@example.com",
    label: input.label,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    definition: input.definition ?? {
      columns: [{ name: "title" }, { name: "count" }],
      filters: [{ name: "priority" }],
      summaries: [{ name: "total_count" }],
      groups: [{ name: "by_priority" }],
      charts: [{ name: "counts_by_priority" }],
      orderBy: "count",
      order: "desc"
    }
  };
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
    const body = status === 204
      ? null
      : contentType === "application/json" ? JSON.stringify(responseBody) : String(responseBody);
    return new Response(body, {
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
