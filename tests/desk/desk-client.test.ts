import { renderDeskClientScript } from "../../src/adapters/desk/client";

interface DeskClientRuntime {
  readonly context: (script?: { readonly dataset?: Record<string, string> }) => {
    readonly doctype?: string;
    readonly documentName?: string;
    readonly scope?: string;
    readonly script?: string;
    readonly tenantId?: string;
  };
  readonly realtime: {
    readonly documentUrl: (doctype: string, name: string, options: { readonly tenantId: string }) => string;
    readonly url: (topic: string) => string;
  };
  readonly resource: {
    readonly command: (
      doctype: string,
      name: string,
      command: string,
      input: Record<string, unknown>,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
    readonly transition: (
      doctype: string,
      name: string,
      action: string,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
    readonly update: (
      doctype: string,
      name: string,
      data: Record<string, unknown>,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
  };
}

describe("Desk client runtime", () => {
  it("wraps same-origin resource APIs with encoded JSON requests", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(
      runtime.resource.transition("Task Type", "TASK/1", "close now", { expectedVersion: 7 })
    ).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/resource/Task%20Type/TASK%2F1/transition/close%20now");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Headers).get("content-type")).toBe("application/json");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ expectedVersion: 7 }));
    expect(calls[0]?.init.credentials).toBe("same-origin");
  });

  it("keeps expected versions separate from update and command payload data", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.update("Task", "TASK-1", { title: "Queued", expectedVersion: 1 }, { expectedVersion: 8 });
    await runtime.resource.command("Task", "TASK-1", "assign", { assignee: "ops", expectedVersion: 2 }, { expectedVersion: 9 });

    expect(calls.map((call) => call.init.body)).toEqual([
      JSON.stringify({ title: "Queued", expectedVersion: 8 }),
      JSON.stringify({ assignee: "ops", expectedVersion: 9 })
    ]);
  });

  it("exposes client-script context and WebSocket realtime URLs", () => {
    const runtime = evaluateDeskClient();

    expect(
      runtime.context({
        dataset: {
          cfFrappeScript: "task-form",
          doctype: "Task",
          documentName: "TASK-1",
          scope: "form",
          tenantId: "acme"
        }
      })
    ).toEqual({
      doctype: "Task",
      documentName: "TASK-1",
      script: "task-form",
      scope: "form",
      tenantId: "acme"
    });
    expect(runtime.realtime.url("document:acme:Task:TASK-1")).toBe(
      "wss://app.example/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1"
    );
    expect(runtime.realtime.documentUrl("Task Type", "TASK:1", { tenantId: "acme:west" })).toBe(
      "wss://app.example/api/realtime?topic=document%3Aacme%253Awest%3ATask%2520Type%3ATASK%253A1"
    );
  });
});

function evaluateDeskClient(fetchImpl: typeof fetch = fetch): DeskClientRuntime {
  const fakeWindow = {
    location: { href: "https://app.example/desk/Task/TASK-1" }
  } as { cfFrappe?: DeskClientRuntime; location: { href: string } };
  const fakeDocument = { currentScript: undefined };
  const FakeWebSocket = class {
    constructor(readonly url: string) {}
  };

  new Function(
    "window",
    "fetch",
    "Headers",
    "FormData",
    "URLSearchParams",
    "Blob",
    "WebSocket",
    "document",
    renderDeskClientScript()
  )(fakeWindow, fetchImpl, Headers, FormData, URLSearchParams, Blob, FakeWebSocket, fakeDocument);

  if (!fakeWindow.cfFrappe) {
    throw new Error("Desk client runtime was not installed");
  }
  return fakeWindow.cfFrappe;
}
