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
    readonly doctypeUrl: (doctype: string, options: { readonly tenantId: string }) => string;
    readonly documentUrl: (doctype: string, name: string, options: { readonly tenantId: string }) => string;
    readonly tenantUrl: (options: { readonly tenantId: string }) => string;
    readonly url: (topic: string) => string;
  };
  readonly form: {
    readonly current: () => DeskFormRuntime | null;
    readonly on: (doctype: string, handlers: DeskFormHandlers) => void;
  };
  readonly meta: {
    readonly listView: (doctype: string) => Promise<unknown>;
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
    readonly list: (doctype: string, options: { readonly filters: Record<string, unknown> }) => Promise<unknown>;
    readonly update: (
      doctype: string,
      name: string,
      data: Record<string, unknown>,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
  };
}

interface DeskFormRuntime {
  readonly docname?: string;
  readonly doctype?: string;
  doc: Record<string, unknown>;
  validated: boolean;
  readonly dirty: () => void;
  readonly get_value: (fieldname: string) => unknown;
  readonly is_dirty: () => boolean;
  readonly is_new: () => boolean;
  readonly refresh: () => boolean;
  readonly refresh_field: (fieldname: string) => void;
  readonly save: () => boolean;
  readonly set_value: (fieldname: string, value: unknown) => Promise<unknown>;
}

type DeskFormHandlers = Record<string, (frm: DeskFormRuntime) => boolean | undefined | void>;

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

  it("maps resource list filter operators to query parameters", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.list("Task", {
      filters: {
        priority: { ne: "Low" },
        count: { gt: 2, lt: 9 },
        title: "Launch"
      }
    });

    expect(calls[0]?.url).toBe(
      "/api/resource/Task?filter_priority__ne=Low&filter_count__gt=2&filter_count__lt=9&filter_title=Launch"
    );
  });

  it("fetches resolved list-view metadata for browser filter builders", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { filterControls: [] } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.meta.listView("Task Type")).resolves.toEqual({ filterControls: [] });

    expect(calls[0]?.url).toBe("/api/meta/doctypes/Task%20Type/list-view");
    expect(calls[0]?.init.credentials).toBe("same-origin");
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
    expect(runtime.realtime.doctypeUrl("Task Type", { tenantId: "acme:west" })).toBe(
      "wss://app.example/api/realtime?topic=doctype%3Aacme%253Awest%3ATask%2520Type"
    );
    expect(runtime.realtime.tenantUrl({ tenantId: "acme:west" })).toBe(
      "wss://app.example/api/realtime?topic=tenant%3Aacme%253Awest"
    );
  });

  it("runs Frappe-style form hooks over generated form fields", async () => {
    const title = new FakeField("title", "Queued");
    const priority = new FakeField("priority", "Medium");
    const form = new FakeForm([
      title,
      priority,
      new FakeField("items[0].product", "SKU-1"),
      new FakeField("items[0].quantity", "2"),
      new FakeField("items[0].__cf_frappe_row_index", "0", "hidden"),
      new FakeField("expectedVersion", "3", "hidden")
    ]);
    const document = new FakeDocument({
      form,
      runtimeDataset: {
        doctype: "Task",
        documentName: "TASK-1",
        scope: "form",
        tenantId: "acme"
      }
    });
    const runtime = evaluateDeskClient(fetch, document);
    const events: string[] = [];

    runtime.form.on("Task", {
      refresh: (frm) => {
        events.push(`refresh:${String(frm.get_value("title"))}:${String(frm.is_new())}`);
      },
      title: (frm) => {
        events.push(`title:${String(frm.get_value("title"))}`);
        void frm.set_value("priority", "High");
      },
      validate: (frm) => {
        events.push(`validate:${String(frm.get_value("title"))}`);
        if (frm.get_value("title") === "Blocked") {
          frm.validated = false;
        }
      },
      before_save: () => {
        events.push("before_save");
      }
    });

    expect(runtime.context()).toEqual({
      doctype: "Task",
      documentName: "TASK-1",
      script: undefined,
      scope: "form",
      tenantId: "acme"
    });
    expect(events).toEqual(["refresh:Queued:false"]);
    expect(runtime.form.current()?.doc).toMatchObject({
      items: [{ product: "SKU-1", quantity: "2" }],
      title: "Queued"
    });
    expect(runtime.form.current()?.doc).not.toHaveProperty("expectedVersion");
    expect(runtime.form.current()?.doc).not.toHaveProperty("items.0.__cf_frappe_row_index");
    expect(runtime.form.current()?.doc.items).toEqual([{ product: "SKU-1", quantity: "2" }]);
    expect(runtime.form.current()?.get_value("items[0].product")).toBe("SKU-1");

    form.fields[2]!.value = "BROKEN";
    runtime.form.current()?.refresh_field("items[0].product");
    expect(form.fields[2]!.value).toBe("SKU-1");

    title.value = "In Progress";
    title.emit("change");

    expect(events).toContain("title:In Progress");
    expect(priority.value).toBe("High");
    expect(form.dataset.dirty).toBe("1");
    expect(runtime.form.current()?.is_dirty()).toBe(true);

    expect(form.emitSubmit()).toBe(false);
    expect(events.slice(-2)).toEqual(["validate:In Progress", "before_save"]);

    expect(runtime.form.current()?.save()).toBe(true);
    expect(form.submitCount).toBe(1);
    expect(events.slice(-2)).toEqual(["validate:In Progress", "before_save"]);

    title.value = "Blocked";
    title.emit("input");

    const beforeCommand = events.length;
    expect(form.emitSubmit(new FakeSubmitter("/desk/Task/TASK-1/transition/start"))).toBe(false);
    expect(events).toHaveLength(beforeCommand);

    expect(form.emitSubmit()).toBe(true);
    expect(events.at(-1)).toBe("validate:Blocked");
  });
});

function evaluateDeskClient(fetchImpl: typeof fetch = fetch, documentImpl: unknown = new FakeDocument()): DeskClientRuntime {
  const fakeWindow = {
    location: { href: "https://app.example/desk/Task/TASK-1" }
  } as { cfFrappe?: DeskClientRuntime; location: { href: string } };
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
  )(fakeWindow, fetchImpl, Headers, FormData, URLSearchParams, Blob, FakeWebSocket, documentImpl);

  if (!fakeWindow.cfFrappe) {
    throw new Error("Desk client runtime was not installed");
  }
  return fakeWindow.cfFrappe;
}

class FakeField {
  readonly listeners: Record<string, Array<() => void>> = {};
  checked = false;

  constructor(readonly name: string, public value: string, readonly type = "text") {}

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  emit(type: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener();
    }
  }
}

class FakeForm {
  readonly dataset: Record<string, string> = {};
  readonly listeners: Record<string, Array<(event: FakeSubmitEvent) => void>> = {};
  submitCount = 0;

  constructor(readonly fields: readonly FakeField[] = []) {}

  addEventListener(type: string, listener: (event: FakeSubmitEvent) => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  emitSubmit(submitter?: FakeSubmitter): boolean {
    let prevented = false;
    for (const listener of this.listeners.submit ?? []) {
      listener({
        ...(submitter === undefined ? {} : { submitter }),
        preventDefault: () => (prevented = true)
      });
    }
    return prevented;
  }

  querySelectorAll(selector: string): readonly FakeField[] {
    return selector === "[name]" ? this.fields : [];
  }

  requestSubmit(): void {
    this.submitCount += 1;
  }

  submit(): void {
    this.submitCount += 1;
  }
}

interface FakeSubmitEvent {
  readonly submitter?: FakeSubmitter;
  readonly preventDefault: () => void;
}

class FakeSubmitter {
  constructor(private readonly formAction: string | null) {}

  getAttribute(name: string): string | null {
    return name === "formaction" ? this.formAction : null;
  }
}

class FakeDocument {
  readonly currentScript = undefined;
  readonly readyState = "complete";
  private readonly form: FakeForm | undefined;
  private readonly runtime: { readonly dataset: Record<string, string> } | undefined;

  constructor(options: { readonly form?: FakeForm; readonly runtimeDataset?: Record<string, string> } = {}) {
    this.form = options.form;
    this.runtime = options.runtimeDataset ? { dataset: options.runtimeDataset } : undefined;
  }

  addEventListener(): void {}

  querySelector(selector: string): FakeForm | { readonly dataset: Record<string, string> } | null {
    if (selector === 'script[data-cf-frappe-runtime="desk"]') {
      return this.runtime ?? null;
    }
    if (selector === "form.form") {
      return this.form ?? null;
    }
    return null;
  }
}
