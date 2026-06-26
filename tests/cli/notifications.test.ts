import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote notifications", () => {
  it("parses remote notification inbox commands", () => {
    expect(parseCliArgs([
      "notifications",
      "list",
      "--url",
      "https://app.example",
      "--user",
      "support@example.com",
      "--limit",
      "5",
      "--unread",
      "--include-dismissed",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "notifications",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      user: "support@example.com",
      limit: 5,
      unreadOnly: true,
      includeDismissed: true
    });

    expect(parseCliArgs([
      "notifications",
      "read",
      "--url",
      "https://app.example",
      "--id",
      "evt_assign:user:support%40example.com",
      "--user",
      "support@example.com"
    ])).toEqual({
      kind: "notifications",
      action: "read",
      url: "https://app.example",
      headers: [],
      id: "evt_assign:user:support%40example.com",
      user: "support@example.com"
    });
  });

  it("rejects invalid remote notification options before fetching", () => {
    expect(parseCliArgs(["notifications", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown notifications command 'unknown'"
    });
    expect(parseCliArgs(["notifications", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["notifications", "read", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Notification read requires --id"
    });
    expect(parseCliArgs([
      "notifications",
      "list",
      "--url",
      "https://app.example",
      "--id",
      "evt_assign"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --id with notifications list"
    });
    expect(parseCliArgs([
      "notifications",
      "dismiss",
      "--url",
      "https://app.example",
      "--id",
      "evt_assign",
      "--limit",
      "5"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --limit with notifications dismiss"
    });
    expect(parseCliArgs([
      "notifications",
      "list",
      "--url",
      "https://app.example",
      "--limit",
      "0"
    ])).toEqual({
      kind: "invalid",
      message: "Notification inbox limit must be a positive integer"
    });
  });

  it("lists remote user notification inboxes through the generated API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "notifications",
        "list",
        "--url",
        "https://app.example/cf",
        "--user",
        "support@example.com",
        "--limit",
        "5",
        "--unread",
        "--include-dismissed",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            tenantId: "acme",
            userId: "support@example.com",
            limit: 5,
            unreadCount: 1,
            filters: { unreadOnly: true, includeDismissed: true },
            notifications: [
              {
                id: "evt_assign:user:support%40example.com",
                tenantId: "acme",
                recipientId: "support@example.com",
                sourceEventId: "evt_assign",
                eventType: "DocumentAssigned",
                payloadKind: "document",
                doctype: "Task",
                documentName: "TASK-1",
                actorId: "manager@example.com",
                subject: "Task assigned",
                ruleName: "Task updates",
                read: false,
                dismissed: false,
                createdAt: "2026-01-01T00:00:00.000Z"
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
      "https://app.example/cf/api/notifications?user=support%40example.com&limit=5&unread=1&include_dismissed=1"
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Notifications at https://app.example/cf");
    expect(stdout.text()).toContain("User: support@example.com Tenant: acme Limit: 5 Unread: 1");
    expect(stdout.text()).toContain("Filters: unread dismissed-included");
    expect(stdout.text()).toContain("- evt_assign:user:support%40example.com unread active Task/TASK-1 DocumentAssigned - Task assigned");
    expect(stdout.text()).toContain("  actor=manager@example.com rule=Task updates created=2026-01-01T00:00:00.000Z");
  });

  it("marks remote notifications read and dismissed through the generated API", async () => {
    const readCalls: RemoteCall[] = [];
    const readStdout = textBuffer();
    const readExit = await runCli(
      [
        "notifications",
        "read",
        "--url",
        "https://app.example",
        "--id",
        "evt_assign:user:support%40example.com",
        "--user",
        "support@example.com"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(readCalls, {
          data: {
            id: "evt_assign:user:support%40example.com",
            tenantId: "acme",
            recipientId: "support@example.com",
            sourceEventId: "evt_assign",
            eventType: "DocumentAssigned",
            payloadKind: "document",
            doctype: "Task",
            documentName: "TASK-1",
            actorId: "manager@example.com",
            subject: "Task assigned",
            read: true,
            dismissed: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            readAt: "2026-01-01T00:01:00.000Z",
            readBy: "support@example.com"
          }
        }),
        stdout: readStdout,
        stderr: textBuffer()
      }
    );

    expect(readExit).toBe(0);
    expect(readCalls[0]?.url).toBe(
      "https://app.example/api/notifications/evt_assign%3Auser%3Asupport%2540example.com/read?user=support%40example.com"
    );
    expect(readCalls[0]?.method).toBe("POST");
    expect(readStdout.text()).toContain("Read notification at https://app.example");
    expect(readStdout.text()).toContain("- evt_assign:user:support%40example.com read active Task/TASK-1 DocumentAssigned - Task assigned");

    const dismissCalls: RemoteCall[] = [];
    const dismissStdout = textBuffer();
    const dismissExit = await runCli(
      [
        "notifications",
        "dismiss",
        "--url",
        "https://app.example",
        "--id",
        "evt_assign:user:support%40example.com",
        "--user",
        "support@example.com"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(dismissCalls, {
          data: {
            id: "evt_assign:user:support%40example.com",
            tenantId: "acme",
            recipientId: "support@example.com",
            sourceEventId: "evt_assign",
            eventType: "DocumentAssigned",
            payloadKind: "document",
            doctype: "Task",
            documentName: "TASK-1",
            actorId: "manager@example.com",
            subject: "Task assigned",
            read: true,
            dismissed: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            dismissedAt: "2026-01-01T00:02:00.000Z",
            dismissedBy: "support@example.com"
          }
        }),
        stdout: dismissStdout,
        stderr: textBuffer()
      }
    );

    expect(dismissExit).toBe(0);
    expect(dismissCalls[0]?.url).toBe(
      "https://app.example/api/notifications/evt_assign%3Auser%3Asupport%2540example.com/dismiss?user=support%40example.com"
    );
    expect(dismissCalls[0]?.method).toBe("POST");
    expect(dismissStdout.text()).toContain("Dismissed notification at https://app.example");
    expect(dismissStdout.text()).toContain("- evt_assign:user:support%40example.com read dismissed Task/TASK-1 DocumentAssigned - Task assigned");
  });

  it("maps remote notification API and env header errors to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExitCode = await runCli(
      [
        "notifications",
        "list",
        "--url",
        "https://app.example",
        "--user",
        "other@example.com"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot read another user's notifications" }
        }, 403),
        stdout: textBuffer(),
        stderr: forbidden
      }
    );

    const calls: RemoteCall[] = [];
    const missingEnv = textBuffer();
    const missingEnvExit = await runCli(
      [
        "notifications",
        "list",
        "--url",
        "https://app.example",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch(calls, { data: { notifications: [] } }),
        stdout: textBuffer(),
        stderr: missingEnv
      }
    );

    expect(forbiddenExitCode).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote notifications request failed (403): PERMISSION_DENIED: Actor cannot read another user's notifications"
    );
    expect(missingEnvExit).toBe(1);
    expect(missingEnv.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
    expect(calls).toEqual([]);
  });

  it("maps malformed notification responses to CLI failures", async () => {
    const malformedListData = textBuffer();
    const malformedListDataExit = await runCli(
      ["notifications", "list", "--url", "https://app.example"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: [{ id: "evt_assign" }] }),
        stdout: textBuffer(),
        stderr: malformedListData
      }
    );

    const malformedNotifications = textBuffer();
    const malformedNotificationsExit = await runCli(
      ["notifications", "list", "--url", "https://app.example"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { notifications: "bad" } }),
        stdout: textBuffer(),
        stderr: malformedNotifications
      }
    );

    const malformedNotification = textBuffer();
    const malformedNotificationExit = await runCli(
      ["notifications", "list", "--url", "https://app.example"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { notifications: [null] } }),
        stdout: textBuffer(),
        stderr: malformedNotification
      }
    );

    const malformedRead = textBuffer();
    const malformedReadExit = await runCli(
      [
        "notifications",
        "read",
        "--url",
        "https://app.example",
        "--id",
        "evt_assign"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: [{ id: "evt_assign" }] }),
        stdout: textBuffer(),
        stderr: malformedRead
      }
    );

    expect(malformedListDataExit).toBe(1);
    expect(malformedListData.text()).toContain("Remote notification inbox response did not include a data object");
    expect(malformedNotificationsExit).toBe(1);
    expect(malformedNotifications.text()).toContain("Remote notification inbox response did not include a notifications array");
    expect(malformedNotificationExit).toBe(1);
    expect(malformedNotification.text()).toContain("Remote notification inbox response included a malformed notification");
    expect(malformedReadExit).toBe(1);
    expect(malformedRead.text()).toContain("Remote notification response did not include a data object");
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
