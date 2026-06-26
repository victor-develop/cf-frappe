import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote audit", () => {
  it("parses remote audit operator commands", () => {
    expect(parseCliArgs([
      "audit",
      "events",
      "--url",
      "https://app.example",
      "--tenant",
      "acme/east",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--actor-id",
      "owner@example.com",
      "--kind",
      "DocumentUpdated",
      "--since",
      "2026-06-26T00:00:00.000Z",
      "--until",
      "2026-06-27T00:00:00.000Z",
      "--limit",
      "25",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "audit",
      action: "events",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      tenant: "acme/east",
      doctype: "Task",
      name: "TASK-1",
      actorId: "owner@example.com",
      eventKind: "DocumentUpdated",
      since: "2026-06-26T00:00:00.000Z",
      until: "2026-06-27T00:00:00.000Z",
      limit: 25
    });

    expect(parseCliArgs([
      "audit",
      "deleted",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1"
    ])).toEqual({
      kind: "audit",
      action: "deleted",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK-1"
    });
  });

  it("rejects invalid remote audit options before fetching", () => {
    expect(parseCliArgs(["audit", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown audit command 'unknown'"
    });
    expect(parseCliArgs(["audit", "events", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["audit", "events", "--url", "https://app.example", "--limit", "0"])).toEqual({
      kind: "invalid",
      message: "Audit limit must be a positive integer"
    });
    expect(parseCliArgs(["audit", "deleted", "--url", "https://app.example", "--name", "TASK-1"])).toEqual({
      kind: "invalid",
      message: "Audit deleted requires --doctype"
    });
    expect(parseCliArgs(["audit", "deleted", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Audit deleted requires --name"
    });
    expect(parseCliArgs([
      "audit",
      "deleted",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--kind",
      "DocumentDeleted"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --kind with audit deleted"
    });
  });

  it("searches remote audit events through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "audit",
        "events",
        "--url",
        "https://app.example/cf",
        "--tenant",
        "acme/east",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--actor-id",
        "owner@example.com",
        "--kind",
        "DocumentUpdated",
        "--since",
        "2026-06-26T00:00:00.000Z",
        "--until",
        "2026-06-27T00:00:00.000Z",
        "--limit",
        "25",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            limit: 25,
            filters: {
              doctype: "Task",
              name: "TASK-1",
              actorId: "owner@example.com",
              kind: "DocumentUpdated",
              since: "2026-06-26T00:00:00.000Z",
              until: "2026-06-27T00:00:00.000Z"
            },
            events: [
              {
                id: "evt_e2",
                sequence: 2,
                doctype: "Task",
                documentName: "TASK-1",
                actorId: "owner@example.com",
                occurredAt: "2026-06-26T12:00:00.000Z",
                payload: { kind: "DocumentUpdated", patch: { priority: "High" } },
                metadata: { requestId: "req-123" }
              },
              {
                id: "evt_e3",
                sequence: 3,
                doctype: "__UserAccounts",
                documentName: "owner@example.com",
                actorId: "admin@example.com",
                occurredAt: "2026-06-26T12:05:00.000Z",
                payload: { kind: "UserPasswordChanged", passwordHash: "[redacted]" },
                metadata: {}
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe(
      "https://app.example/cf/api/audit/events?tenant=acme%2Feast&doctype=Task&name=TASK-1&actor_id=owner%40example.com&kind=DocumentUpdated&since=2026-06-26T00%3A00%3A00.000Z&until=2026-06-27T00%3A00%3A00.000Z&limit=25"
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Audit events at https://app.example/cf");
    expect(stdout.text()).toContain("Tenant: acme/east Limit: 25 Total: 2");
    expect(stdout.text()).toContain(
      "Filters: doctype=Task name=TASK-1 actorId=owner@example.com kind=DocumentUpdated since=2026-06-26T00:00:00.000Z until=2026-06-27T00:00:00.000Z"
    );
    expect(stdout.text()).toContain(
      "- #2 evt_e2 DocumentUpdated Task/TASK-1 by owner@example.com at 2026-06-26T12:00:00.000Z"
    );
    expect(stdout.text()).toContain('  payload: {"kind":"DocumentUpdated","patch":{"priority":"High"}}');
    expect(stdout.text()).toContain('  metadata: {"requestId":"req-123"}');
    expect(stdout.text()).toContain("- #3 evt_e3 UserPasswordChanged __UserAccounts/owner@example.com");
    expect(stdout.text()).toContain('  payload: {"kind":"UserPasswordChanged","passwordHash":"[redacted]"}');
  });

  it("recovers remote deleted document audit data through the generated admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "audit",
        "deleted",
        "--url",
        "https://app.example",
        "--tenant",
        "acme/east",
        "--doctype",
        "Task",
        "--name",
        "TASK-1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme/east",
            doctype: "Task",
            name: "TASK-1",
            deletedAt: "2026-06-26T12:10:00.000Z",
            deletedBy: "owner@example.com",
            deleteEventId: "evt_e3",
            snapshot: {
              version: 3,
              docstatus: "deleted",
              data: { title: "Deleted task", priority: "High" }
            },
            events: [
              { id: "evt_e1", sequence: 1, doctype: "Task", documentName: "TASK-1", actorId: "owner@example.com", occurredAt: "2026-06-26T12:00:00.000Z", payload: { kind: "DocumentCreated", data: { title: "Deleted task" } } },
              { id: "evt_e3", sequence: 3, doctype: "Task", documentName: "TASK-1", actorId: "owner@example.com", occurredAt: "2026-06-26T12:10:00.000Z", payload: { kind: "DocumentDeleted", previousVersion: 2 }, metadata: { reason: "cleanup" } }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/audit/deleted/Task/TASK-1?tenant=acme%2Feast");
    expect(calls[0]?.method).toBe("GET");
    expect(stdout.text()).toContain("Deleted document audit at https://app.example");
    expect(stdout.text()).toContain("Document: Task/TASK-1 Tenant: acme/east");
    expect(stdout.text()).toContain("Deleted: 2026-06-26T12:10:00.000Z by owner@example.com event evt_e3");
    expect(stdout.text()).toContain("Snapshot: version 3 status deleted");
    expect(stdout.text()).toContain('Snapshot data: {"title":"Deleted task","priority":"High"}');
    expect(stdout.text()).toContain("Events: 2");
    expect(stdout.text()).toContain("- #3 evt_e3 DocumentDeleted Task/TASK-1 by owner@example.com");
    expect(stdout.text()).toContain('  payload: {"kind":"DocumentDeleted","previousVersion":2}');
    expect(stdout.text()).toContain('  metadata: {"reason":"cleanup"}');
  });

  it("maps remote audit API errors to CLI failures", async () => {
    const stderr = textBuffer();
    const exitCode = await runCli(
      [
        "audit",
        "events",
        "--url",
        "https://app.example",
        "--kind",
        "UnknownEvent"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "BAD_REQUEST", message: "Unknown audit event kind 'UnknownEvent'" }
        }, 400),
        stdout: textBuffer(),
        stderr
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain(
      "Remote audit request failed (400): BAD_REQUEST: Unknown audit event kind 'UnknownEvent'"
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
