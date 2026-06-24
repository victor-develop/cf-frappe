import { renderDeskClientScript } from "../../src/adapters/desk/client";
import { MAX_MULTIPART_FILE_PARTS, MIN_MULTIPART_FILE_PART_BYTES } from "../../src";

interface DeskClientRuntime {
  readonly context: (script?: { readonly dataset?: Record<string, string> }) => {
    readonly doctype?: string;
    readonly documentName?: string;
    readonly documentStatus?: string;
    readonly documentVersion?: number;
    readonly realtimeRoute?: string;
    readonly scope?: string;
    readonly script?: string;
    readonly tenantId?: string;
  };
  readonly auth: {
    readonly completeEmailVerification: (input: Record<string, unknown>) => Promise<unknown>;
    readonly completePasswordReset: (input: Record<string, unknown>) => Promise<unknown>;
    readonly login: (input: Record<string, unknown>) => Promise<unknown>;
    readonly logout: () => Promise<unknown>;
    readonly me: () => Promise<unknown>;
    readonly requestEmailVerification: (input: Record<string, unknown>) => Promise<unknown>;
    readonly requestPasswordReset: (input: Record<string, unknown>) => Promise<unknown>;
  };
  readonly accounts: {
    readonly get: (userId: string, options?: { readonly tenant?: string }) => Promise<unknown>;
    readonly syncProvider: (
      userId: string,
      input: Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
  };
  readonly audit: {
    readonly deleted: (doctype: string, name: string, options?: Record<string, unknown>) => Promise<unknown>;
    readonly events: (options?: Record<string, unknown>) => Promise<unknown>;
  };
  readonly realtime: {
    readonly doctypeUrl: (doctype: string, options: DeskRealtimeOptions) => string;
    readonly documentUrl: (doctype: string, name: string, options: DeskRealtimeOptions) => string;
    readonly subscribe: (
      topic: string,
      handlers: DeskRealtimeHandlers,
      options?: DeskRealtimeOptions
    ) => DeskRealtimeSubscription;
    readonly subscribeDoctype: (
      doctype: string,
      handlers: DeskRealtimeHandlers,
      options: DeskRealtimeOptions
    ) => DeskRealtimeSubscription;
    readonly subscribeDocument: (
      doctype: string,
      name: string,
      handlers: DeskRealtimeHandlers,
      options: DeskRealtimeOptions
    ) => DeskRealtimeSubscription;
    readonly subscribeTenant: (
      handlers: DeskRealtimeHandlers,
      options: DeskRealtimeOptions
    ) => DeskRealtimeSubscription;
    readonly subscribeUser: (
      userId: string,
      handlers: DeskRealtimeHandlers,
      options: DeskRealtimeOptions
    ) => DeskRealtimeSubscription;
    readonly presence: (topic: string, options?: DeskRealtimeOptions) => Promise<unknown>;
    readonly presenceDoctype: (doctype: string, options: DeskRealtimeOptions) => Promise<unknown>;
    readonly presenceDocument: (doctype: string, name: string, options: DeskRealtimeOptions) => Promise<unknown>;
    readonly presenceTenant: (options: DeskRealtimeOptions) => Promise<unknown>;
    readonly presenceUrl: (topic: string, options?: DeskRealtimeOptions) => string;
    readonly presenceUser: (userId: string, options: DeskRealtimeOptions) => Promise<unknown>;
    readonly tenantUrl: (options: DeskRealtimeOptions) => string;
    readonly userUrl: (userId: string, options: DeskRealtimeOptions) => string;
    readonly url: (topic: string, options?: DeskRealtimeOptions) => string;
  };
  readonly collaboration: {
    readonly fieldEditMessage: (field: string, input?: unknown) => Record<string, unknown>;
    readonly mergePlan: (
      base: Record<string, unknown>,
      remote: Record<string, unknown>,
      draft: Record<string, unknown>,
      options?: { readonly fields?: readonly string[] }
    ) => Record<string, unknown>;
    readonly sendFieldEdit: (
      subscription: DeskRealtimeSubscription,
      field: string,
      input?: unknown
    ) => Record<string, unknown>;
    readonly sendSharedDraft: (
      subscription: DeskRealtimeSubscription,
      input: Record<string, unknown>
    ) => Record<string, unknown>;
    readonly sharedDraftMessage: (input: Record<string, unknown>) => Record<string, unknown>;
  };
  readonly form: {
    readonly current: () => DeskFormRuntime | null;
    readonly on: (doctype: string, handlers: DeskFormHandlers) => void;
  };
  readonly search: (q: string, options?: { readonly limit?: number; readonly tenant?: string }) => Promise<unknown>;
  readonly msgprint: (message: unknown) => string;
  readonly "throw": (message: unknown) => never;
  readonly ui: {
    readonly msgprint: (message: unknown) => string;
  };
  readonly meta: {
    readonly doctype: (doctype: string) => Promise<unknown>;
    readonly doctypes: () => Promise<unknown>;
    readonly listView: (doctype: string) => Promise<unknown>;
    readonly reports: () => Promise<unknown>;
    readonly workspace: (workspace: string) => Promise<unknown>;
    readonly workspaces: () => Promise<unknown>;
  };
  readonly print: {
    readonly format: (format: string) => Promise<unknown>;
    readonly formats: (options?: { readonly doctype?: string }) => Promise<unknown>;
    readonly html: (format: string, name: string) => Promise<unknown>;
    readonly pdf: (format: string, name: string) => Promise<ArrayBuffer>;
    readonly pdfUrl: (format: string, name: string) => string;
    readonly settings: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly updateSettings: (input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
    readonly url: (format: string, name: string) => string;
  };
  readonly report: {
    readonly csvUrl: (report: string, options?: Record<string, unknown>) => string;
    readonly get: (report: string) => Promise<unknown>;
    readonly list: () => Promise<unknown>;
    readonly pdf: (report: string, options?: Record<string, unknown>) => Promise<ArrayBuffer>;
    readonly pdfUrl: (report: string, options?: Record<string, unknown>) => string;
    readonly run: (report: string, options?: Record<string, unknown>) => Promise<unknown>;
  };
  readonly reportBuilder: {
    readonly create: (doctype: string, input: Record<string, unknown>) => Promise<unknown>;
    readonly csvUrl: (doctype: string, id: string, options?: Record<string, unknown>) => string;
    readonly delete: (doctype: string, id: string) => Promise<unknown>;
    readonly get: (doctype: string, id: string) => Promise<unknown>;
    readonly list: (doctype: string) => Promise<unknown>;
    readonly pdf: (doctype: string, id: string, options?: Record<string, unknown>) => Promise<ArrayBuffer>;
    readonly pdfUrl: (doctype: string, id: string, options?: Record<string, unknown>) => string;
    readonly run: (doctype: string, id: string, options?: Record<string, unknown>) => Promise<unknown>;
    readonly update: (doctype: string, id: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  readonly profiles: {
    readonly get: (userId: string, options?: { readonly tenant?: string }) => Promise<unknown>;
    readonly update: (
      userId: string,
      input: Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
  };
  readonly notifications: {
    readonly dismiss: (notificationId: string, options?: { readonly user?: string }) => Promise<unknown>;
    readonly inbox: (options?: {
      readonly include_dismissed?: boolean;
      readonly includeDismissed?: boolean;
      readonly limit?: number;
      readonly unread?: boolean;
      readonly user?: string;
    }) => Promise<unknown>;
    readonly markRead: (notificationId: string, options?: { readonly user?: string }) => Promise<unknown>;
  };
  readonly notificationRules: {
    readonly clear: (
      doctype: string,
      rule: string,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
    readonly list: (doctype: string, options?: { readonly tenant?: string }) => Promise<unknown>;
    readonly save: (
      doctype: string,
      rule: Record<string, unknown> & { readonly name: string },
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
  };
  readonly roles: {
    readonly changeDescription: (
      role: string,
      input: string | Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
    readonly create: (
      role: string,
      input?: Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
    readonly disable: (role: string, options?: { readonly expectedVersion?: number; readonly tenant?: string }) => Promise<unknown>;
    readonly enable: (role: string, options?: { readonly expectedVersion?: number; readonly tenant?: string }) => Promise<unknown>;
    readonly get: (role: string, options?: { readonly tenant?: string }) => Promise<unknown>;
    readonly list: (options?: { readonly tenant?: string }) => Promise<unknown>;
  };
  readonly userPermissions: {
    readonly allow: (
      userId: string,
      grant: Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
    readonly get: (userId: string, options?: { readonly tenant?: string }) => Promise<unknown>;
    readonly revoke: (
      userId: string,
      grant: Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
  };
  readonly dataPatches: {
    readonly apply: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly applyOne: (patchId: string) => Promise<unknown>;
    readonly enqueue: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly enqueueOne: (patchId: string, options?: Record<string, unknown>) => Promise<unknown>;
    readonly plan: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly planOne: (patchId: string) => Promise<unknown>;
    readonly rollbackPlan: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly rollbackPlanOne: (patchId: string) => Promise<unknown>;
    readonly rollback: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly rollbackOne: (patchId: string) => Promise<unknown>;
    readonly rollbackEnqueue: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly rollbackEnqueueOne: (patchId: string, options?: Record<string, unknown>) => Promise<unknown>;
    readonly rollbackRetry: (patchId: string) => Promise<unknown>;
    readonly rollbackRetryEnqueue: (patchId: string, options?: Record<string, unknown>) => Promise<unknown>;
    readonly retry: (patchId: string) => Promise<unknown>;
    readonly status: () => Promise<unknown>;
  };
  readonly dashboard: {
    readonly get: (dashboard: string) => Promise<unknown>;
    readonly list: () => Promise<unknown>;
    readonly run: (dashboard: string) => Promise<unknown>;
  };
  readonly jobs: {
    readonly createSchedule: (input: Record<string, unknown>) => Promise<unknown>;
    readonly dashboard: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly deleteSchedule: (scheduleId: string) => Promise<unknown>;
    readonly disableSchedule: (scheduleId: string) => Promise<unknown>;
    readonly enableSchedule: (scheduleId: string) => Promise<unknown>;
    readonly execution: (idempotencyKey: string) => Promise<unknown>;
    readonly pauseSchedule: (scheduleId: string, pausedUntil: string) => Promise<unknown>;
    readonly resetSchedule: (scheduleId: string) => Promise<unknown>;
    readonly retry: (idempotencyKey: string) => Promise<unknown>;
    readonly runSchedule: (scheduleId: string) => Promise<unknown>;
    readonly schedules: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly updateSchedule: (scheduleId: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  readonly customFields: {
    readonly disable: (
      doctype: string,
      field: string,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
    readonly list: (doctype: string, options?: { readonly tenant?: string }) => Promise<unknown>;
    readonly save: (
      doctype: string,
      field: Record<string, unknown>,
      options?: { readonly expectedVersion?: number; readonly tenant?: string }
    ) => Promise<unknown>;
  };
  readonly files: {
    readonly bulkDelete: (files: readonly DeskBulkFileSelection[]) => Promise<unknown>;
    readonly bulkUpdateMetadata: (
      files: readonly DeskBulkFileSelection[],
      input?: Record<string, unknown>
    ) => Promise<unknown>;
    readonly abortMultipartUpload: (name: string, options?: { readonly expectedVersion?: number }) => Promise<unknown>;
    readonly completeDirectUpload: (name: string, options?: { readonly expectedVersion?: number }) => Promise<unknown>;
    readonly completeMultipartUpload: (
      name: string,
      parts: readonly { readonly partNumber: number; readonly etag: string }[],
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly contentUrl: (name: string) => string;
    readonly delete: (name: string, options?: { readonly expectedVersion?: number }) => Promise<unknown>;
    readonly generateRendition: (name: string, options?: Record<string, unknown>) => Promise<unknown>;
    readonly list: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly prepareDirectUpload: (input: Record<string, unknown>) => Promise<unknown>;
    readonly prepareMultipartUpload: (input: Record<string, unknown>) => Promise<unknown>;
    readonly previewUrl: (name: string) => string;
    readonly renditionContentUrl: (name: string, renditionId: string) => string;
    readonly transformUrl: (name: string, options?: Record<string, unknown>) => string;
    readonly updateMetadata: (
      name: string,
      input: Record<string, unknown>,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly upload: (body: Blob, options: Record<string, unknown>) => Promise<unknown>;
    readonly uploadMultipart: (body: Blob, options: Record<string, unknown>) => Promise<unknown>;
    readonly uploadMultipartPart: (
      name: string,
      partNumber: number,
      body: Blob,
      options?: { readonly size?: number }
    ) => Promise<unknown>;
  };
  readonly resource: {
    readonly activity: (
      doctype: string,
      name: string,
      input: Record<string, unknown>,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly assign: (
      doctype: string,
      name: string,
      assignee: string,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly assignments: (doctype: string, name: string) => Promise<unknown>;
    readonly bulkCancel: (doctype: string, documents: readonly DeskBulkDocumentSelection[]) => Promise<unknown>;
    readonly bulkDelete: (doctype: string, documents: readonly DeskBulkDocumentSelection[]) => Promise<unknown>;
    readonly bulkSubmit: (doctype: string, documents: readonly DeskBulkDocumentSelection[]) => Promise<unknown>;
    readonly bulkTransition: (
      doctype: string,
      action: string,
      documents: readonly DeskBulkDocumentSelection[]
    ) => Promise<unknown>;
    readonly amend: (
      doctype: string,
      name: string,
      input?: Record<string, unknown>,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly command: (
      doctype: string,
      name: string,
      command: string,
      input: Record<string, unknown>,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
    readonly comment: (
      doctype: string,
      name: string,
      input: string | Record<string, unknown>,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly duplicate: (
      doctype: string,
      name: string,
      input?: Record<string, unknown>,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly deleteSavedFilter: (doctype: string, filterId: string) => Promise<unknown>;
    readonly follow: (
      doctype: string,
      name: string,
      options?: { readonly follower?: string; readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly followers: (doctype: string, name: string) => Promise<unknown>;
    readonly csvUrl: (doctype: string, options?: Record<string, unknown>) => string;
    readonly listSavedFilters: (doctype: string) => Promise<unknown>;
    readonly saveFilter: (doctype: string, input: Record<string, unknown>) => Promise<unknown>;
    readonly share: (
      doctype: string,
      name: string,
      userId: string,
      permissions?: readonly string[],
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly shares: (doctype: string, name: string) => Promise<unknown>;
    readonly tag: (
      doctype: string,
      name: string,
      tag: string,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly tags: (doctype: string, name: string) => Promise<unknown>;
    readonly timeline: (
      doctype: string,
      name: string,
      options?: { readonly limit?: number; readonly beforeSequence?: number; readonly before_sequence?: number }
    ) => Promise<unknown>;
    readonly transition: (
      doctype: string,
      name: string,
      action: string,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
    readonly unassign: (
      doctype: string,
      name: string,
      assignee: string,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly unfollow: (
      doctype: string,
      name: string,
      follower: string,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly unshare: (
      doctype: string,
      name: string,
      userId: string,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly untag: (
      doctype: string,
      name: string,
      tag: string,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly list: (doctype: string, options: Record<string, unknown>) => Promise<unknown>;
    readonly merge: (
      doctype: string,
      name: string,
      input: {
        readonly baseVersion: number;
        readonly patch?: Record<string, unknown>;
        readonly unset?: readonly string[];
      }
    ) => Promise<unknown>;
    readonly update: (
      doctype: string,
      name: string,
      data: Record<string, unknown>,
      options: { readonly expectedVersion: number }
    ) => Promise<unknown>;
  };
}

interface DeskBulkDocumentSelection {
  readonly name: string;
  readonly expectedVersion?: number;
}

interface DeskBulkFileSelection {
  readonly name: string;
  readonly expectedVersion?: number;
}

interface DeskRealtimeHandlers {
  readonly collaboration?: (event: Record<string, unknown>, message: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly connected?: (message: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly event?: (event: Record<string, unknown>, message: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly fieldEdit?: (
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: unknown,
    subscription: DeskRealtimeSubscription
  ) => void;
  readonly malformed?: (error: Error, raw: unknown, message: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly message?: (message: unknown, messageEvent: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly open?: (event: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly close?: (event: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly error?: (event: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly notification?: (
    notification: Record<string, unknown>,
    event: Record<string, unknown>,
    message: unknown,
    subscription: DeskRealtimeSubscription
  ) => void;
  readonly presence?: (
    presence: Record<string, unknown>,
    message: unknown,
    subscription: DeskRealtimeSubscription
  ) => void;
  readonly replay?: (
    replay: Record<string, unknown>,
    message: unknown,
    subscription: DeskRealtimeSubscription
  ) => void;
  readonly sharedDraft?: (
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: unknown,
    subscription: DeskRealtimeSubscription
  ) => void;
}

interface DeskRealtimeOptions {
  readonly tenantId?: string;
  readonly protocols?: string | readonly string[];
  readonly realtimeRoute?: string;
  readonly replayAfter?: number;
  readonly replayLimit?: number;
}

interface DeskRealtimeSubscription {
  readonly socket: FakeWebSocket;
  readonly topic: string;
  readonly url: string;
  readonly close: (code?: number, reason?: string) => void;
  readonly send: (message: unknown) => unknown;
  readonly sendFieldEdit: (field: string, input?: unknown) => Record<string, unknown>;
  readonly sendSharedDraft: (input: Record<string, unknown>) => Record<string, unknown>;
}

interface DeskFormRuntime {
  readonly docname?: string;
  readonly doctype?: string;
  doc: Record<string, unknown>;
  validated: boolean;
  readonly clear_value: (fieldname: string) => Promise<unknown>;
  readonly dirty: () => void;
  readonly get_field: (fieldname: string) => FakeField | null;
  readonly get_value: (fieldname: string) => unknown;
  readonly is_dirty: () => boolean;
  readonly is_new: () => boolean;
  readonly last_merge_result?: unknown;
  readonly mergePlan: (remote?: Record<string, unknown>, draft?: Record<string, unknown>) => Record<string, unknown>;
  readonly merge_save: () => Promise<unknown>;
  readonly refresh: () => boolean;
  readonly refresh_field: (fieldname: string) => void;
  readonly save: (options?: { readonly merge?: boolean }) => boolean | Promise<unknown>;
  readonly share_draft: (input?: Record<string, unknown>) => Record<string, unknown>;
  readonly set_df_property: (fieldname: string, property: string, value: unknown) => DeskFormRuntime;
  readonly set_value: (fieldname: string, value: unknown) => Promise<unknown>;
  readonly toggle_display: (fieldname: string, show: boolean) => DeskFormRuntime;
  readonly toggle_enable: (fieldname: string, enable: boolean) => DeskFormRuntime;
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
    await runtime.resource.duplicate(
      "Task",
      "TASK-1",
      { data: { title: "Queued Copy" }, newName: "TASK-2", expectedVersion: 3 },
      { expectedVersion: 10 }
    );
    await runtime.resource.amend(
      "Task",
      "TASK-1",
      { data: { title: "Queued Rev 1" }, newName: "TASK-3", expectedVersion: 4 },
      { expectedVersion: 11 }
    );

    expect(calls.map((call) => call.init.body)).toEqual([
      JSON.stringify({ title: "Queued", expectedVersion: 8 }),
      JSON.stringify({ assignee: "ops", expectedVersion: 9 }),
      JSON.stringify({ data: { title: "Queued Copy" }, newName: "TASK-2", expectedVersion: 10 }),
      JSON.stringify({ data: { title: "Queued Rev 1" }, newName: "TASK-3", expectedVersion: 11 })
    ]);
    expect(calls[2]?.url).toBe("/api/resource/Task/TASK-1/duplicate");
    expect(calls[3]?.url).toBe("/api/resource/Task/TASK-1/amend");
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
      orderBy: "count",
      order: "desc",
      limit: 5,
      offset: 10,
      filters: {
        priority: { ne: "Low" },
        count: { gt: 2, lt: 9, not_between: [3, 8] },
        title: "Launch"
      }
    });

    expect(calls[0]?.url).toBe(
      "/api/resource/Task?order=desc&limit=5&offset=10&order_by=count&filter_priority__ne=Low&filter_count__gt=2&filter_count__lt=9&filter_count__not_between=3&filter_count__not_between=8&filter_title=Launch"
    );
    expect(
      runtime.resource.csvUrl("Task", {
        orderBy: "count",
        order: "desc",
        limit: 5,
        offset: 10,
        filters: {
          priority: { ne: "Low" },
          count: { gt: 2, lt: 9, not_between: [3, 8] },
          title: "Launch"
        }
      })
    ).toBe(
      "/api/resource/Task/export.csv?order=desc&limit=5&order_by=count&filter_priority__ne=Low&filter_count__gt=2&filter_count__lt=9&filter_count__not_between=3&filter_count__not_between=8&filter_title=Launch"
    );
  });

  it("maps resource compound filter expressions to query parameters", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" }
      });
    });
    const filterExpression = {
      kind: "group",
      match: "any",
      filters: [
        { field: "priority", value: "High" },
        { field: "count", operator: "between", value: [1, 3] }
      ]
    };
    const encoded = encodeURIComponent(JSON.stringify(filterExpression));

    await runtime.resource.list("Task", {
      filterExpression,
      filters: { workflow_state: "Open" }
    });

    expect(calls[0]?.url).toBe(
      `/api/resource/Task?filter_expression=${encoded}&filter_workflow_state=Open`
    );
    expect(runtime.resource.csvUrl("Task", { filterExpression })).toBe(
      `/api/resource/Task/export.csv?filter_expression=${encoded}`
    );
  });

  it("hydrates visual compound filter builders into canonical expression JSON", () => {
    const form = new FakeForm();
    const builder = new FakeCompoundFilterBuilder(form, {
      match: "any",
      rows: [
        new FakeCompoundFilterRow("priority", "eq", "High"),
        new FakeCompoundFilterRow("count", "between", "1, 3")
      ]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    builder.rows[1]?.value.emit("input");
    form.emitSubmit();

    expect(JSON.parse(builder.expression.value)).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { field: "priority", value: "High" },
        { field: "count", operator: "between", value: ["1", "3"] }
      ]
    });
  });

  it("hydrates report compound filter builders into report predicate JSON", () => {
    const form = new FakeForm();
    const builder = new FakeCompoundFilterBuilder(form, {
      filterExpressionKind: "report",
      match: "any",
      rows: [
        new FakeCompoundFilterRow("priority", "eq", "High"),
        new FakeCompoundFilterRow("count", "eq", "3")
      ]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    builder.rows[1]?.value.emit("input");
    form.emitSubmit();

    expect(JSON.parse(builder.expression.value)).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { filter: "priority", value: "High" },
        { filter: "count", value: "3" }
      ]
    });
  });

  it("preserves advanced nested filter JSON until visual rows change", () => {
    const nestedExpression = JSON.stringify({
      kind: "group",
      match: "all",
      filters: [
        {
          kind: "group",
          match: "any",
          filters: [{ field: "priority", value: "High" }]
        }
      ]
    });
    const form = new FakeForm();
    const row = new FakeCompoundFilterRow("", "eq", "");
    const builder = new FakeCompoundFilterBuilder(form, {
      expression: nestedExpression,
      rows: [row]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    form.emitSubmit();
    expect(builder.expression.value).toBe(nestedExpression);

    row.field.value = "priority";
    row.value.value = "Low";
    row.value.emit("input");
    form.emitSubmit();

    expect(builder.expression.value).toBe(JSON.stringify({ field: "priority", value: "Low" }));
  });

  it("does not overwrite manual advanced JSON edits with stale visual rows", () => {
    const topLevelExpression = JSON.stringify({
      kind: "group",
      match: "any",
      filters: [{ field: "priority", value: "High" }]
    });
    const nestedExpression = JSON.stringify({
      kind: "group",
      match: "all",
      filters: [
        {
          kind: "group",
          match: "any",
          filters: [{ field: "priority", value: "Low" }]
        }
      ]
    });
    const form = new FakeForm();
    const builder = new FakeCompoundFilterBuilder(form, {
      expression: topLevelExpression,
      match: "any",
      rows: [new FakeCompoundFilterRow("priority", "eq", "High")]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    builder.expression.value = nestedExpression;
    builder.expression.emit("input");
    form.emitSubmit();

    expect(builder.expression.value).toBe(nestedExpression);

    builder.rows[0]?.value.emit("input");
    builder.expression.value = nestedExpression;
    builder.expression.emit("input");
    form.emitSubmit();

    expect(builder.expression.value).toBe(nestedExpression);
  });

  it("serializes visual compound filters when only match mode changes", () => {
    const expression = JSON.stringify({
      kind: "group",
      match: "any",
      filters: [
        { field: "priority", value: "High" },
        { field: "count", operator: "between", value: ["1", "3"] }
      ]
    });
    const form = new FakeForm();
    const builder = new FakeCompoundFilterBuilder(form, {
      expression,
      match: "any",
      rows: [
        new FakeCompoundFilterRow("priority", "eq", "High"),
        new FakeCompoundFilterRow("count", "between", "1, 3")
      ]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    builder.match.value = "all";
    builder.match.emit("change");
    form.emitSubmit();

    expect(JSON.parse(builder.expression.value)).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "priority", value: "High" },
        { field: "count", operator: "between", value: ["1", "3"] }
      ]
    });
  });

  it("serializes nested visual compound filter groups", () => {
    const form = new FakeForm();
    const nestedGroup = new FakeCompoundFilterGroup({
      match: "any",
      items: [
        new FakeCompoundFilterRow("count", "between", "2, 5"),
        new FakeCompoundFilterRow("priority", "ne", "Low")
      ]
    });
    const builder = new FakeCompoundFilterBuilder(form, {
      match: "all",
      items: [new FakeCompoundFilterRow("priority", "eq", "High"), nestedGroup]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    nestedGroup.match.emit("change");
    form.emitSubmit();

    expect(JSON.parse(builder.expression.value)).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "priority", value: "High" },
        {
          kind: "group",
          match: "any",
          filters: [
            { field: "count", operator: "between", value: ["2", "5"] },
            { field: "priority", operator: "ne", value: "Low" }
          ]
        }
      ]
    });
  });

  it("adds and removes nested visual compound filter groups", () => {
    const form = new FakeForm();
    const builder = new FakeCompoundFilterBuilder(form, {
      rows: [new FakeCompoundFilterRow("priority", "eq", "High")]
    });
    evaluateDeskClient(fetch, new FakeDocument({ form, compoundFilterBuilders: [builder] }));

    builder.addGroup.click();
    const nestedGroup = builder.root.groups[0];
    expect(nestedGroup).toBeDefined();
    const nestedRow = nestedGroup?.rows[0];
    if (!nestedGroup || !nestedRow) {
      throw new Error("nested group was not added");
    }
    nestedRow.field.value = "count";
    nestedRow.operator.value = "between";
    nestedRow.value.value = "3, 7";
    nestedRow.value.emit("input");
    form.emitSubmit();

    expect(JSON.parse(builder.expression.value)).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "priority", value: "High" },
        {
          kind: "group",
          match: "all",
          filters: [{ field: "count", operator: "between", value: ["3", "7"] }]
        }
      ]
    });

    nestedGroup.removeGroupButton.click();
    form.emitSubmit();

    expect(JSON.parse(builder.expression.value)).toEqual({ field: "priority", value: "High" });
  });

  it("hydrates report formula builders with recursive nested operand controls", () => {
    const builder = new FakeReportFormulaBuilder(3);
    evaluateDeskClient(fetch, new FakeDocument({ formulaBuilders: [builder] }));

    const leftKind = builder.namedControl("formulaLeftKind");
    leftKind.value = "nested";
    leftKind.emit("change");

    expect(builder.namedControl("formulaLeftOperator").name).toBe("formulaLeftOperator");
    expect(builder.namedControl("formulaLeftLeftKind").name).toBe("formulaLeftLeftKind");
    expect(builder.namedControl("formulaLeftRightLiteral").type).toBe("number");

    const leftLeftKind = builder.namedControl("formulaLeftLeftKind");
    leftLeftKind.value = "nested";
    leftLeftKind.emit("change");

    expect(builder.namedControl("formulaLeftLeftOperator").name).toBe("formulaLeftLeftOperator");
    expect(builder.namedControl("formulaLeftLeftLeftKind").optionValues()).toEqual(["field", "literal"]);
  });

  it("treats malformed report formula field metadata as an empty field list", () => {
    const builder = new FakeReportFormulaBuilder(3);
    builder.dataset.formulaFields = "{}";
    evaluateDeskClient(fetch, new FakeDocument({ formulaBuilders: [builder] }));

    const leftKind = builder.namedControl("formulaLeftKind");
    leftKind.value = "nested";
    expect(() => leftKind.emit("change")).not.toThrow();
    expect(builder.namedControl("formulaLeftLeft").optionValues()).toEqual([""]);
  });

  it("removes nested report formula descendants when operand type changes away from nested", () => {
    const builder = new FakeReportFormulaBuilder(3);
    evaluateDeskClient(fetch, new FakeDocument({ formulaBuilders: [builder] }));

    const leftKind = builder.namedControl("formulaLeftKind");
    leftKind.value = "nested";
    leftKind.emit("change");
    const leftLeftKind = builder.namedControl("formulaLeftLeftKind");
    leftLeftKind.value = "nested";
    leftLeftKind.emit("change");

    expect(builder.querySelector('[name="formulaLeftLeftLeftKind"]')).not.toBeNull();

    leftKind.value = "field";
    leftKind.emit("change");

    expect(builder.querySelector('[name="formulaLeftOperator"]')).toBeNull();
    expect(builder.querySelector('[name="formulaLeftLeftKind"]')).toBeNull();
    expect(builder.querySelector('[name="formulaLeftLeftLeftKind"]')).toBeNull();
  });

  it("marks intentional empty resource filters in query parameters", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.list("Task", {
      filters: {
        body: "",
        title: { eq: "", ne: "Draft" }
      }
    });

    expect(calls[0]?.url).toBe(
      "/api/resource/Task?filter_body=&empty_filter=filter_body&empty_filter=filter_title&filter_title=&filter_title__ne=Draft"
    );
    expect(
      runtime.resource.csvUrl("Task", {
        filters: {
          body: "",
          title: { eq: "", ne: "Draft" }
        }
      })
    ).toBe(
      "/api/resource/Task/export.csv?filter_body=&empty_filter=filter_body&empty_filter=filter_title&filter_title=&filter_title__ne=Draft"
    );
  });

  it("maps resource membership filters to repeated query parameters", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.list("Task", {
      filters: {
        priority: { in: ["High", "Medium"] },
        title: { not_in: ["", "Draft"] }
      }
    });

    expect(calls[0]?.url).toBe(
      "/api/resource/Task?filter_priority__in=High&filter_priority__in=Medium&filter_title__not_in=&filter_title__not_in=Draft&empty_filter=filter_title__not_in"
    );
    expect(
      runtime.resource.csvUrl("Task", {
        filters: {
          priority: { in: ["High", "Medium"] },
          title: { not_in: ["", "Draft"] }
        }
      })
    ).toBe(
      "/api/resource/Task/export.csv?filter_priority__in=High&filter_priority__in=Medium&filter_title__not_in=&filter_title__not_in=Draft&empty_filter=filter_title__not_in"
    );
  });

  it("maps resource presence filters to query parameters", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.list("Task", {
      filters: {
        body: { is: "not set" }
      }
    });

    expect(calls[0]?.url).toBe("/api/resource/Task?filter_body__is=not+set");
    expect(
      runtime.resource.csvUrl("Task", {
        filters: {
          body: { is: "not set" }
        }
      })
    ).toBe("/api/resource/Task/export.csv?filter_body__is=not+set");
  });

  it("maps resource pattern filters to query parameters", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.list("Task", {
      filters: {
        title: { like: "Launch%", not_like: "%Draft%" }
      }
    });

    expect(calls[0]?.url).toBe("/api/resource/Task?filter_title__like=Launch%25&filter_title__not_like=%25Draft%25");
    expect(
      runtime.resource.csvUrl("Task", {
        filters: {
          title: { like: "Launch%", not_like: "%Draft%" }
        }
      })
    ).toBe("/api/resource/Task/export.csv?filter_title__like=Launch%25&filter_title__not_like=%25Draft%25");
  });

  it("wraps metadata-driven global search", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { data: [{ name: "TASK-1" }] } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.search("launch plan", { limit: 5, tenant: "acme" })).resolves.toEqual({
      data: [{ name: "TASK-1" }]
    });

    expect(calls[0]?.url).toBe("/api/search?q=launch+plan&limit=5&tenant=acme");
    expect(calls[0]?.init.credentials).toBe("same-origin");
  });

  it("wraps metadata dashboard APIs", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { route: String(url) } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.dashboard.list()).resolves.toEqual({ route: "/api/meta/dashboards" });
    await expect(runtime.dashboard.get("Operations Board")).resolves.toEqual({
      route: "/api/meta/dashboards/Operations%20Board"
    });
    await expect(runtime.dashboard.run("Operations Board")).resolves.toEqual({
      route: "/api/dashboard/Operations%20Board/run"
    });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/meta/dashboards",
      "GET /api/meta/dashboards/Operations%20Board",
      "GET /api/dashboard/Operations%20Board/run"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual(["same-origin", "same-origin", "same-origin"]);
  });

  it("wraps selected-document bulk resource APIs with encoded JSON requests", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });
    const documents = [
      { name: "TASK/1", expectedVersion: 2 },
      { name: "TASK-2" }
    ];

    await runtime.resource.bulkDelete("Task Type", documents);
    await runtime.resource.bulkSubmit("Task Type", documents);
    await runtime.resource.bulkCancel("Task Type", documents);
    await runtime.resource.bulkTransition("Task Type", "close now", documents);

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/resource/Task%20Type/delete",
      "POST /api/resource/Task%20Type/bulk-submit",
      "POST /api/resource/Task%20Type/bulk-cancel",
      "POST /api/resource/Task%20Type/bulk-transition/close%20now"
    ]);
    expect(calls.map((call) => (call.init.headers as Headers).get("content-type"))).toEqual([
      "application/json",
      "application/json",
      "application/json",
      "application/json"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      JSON.stringify({ documents }),
      JSON.stringify({ documents }),
      JSON.stringify({ documents }),
      JSON.stringify({ documents })
    ]);
  });

  it("wraps same-origin file metadata APIs with encoded JSON requests", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });
    const files = [
      { name: "file/1", expectedVersion: 2 },
      { name: "file-2" }
    ];

    await expect(
      runtime.files.list({
        attachedTo: { doctype: "Task Type", name: "TASK/1" },
        contentType: "text/plain",
        filename: "brief",
        isPrivate: false,
        limit: 5,
        scanStatus: "clean",
        storageState: "available",
        uploadedBy: "owner@example.com"
      })
    ).resolves.toEqual({ ok: true });
    await runtime.files.updateMetadata("file/1", { filename: "renamed.txt", expectedVersion: 1 }, { expectedVersion: 7 });
    await runtime.files.bulkDelete(files);
    await runtime.files.bulkUpdateMetadata(files, {
      attachedTo: { doctype: "Task", name: "TASK-2" },
      files: [{ name: "ignored" }],
      isPrivate: true
    });
    await runtime.files.delete("file/1", { expectedVersion: 8 });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/files?attached_to_doctype=Task+Type&attached_to_name=TASK%2F1&content_type=text%2Fplain&filename=brief&is_private=false&limit=5&scan_status=clean&storage_state=available&uploaded_by=owner%40example.com",
      "PATCH /api/files/file%2F1",
      "POST /api/files/delete",
      "POST /api/files/bulk-metadata",
      "DELETE /api/files/file%2F1?expectedVersion=8"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      JSON.stringify({ filename: "renamed.txt", expectedVersion: 7 }),
      JSON.stringify({ files }),
      JSON.stringify({ attachedTo: { doctype: "Task", name: "TASK-2" }, files, isPrivate: true }),
      undefined
    ]);
  });

  it("wraps file upload and direct-upload APIs without hiding upload instructions", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { name: "file_upload" }, object: { etag: "etag" }, upload: { url: "https://upload.example" } }), {
        headers: { "content-type": "application/json" },
        status: 201
      });
    });
    const body = new Blob(["hello"], { type: "text/plain" });

    await expect(
      runtime.files.upload(body, {
        attachedTo: { doctype: "Task Type", name: "TASK/1" },
        contentType: "text/plain",
        filename: "hello.txt",
        isPrivate: true
      })
    ).resolves.toEqual({ data: { name: "file_upload" }, object: { etag: "etag" }, upload: { url: "https://upload.example" } });
    await expect(
      runtime.files.prepareDirectUpload({
        attachedTo: { doctype: "Task Type", name: "TASK/1" },
        contentType: "text/plain",
        expiresInSeconds: 60,
        filename: "hello.txt",
        isPrivate: true,
        size: 5
      })
    ).resolves.toEqual({ data: { name: "file_upload" }, object: { etag: "etag" }, upload: { url: "https://upload.example" } });
    await runtime.files.completeDirectUpload("file/1", { expectedVersion: 3 });
    await runtime.files.generateRendition("file/1", {
      width: 64,
      format: "webp",
      watermark: {
        text: "Draft Copy",
        placement: "bottom-right",
        opacity: 75,
        color: "#123456",
        fontSize: 24
      },
      overlay: {
        file: "file/badge",
        placement: "top-left",
        opacity: 60,
        width: 32,
        height: 24
      }
    });

    expect(runtime.files.contentUrl("file/1")).toBe("/api/files/file%2F1/content");
    expect(runtime.files.previewUrl("file/1")).toBe("/api/files/file%2F1/preview");
    expect(runtime.files.renditionContentUrl("file/1", "w64-f-webp"))
      .toBe("/api/files/file%2F1/renditions/w64-f-webp/content");
    expect(runtime.files.transformUrl("file/1", {
      width: 320,
      height: 240,
      fit: "cover",
      format: "webp",
      quality: 82,
      watermark: {
        text: "Draft Copy",
        placement: "bottom-right",
        opacity: 75,
        color: "#123456",
        fontSize: 24
      },
      overlay: {
        file: "file/badge",
        placement: "top-left",
        opacity: 60,
        width: 32,
        height: 24
      }
    })).toBe("/api/files/file%2F1/transform?width=320&height=240&fit=cover&format=webp&quality=82&watermark=Draft+Copy&watermarkPlacement=bottom-right&watermarkOpacity=75&watermarkColor=%23123456&watermarkFontSize=24&overlay=file%2Fbadge&overlayPlacement=top-left&overlayOpacity=60&overlayWidth=32&overlayHeight=24");
    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/files?attached_to_doctype=Task+Type&attached_to_name=TASK%2F1&filename=hello.txt&is_private=true",
      "POST /api/files/direct-upload",
      "POST /api/files/file%2F1/complete-upload",
      "POST /api/files/file%2F1/renditions"
    ]);
    expect((calls[0]?.init.headers as Headers).get("content-type")).toBe("text/plain");
    expect(calls[0]?.init.body).toBe(body);
    expect(calls[1]?.init.body).toBe(
      JSON.stringify({
        attachedTo: { doctype: "Task Type", name: "TASK/1" },
        contentType: "text/plain",
        expiresInSeconds: 60,
        filename: "hello.txt",
        isPrivate: true,
        size: 5
      })
    );
    expect(calls[2]?.init.body).toBe(JSON.stringify({ expectedVersion: 3 }));
    expect(calls[3]?.init.body).toBe(JSON.stringify({
      width: 64,
      format: "webp",
      watermark: {
        text: "Draft Copy",
        placement: "bottom-right",
        opacity: 75,
        color: "#123456",
        fontSize: 24
      },
      overlay: {
        file: "file/badge",
        placement: "top-left",
        opacity: 60,
        width: 32,
        height: 24
      }
    }));
  });

  it("orchestrates multipart file uploads with chunk progress", async () => {
    const chunkSize = 5 * 1024 * 1024;
    const calls: Array<{
      readonly url: string;
      readonly init: RequestInit;
      readonly bodySize?: number;
      readonly bodyText?: string;
    }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      const bodyText = init?.body instanceof Blob ? undefined : init?.body?.toString();
      const bodySize = init?.body instanceof Blob ? init.body.size : undefined;
      calls.push({
        url: String(url),
        init: init ?? {},
        ...(bodySize === undefined ? {} : { bodySize }),
        ...(bodyText === undefined ? {} : { bodyText })
      });
      if (String(url) === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "file_multipart", version: 1 }, upload: { uploadId: "upload-1" } }, 201);
      }
      if (String(url).endsWith("/multipart-parts/1")) {
        return jsonResponse({ part: { partNumber: 1, etag: "etag-1" }, data: { version: 2 } });
      }
      if (String(url).endsWith("/multipart-parts/2")) {
        return jsonResponse({ part: { partNumber: 2, etag: "etag-2" }, data: { version: 3 } });
      }
      return jsonResponse({ data: { name: "file_multipart", version: 4, data: { storage_state: "available" } } });
    });
    const progress: unknown[] = [];

    await expect(
      runtime.files.uploadMultipart(new Blob([new Uint8Array(chunkSize), new Uint8Array([1])], { type: "text/plain" }), {
        attachedTo: { doctype: "Task Type", name: "TASK/1" },
        chunkSize,
        filename: "large.txt",
        isPrivate: false,
        onProgress: (event: unknown) => progress.push(event)
      })
    ).resolves.toEqual({
      data: { name: "file_multipart", version: 4, data: { storage_state: "available" } },
      upload: { uploadId: "upload-1" },
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" }
      ]
    });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/files/multipart-upload",
      "PUT /api/files/file_multipart/multipart-parts/1",
      "PUT /api/files/file_multipart/multipart-parts/2",
      "POST /api/files/file_multipart/complete-multipart-upload"
    ]);
    expect(calls.map((call) => call.bodyText)).toEqual([
      JSON.stringify({
        filename: "large.txt",
        size: chunkSize + 1,
        contentType: "text/plain",
        attached_to_doctype: "Task Type",
        attached_to_name: "TASK/1",
        isPrivate: false
      }),
      undefined,
      undefined,
      JSON.stringify({
        parts: [
          { partNumber: 1, etag: "etag-1" },
          { partNumber: 2, etag: "etag-2" }
        ],
        expectedVersion: 3
      })
    ]);
    expect(calls.map((call) => call.bodySize)).toEqual([undefined, chunkSize, 1, undefined]);
    expect((calls[1]?.init.headers as Headers).get("x-cf-frappe-part-size")).toBe(String(chunkSize));
    expect((calls[2]?.init.headers as Headers).get("x-cf-frappe-part-size")).toBe("1");
    expect(progress).toEqual([
      expect.objectContaining({ partNumber: 1, totalParts: 2, uploadedBytes: chunkSize, totalBytes: chunkSize + 1 }),
      expect.objectContaining({ partNumber: 2, totalParts: 2, uploadedBytes: chunkSize + 1, totalBytes: chunkSize + 1 })
    ]);
  });

  it("aborts multipart file uploads when part upload fails before completion", async () => {
    const chunkSize = 5 * 1024 * 1024;
    const calls: Array<{ readonly url: string; readonly init: RequestInit; readonly bodyText?: string }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      const bodyText = init?.body instanceof Blob ? await init.body.text() : init?.body?.toString();
      calls.push({ url: String(url), init: init ?? {}, ...(bodyText === undefined ? {} : { bodyText }) });
      if (String(url) === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "file_multipart", version: 1 }, upload: { uploadId: "upload-1" } }, 201);
      }
      if (String(url).endsWith("/abort-multipart-upload")) {
        return jsonResponse({ data: { name: "file_multipart", docstatus: "deleted", version: 2 } });
      }
      return jsonResponse({ error: { message: "part failed" } }, 500);
    });

    await expect(
      runtime.files.uploadMultipart(new Blob([new Uint8Array(chunkSize), new Uint8Array([1])], { type: "text/plain" }), {
        chunkSize,
        filename: "large.txt"
      })
    ).rejects.toThrow("part failed");

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/files/multipart-upload",
      "PUT /api/files/file_multipart/multipart-parts/1",
      "POST /api/files/file_multipart/abort-multipart-upload"
    ]);
    expect(calls[2]?.bodyText).toBe(JSON.stringify({ expectedVersion: 1 }));
  });

  it("rejects invalid multipart upload plans before reserving metadata", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ data: { name: "should-not-exist" } });
    });

    await expect(
      runtime.files.uploadMultipart(new Blob([new Uint8Array(MIN_MULTIPART_FILE_PART_BYTES), new Uint8Array([1])]), {
        chunkSize: MIN_MULTIPART_FILE_PART_BYTES - 1,
        filename: "too-small.bin"
      })
    ).rejects.toThrow(
      `chunkSize must be at least ${String(MIN_MULTIPART_FILE_PART_BYTES)} bytes for multi-part R2 uploads`
    );
    await expect(
      runtime.files.uploadMultipart(
        {
          name: "too-many.bin",
          size: MIN_MULTIPART_FILE_PART_BYTES * MAX_MULTIPART_FILE_PARTS + 1,
          type: "application/octet-stream",
          slice: () => new Blob()
        } as unknown as Blob,
        { chunkSize: MIN_MULTIPART_FILE_PART_BYTES }
      )
    ).rejects.toThrow(`Multipart upload cannot exceed ${String(MAX_MULTIPART_FILE_PARTS)} parts`);
    expect(calls).toEqual([]);
  });

  it("wraps same-origin auth APIs with encoded JSON requests", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url) === "/api/auth/logout") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(
      runtime.auth.login({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
    ).resolves.toEqual({ ok: true });
    await expect(runtime.auth.me()).resolves.toEqual({ ok: true });
    await expect(runtime.auth.requestPasswordReset({ userId: "owner@example.com", tenantId: "acme" })).resolves.toEqual({
      ok: true
    });
    await runtime.auth.completePasswordReset({
      userId: "owner@example.com",
      token: "reset-token",
      password: "secret-456",
      tenantId: "acme"
    });
    await runtime.auth.requestEmailVerification({ userId: "owner@example.com", tenantId: "acme" });
    await runtime.auth.completeEmailVerification({ userId: "owner@example.com", token: "email-token", tenantId: "acme" });
    await expect(runtime.auth.logout()).resolves.toBe("");

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/auth/login",
      "GET /api/auth/me",
      "POST /api/auth/password-reset/request",
      "POST /api/auth/password-reset/complete",
      "POST /api/auth/email-verification/request",
      "POST /api/auth/email-verification/complete",
      "POST /api/auth/logout"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" }),
      undefined,
      JSON.stringify({ userId: "owner@example.com", tenantId: "acme" }),
      JSON.stringify({
        userId: "owner@example.com",
        token: "reset-token",
        password: "secret-456",
        tenantId: "acme"
      }),
      JSON.stringify({ userId: "owner@example.com", tenantId: "acme" }),
      JSON.stringify({ userId: "owner@example.com", token: "email-token", tenantId: "acme" }),
      undefined
    ]);
  });

  it("wraps same-origin account provider sync APIs", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { userId: "owner@example.com" } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.accounts.get("owner@example.com", { tenant: "acme/east" })).resolves.toEqual({
      userId: "owner@example.com"
    });
    await runtime.accounts.syncProvider(
      "owner@example.com",
      {
        provider: "cloudflare-access",
        subject: "access-subject-1",
        email: "owner@example.com",
        roles: ["User"],
        expectedVersion: 1
      },
      { expectedVersion: 7, tenant: "acme/east" }
    );

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/users/owner%40example.com?tenant=acme%2Feast",
      "POST /api/users/owner%40example.com/provider-sync?tenant=acme%2Feast"
    ]);
    expect(calls[1]?.init.body).toBe(JSON.stringify({
      provider: "cloudflare-access",
      subject: "access-subject-1",
      email: "owner@example.com",
      roles: ["User"],
      expectedVersion: 7
    }));
  });

  it("wraps audit search and deleted recovery APIs without browser-side validation", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(
      runtime.audit.events({
        tenant: "acme/east",
        doctype: "Task Type",
        name: "TASK/1",
        actorId: "owner@example.com",
        kind: "DocumentUpdated",
        since: "2026-01-01T00:00:00.000Z",
        until: "2026-01-02T00:00:00.000Z",
        limit: 5
      })
    ).resolves.toEqual({ ok: true });
    await runtime.audit.events({ actor_id: "support@example.com" });
    await runtime.audit.deleted("Task Type", "TASK/1", { tenant: "acme/east" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/audit/events?tenant=acme%2Feast&doctype=Task+Type&name=TASK%2F1&actor_id=owner%40example.com&kind=DocumentUpdated&since=2026-01-01T00%3A00%3A00.000Z&until=2026-01-02T00%3A00%3A00.000Z&limit=5",
      "GET /api/audit/events?actor_id=support%40example.com",
      "GET /api/audit/deleted/Task%20Type/TASK%2F1?tenant=acme%2Feast"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual(["same-origin", "same-origin", "same-origin"]);
    expect(calls.map((call) => call.init.body)).toEqual([undefined, undefined, undefined]);
  });

  it("wraps same-origin user profile APIs with tenant and version metadata", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { profile: { fullName: "Ada Lovelace" } } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.profiles.get("owner@example.com", { tenant: "acme/east" })).resolves.toEqual({
      profile: { fullName: "Ada Lovelace" }
    });
    await runtime.profiles.update(
      "owner@example.com",
      { fullName: "Ada Lovelace", expectedVersion: 1 },
      { expectedVersion: 7, tenant: "acme/east" }
    );

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/users/owner%40example.com/profile?tenant=acme%2Feast",
      "PUT /api/users/owner%40example.com/profile?tenant=acme%2Feast"
    ]);
    expect(calls[1]?.init.body).toBe(JSON.stringify({ fullName: "Ada Lovelace", expectedVersion: 7 }));
  });

  it("wraps same-origin notification inbox and read-state APIs", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const notificationId = "evt_assign:user:support%40example.com";
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { notification: { id: notificationId } } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(
      runtime.notifications.inbox({
        includeDismissed: true,
        limit: 10,
        unread: true,
        user: "support@example.com"
      })
    ).resolves.toEqual({ notification: { id: notificationId } });
    await runtime.notifications.markRead(notificationId, { user: "support@example.com" });
    await runtime.notifications.dismiss(notificationId, { user: "support@example.com" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/notifications?user=support%40example.com&limit=10&unread=true&include_dismissed=true",
      "POST /api/notifications/evt_assign%3Auser%3Asupport%2540example.com/read?user=support%40example.com",
      "POST /api/notifications/evt_assign%3Auser%3Asupport%2540example.com/dismiss?user=support%40example.com"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual(["same-origin", "same-origin", "same-origin"]);
    expect(calls.map((call) => call.init.body)).toEqual([undefined, undefined, undefined]);
  });

  it("wraps event-sourced notification rule APIs with tenant and version metadata", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { version: 2, rules: [{ rule: { name: "Managers" } }] } }), {
        headers: { "content-type": "application/json" },
        status: (init?.method ?? "GET") === "PUT" ? 201 : 200
      });
    });
    const rule = {
      name: "Managers/Updates",
      events: ["DocumentUpdated"],
      recipients: [{ kind: "user", userId: "manager@example.com" }],
      expectedVersion: 99
    };

    await expect(runtime.notificationRules.list("Task Type", { tenant: "acme/east" })).resolves.toEqual({
      version: 2,
      rules: [{ rule: { name: "Managers" } }]
    });
    await runtime.notificationRules.save("Task Type", rule, { expectedVersion: 1, tenant: "acme/east" });
    await runtime.notificationRules.clear("Task Type", "Managers/Updates", { expectedVersion: 2, tenant: "acme/east" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/notification-rules/Task%20Type?tenant=acme%2Feast",
      "PUT /api/notification-rules/Task%20Type/Managers%2FUpdates?tenant=acme%2Feast",
      "DELETE /api/notification-rules/Task%20Type/Managers%2FUpdates?tenant=acme%2Feast"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual(["same-origin", "same-origin", "same-origin"]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      JSON.stringify({
        rule: {
          events: ["DocumentUpdated"],
          recipients: [{ kind: "user", userId: "manager@example.com" }]
        },
        expectedVersion: 1
      }),
      JSON.stringify({ expectedVersion: 2 })
    ]);
  });

  it("wraps event-sourced role catalog APIs with tenant and version metadata", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { version: 4, roles: [{ name: "Support Lead" }] } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.roles.list({ tenant: "acme/east" })).resolves.toEqual({
      version: 4,
      roles: [{ name: "Support Lead" }]
    });
    await runtime.roles.get("Support Lead", { tenant: "acme/east" });
    await runtime.roles.create(
      "Support Lead",
      { description: "Escalation owner", enabled: true, expectedVersion: 99 },
      { expectedVersion: 0, tenant: "acme/east" }
    );
    await runtime.roles.changeDescription("Support Lead", "Owns escalations", { expectedVersion: 1, tenant: "acme/east" });
    await runtime.roles.enable("Support Lead", { expectedVersion: 2, tenant: "acme/east" });
    await runtime.roles.disable("Support Lead", { expectedVersion: 3, tenant: "acme/east" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/roles?tenant=acme%2Feast",
      "GET /api/roles/Support%20Lead?tenant=acme%2Feast",
      "POST /api/roles/Support%20Lead?tenant=acme%2Feast",
      "PUT /api/roles/Support%20Lead/description?tenant=acme%2Feast",
      "POST /api/roles/Support%20Lead/enable?tenant=acme%2Feast",
      "POST /api/roles/Support%20Lead/disable?tenant=acme%2Feast"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      undefined,
      JSON.stringify({ description: "Escalation owner", enabled: true, expectedVersion: 0 }),
      JSON.stringify({ description: "Owns escalations", expectedVersion: 1 }),
      JSON.stringify({ expectedVersion: 2 }),
      JSON.stringify({ expectedVersion: 3 })
    ]);
  });

  it("wraps event-sourced custom field APIs with tenant and version metadata", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { doctype: "Task Type", version: 2, fields: [{ name: "severity" }] } }), {
        headers: { "content-type": "application/json" },
        status: (init?.method ?? "GET") === "POST" ? 201 : 200
      });
    });
    const expectedField = {
      name: "severity",
      label: "Severity",
      type: "Select",
      options: ["Low", "High"],
      inListFilter: true
    };
    const field = {
      ...expectedField,
      expectedVersion: 99
    };

    await expect(runtime.customFields.list("Task Type", { tenant: "acme/east" })).resolves.toEqual({
      doctype: "Task Type",
      version: 2,
      fields: [{ name: "severity" }]
    });
    await runtime.customFields.save("Task Type", field, { expectedVersion: 1, tenant: "acme/east" });
    await runtime.customFields.disable("Task Type", "severity/level", { expectedVersion: 2, tenant: "acme/east" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/custom-fields/Task%20Type?tenant=acme%2Feast",
      "POST /api/custom-fields/Task%20Type?tenant=acme%2Feast",
      "DELETE /api/custom-fields/Task%20Type/severity%2Flevel?tenant=acme%2Feast"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual(["same-origin", "same-origin", "same-origin"]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      JSON.stringify({ field: expectedField, expectedVersion: 1 }),
      JSON.stringify({ expectedVersion: 2 })
    ]);
  });

  it("wraps event-sourced user permission APIs with tenant and version metadata", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { userId: "owner@example.com", version: 2, grants: [] } }), {
        headers: { "content-type": "application/json" },
        status: (init?.method ?? "GET") === "POST" ? 201 : 200
      });
    });
    const expectedGrant = {
      targetDoctype: "Customer",
      targetName: "CUST/1",
      applicableDoctypes: ["Sales Order"]
    };
    const grant = {
      ...expectedGrant,
      expectedVersion: 99
    };

    await expect(runtime.userPermissions.get("owner@example.com", { tenant: "acme/east" })).resolves.toEqual({
      userId: "owner@example.com",
      version: 2,
      grants: []
    });
    await runtime.userPermissions.allow("owner@example.com", grant, { expectedVersion: 1, tenant: "acme/east" });
    await runtime.userPermissions.revoke("owner@example.com", grant, { expectedVersion: 2, tenant: "acme/east" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/user-permissions/owner%40example.com?tenant=acme%2Feast",
      "POST /api/user-permissions/owner%40example.com?tenant=acme%2Feast",
      "DELETE /api/user-permissions/owner%40example.com?tenant=acme%2Feast"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual(["same-origin", "same-origin", "same-origin"]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      JSON.stringify({ ...expectedGrant, expectedVersion: 1 }),
      JSON.stringify({ ...expectedGrant, expectedVersion: 2 })
    ]);
  });

  it("wraps journal-backed data patch APIs without browser-side validation", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" },
        status: String(url).includes("/enqueue") ? 202 : (init?.method ?? "GET") === "POST" ? 201 : 200
      });
    });

    await expect(runtime.dataPatches.status()).resolves.toEqual({ ok: true });
    await runtime.dataPatches.plan({ patchIds: ["crm.second"], limit: 2 });
    await runtime.dataPatches.apply({ limit: 1 });
    await runtime.dataPatches.planOne("crm.second");
    await runtime.dataPatches.applyOne("crm.second");
    await runtime.dataPatches.rollbackPlan({ patchIds: ["crm.second"], limit: 1 });
    await runtime.dataPatches.rollbackPlanOne("crm.second");
    await runtime.dataPatches.rollback({ limit: 1 });
    await runtime.dataPatches.rollbackOne("crm.second");
    await runtime.dataPatches.retry("crm.second");
    await runtime.dataPatches.rollbackRetry("crm.second");
    await runtime.dataPatches.enqueue({ patchIds: ["crm.second"], limit: 1, idempotencyKey: "patches:batch", delaySeconds: 5 });
    await runtime.dataPatches.enqueueOne("crm.second", {
      patchIds: ["ignored.batch"],
      limit: 1,
      idempotencyKey: "patches:single",
      delaySeconds: 10
    });
    await runtime.dataPatches.rollbackEnqueue({
      patchIds: ["crm.second"],
      limit: 1,
      idempotencyKey: "patches:rollback",
      delaySeconds: 15
    });
    await runtime.dataPatches.rollbackEnqueueOne("crm.second", {
      patchIds: ["ignored.batch"],
      limit: 1,
      idempotencyKey: "patches:rollback-single",
      delaySeconds: 20
    });
    await runtime.dataPatches.rollbackRetryEnqueue("crm.second", {
      patchIds: ["ignored.batch"],
      idempotencyKey: "patches:rollback-retry",
      delaySeconds: 25
    });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/data-patches",
      "POST /api/data-patches/plan",
      "POST /api/data-patches/apply",
      "POST /api/data-patches/crm.second/plan",
      "POST /api/data-patches/crm.second/apply",
      "POST /api/data-patches/rollback-plan",
      "POST /api/data-patches/crm.second/rollback-plan",
      "POST /api/data-patches/rollback",
      "POST /api/data-patches/crm.second/rollback",
      "POST /api/data-patches/crm.second/retry",
      "POST /api/data-patches/crm.second/rollback-retry",
      "POST /api/data-patches/enqueue",
      "POST /api/data-patches/crm.second/enqueue",
      "POST /api/data-patches/rollback-enqueue",
      "POST /api/data-patches/crm.second/rollback-enqueue",
      "POST /api/data-patches/crm.second/rollback-retry-enqueue"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      JSON.stringify({ patchIds: ["crm.second"], limit: 2 }),
      JSON.stringify({ limit: 1 }),
      undefined,
      undefined,
      JSON.stringify({ patchIds: ["crm.second"], limit: 1 }),
      undefined,
      JSON.stringify({ limit: 1 }),
      undefined,
      undefined,
      undefined,
      JSON.stringify({ patchIds: ["crm.second"], limit: 1, idempotencyKey: "patches:batch", delaySeconds: 5 }),
      JSON.stringify({ limit: 1, idempotencyKey: "patches:single", delaySeconds: 10 }),
      JSON.stringify({ patchIds: ["crm.second"], limit: 1, idempotencyKey: "patches:rollback", delaySeconds: 15 }),
      JSON.stringify({ limit: 1, idempotencyKey: "patches:rollback-single", delaySeconds: 20 }),
      JSON.stringify({ idempotencyKey: "patches:rollback-retry", delaySeconds: 25 })
    ]);
  });

  it("wraps job history and schedule APIs without browser-side validation", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" },
        status: (init?.method ?? "GET") === "POST" ? 201 : 200
      });
    });
    const schedule = {
      id: "runtime/daily",
      cron: "0 2 * * *",
      jobName: "reports.daily",
      enabled: true,
      payload: { scope: "all" },
      metadata: { source: "client" },
      delaySeconds: 30
    };
    const update = {
      id: "ignored-body-id",
      cron: "0 3 * * *",
      jobName: "reports.daily",
      enabled: false
    };

    await expect(runtime.jobs.dashboard({ jobName: "reports.daily", runId: "job/42", status: "failed", limit: 5 })).resolves.toEqual({
      ok: true
    });
    await runtime.jobs.execution("reports.daily:job/42");
    await runtime.jobs.retry("reports.daily:job/42");
    await runtime.jobs.schedules({ cron: "0 2 * * *", jobName: "reports.daily" });
    await runtime.jobs.createSchedule(schedule);
    await runtime.jobs.updateSchedule("runtime/daily", update);
    await runtime.jobs.deleteSchedule("runtime/daily");
    await runtime.jobs.runSchedule("runtime/daily");
    await runtime.jobs.enableSchedule("runtime/daily");
    await runtime.jobs.disableSchedule("runtime/daily");
    await runtime.jobs.pauseSchedule("runtime/daily", "2026-01-02T00:00:00.000Z");
    await runtime.jobs.resetSchedule("runtime/daily");

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/jobs?job=reports.daily&run_id=job%2F42&status=failed&limit=5",
      "GET /api/jobs/executions/reports.daily%3Ajob%2F42",
      "POST /api/jobs/executions/reports.daily%3Ajob%2F42/retry",
      "GET /api/jobs/schedules?cron=0+2+*+*+*&job=reports.daily",
      "POST /api/jobs/schedules",
      "PUT /api/jobs/schedules/runtime%2Fdaily",
      "DELETE /api/jobs/schedules/runtime%2Fdaily",
      "POST /api/jobs/schedules/runtime%2Fdaily/run",
      "POST /api/jobs/schedules/runtime%2Fdaily/enable",
      "POST /api/jobs/schedules/runtime%2Fdaily/disable",
      "POST /api/jobs/schedules/runtime%2Fdaily/pause",
      "POST /api/jobs/schedules/runtime%2Fdaily/reset"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      JSON.stringify(schedule),
      JSON.stringify(update),
      undefined,
      undefined,
      undefined,
      undefined,
      JSON.stringify({ pauseUntil: "2026-01-02T00:00:00.000Z" }),
      undefined
    ]);
  });

  it("wraps document collaboration and saved-filter resource APIs", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if ((init?.method ?? "GET") === "DELETE" && String(url).includes("/saved-filters/")) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await runtime.resource.timeline("Task Type", "TASK/1", { limit: 10, beforeSequence: 42 });
    await runtime.resource.comment("Task Type", "TASK/1", "Looks good", { expectedVersion: 7 });
    await runtime.resource.activity("Task Type", "TASK/1", {
      subject: "Email sent",
      detail: "Sent to customer",
      expectedVersion: 1
    }, { expectedVersion: 8 });
    await runtime.resource.assign("Task Type", "TASK/1", "support@example.com", { expectedVersion: 9 });
    await runtime.resource.assignments("Task Type", "TASK/1");
    await runtime.resource.unassign("Task Type", "TASK/1", "support@example.com", { expectedVersion: 10 });
    await runtime.resource.tag("Task Type", "TASK/1", "Urgent", { expectedVersion: 11 });
    await runtime.resource.tags("Task Type", "TASK/1");
    await runtime.resource.untag("Task Type", "TASK/1", "Needs Review", { expectedVersion: 12 });
    await runtime.resource.follow("Task Type", "TASK/1", { follower: "owner@example.com", expectedVersion: 13 });
    await runtime.resource.followers("Task Type", "TASK/1");
    await runtime.resource.unfollow("Task Type", "TASK/1", "owner@example.com", { expectedVersion: 14 });
    await runtime.resource.share("Task Type", "TASK/1", "collab@example.com", ["read", "update"], { expectedVersion: 15 });
    await runtime.resource.shares("Task Type", "TASK/1");
    await runtime.resource.unshare("Task Type", "TASK/1", "collab@example.com", { expectedVersion: 16 });
    await runtime.resource.listSavedFilters("Task Type");
    await runtime.resource.saveFilter("Task Type", {
      id: "client-ignored",
      label: "High priority",
      filters: [{ field: "priority", value: "High" }]
    });
    await runtime.resource.deleteSavedFilter("Task Type", "filter/1");
    await runtime.resource.merge("Task Type", "TASK/1", {
      baseVersion: 17,
      patch: { title: "Merged title" },
      unset: ["obsolete"]
    });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/resource/Task%20Type/TASK%2F1/timeline?limit=10&before_sequence=42",
      "POST /api/resource/Task%20Type/TASK%2F1/comments",
      "POST /api/resource/Task%20Type/TASK%2F1/activities",
      "POST /api/resource/Task%20Type/TASK%2F1/assignments",
      "GET /api/resource/Task%20Type/TASK%2F1/assignments",
      "DELETE /api/resource/Task%20Type/TASK%2F1/assignments/support%40example.com",
      "POST /api/resource/Task%20Type/TASK%2F1/tags",
      "GET /api/resource/Task%20Type/TASK%2F1/tags",
      "DELETE /api/resource/Task%20Type/TASK%2F1/tags/Needs%20Review",
      "POST /api/resource/Task%20Type/TASK%2F1/followers",
      "GET /api/resource/Task%20Type/TASK%2F1/followers",
      "DELETE /api/resource/Task%20Type/TASK%2F1/followers/owner%40example.com",
      "POST /api/resource/Task%20Type/TASK%2F1/shares",
      "GET /api/resource/Task%20Type/TASK%2F1/shares",
      "DELETE /api/resource/Task%20Type/TASK%2F1/shares/collab%40example.com",
      "GET /api/resource/Task%20Type/saved-filters",
      "POST /api/resource/Task%20Type/saved-filters",
      "DELETE /api/resource/Task%20Type/saved-filters/filter%2F1",
      "POST /api/resource/Task%20Type/TASK%2F1/merge"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      JSON.stringify({ text: "Looks good", expectedVersion: 7 }),
      JSON.stringify({ subject: "Email sent", detail: "Sent to customer", expectedVersion: 8 }),
      JSON.stringify({ assignee: "support@example.com", expectedVersion: 9 }),
      undefined,
      JSON.stringify({ expectedVersion: 10 }),
      JSON.stringify({ tag: "Urgent", expectedVersion: 11 }),
      undefined,
      JSON.stringify({ expectedVersion: 12 }),
      JSON.stringify({ follower: "owner@example.com", expectedVersion: 13 }),
      undefined,
      JSON.stringify({ expectedVersion: 14 }),
      JSON.stringify({ userId: "collab@example.com", permissions: ["read", "update"], expectedVersion: 15 }),
      undefined,
      JSON.stringify({ expectedVersion: 16 }),
      undefined,
      JSON.stringify({ label: "High priority", filters: [{ field: "priority", value: "High" }] }),
      undefined,
      JSON.stringify({ baseVersion: 17, patch: { title: "Merged title" }, unset: ["obsolete"] })
    ]);
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

  it("wraps metadata APIs for doctypes, reports, and workspaces", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { route: String(url) } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.meta.doctypes()).resolves.toEqual({ route: "/api/meta/doctypes" });
    await expect(runtime.meta.doctype("Task Type")).resolves.toEqual({ route: "/api/meta/doctypes/Task%20Type" });
    await expect(runtime.meta.reports()).resolves.toEqual({ route: "/api/meta/reports" });
    await expect(runtime.meta.workspaces()).resolves.toEqual({ route: "/api/meta/workspaces" });
    await expect(runtime.meta.workspace("Team Operations")).resolves.toEqual({ route: "/api/meta/workspaces/Team%20Operations" });

    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/meta/doctypes",
      "GET /api/meta/doctypes/Task%20Type",
      "GET /api/meta/reports",
      "GET /api/meta/workspaces",
      "GET /api/meta/workspaces/Team%20Operations"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("wraps print metadata and document routes without browser-side rendering decisions", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/pdf")) {
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" }
        });
      }
      if (String(url).startsWith("/api/print/")) {
        return new Response("<!doctype html><title>Printable</title>", {
          headers: { "content-type": "text/html" }
        });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.print.formats({ doctype: "Task Type" })).resolves.toEqual({ ok: true });
    await expect(runtime.print.format("Task Standard")).resolves.toEqual({ ok: true });
    await expect(runtime.print.html("Task Standard", "TASK/1")).resolves.toBe("<!doctype html><title>Printable</title>");
    await expect(runtime.print.pdf("Task Standard", "TASK/1")).resolves.toEqual(pdf.buffer);
    await expect(runtime.print.settings({ tenant: "acme" })).resolves.toEqual({ ok: true });
    await expect(
      runtime.print.updateSettings({ defaultLayout: { pageSize: "A4" } }, { tenant: "acme", expectedVersion: 2 })
    ).resolves.toEqual({ ok: true });

    expect(runtime.print.url("Task Standard", "TASK/1")).toBe("/api/print/Task%20Standard/TASK%2F1");
    expect(runtime.print.pdfUrl("Task Standard", "TASK/1")).toBe("/api/print/Task%20Standard/TASK%2F1/pdf");
    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/meta/print-formats?doctype=Task+Type",
      "GET /api/meta/print-formats/Task%20Standard",
      "GET /api/print/Task%20Standard/TASK%2F1",
      "GET /api/print/Task%20Standard/TASK%2F1/pdf",
      "GET /api/print-settings?tenant=acme",
      "PUT /api/print-settings?tenant=acme"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      JSON.stringify({ defaultLayout: { pageSize: "A4" }, expectedVersion: 2 })
    ]);
  });

  it("wraps report APIs and PDF rendering routes without browser-side rendering decisions", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/pdf?filter_priority=High&order_by=title&order=asc&limit=5&offset=10")) {
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" }
        });
      }
      return new Response(JSON.stringify({ data: { ok: true }, rows: [] }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.report.list()).resolves.toEqual({ ok: true });
    await expect(runtime.report.get("Open Notes")).resolves.toEqual({ ok: true });
    await expect(
      runtime.report.run("Open Notes", {
        filters: { priority: "High" },
        orderBy: "title",
        order: "asc",
        limit: 5,
        offset: 10
      })
    ).resolves.toEqual({ data: { ok: true }, rows: [] });
    await expect(
      runtime.report.pdf("Open Notes", {
        filters: { priority: "High" },
        orderBy: "title",
        order: "asc",
        limit: 5,
        offset: 10
      })
    ).resolves.toEqual(pdf.buffer);

    expect(
      runtime.report.csvUrl("Open Notes", {
        filters: { priority: "High", count_range: [2, 8] },
        order_by: "title",
        order: "desc",
        limit: 5,
        offset: 10
      })
    ).toBe("/api/report/Open%20Notes/export.csv?filter_priority=High&filter_count_range=2&filter_count_range=8&order_by=title&order=desc&limit=5");
    expect(
      runtime.report.pdfUrl("Open Notes", {
        filters: { priority: "High" },
        order_by: "title",
        order: "asc",
        limit: 5,
        offset: 10
      })
    ).toBe("/api/report/Open%20Notes/pdf?filter_priority=High&order_by=title&order=asc&limit=5&offset=10");
    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/meta/reports",
      "GET /api/meta/reports/Open%20Notes",
      "GET /api/report/Open%20Notes/run?filter_priority=High&order_by=title&order=asc&limit=5&offset=10",
      "GET /api/report/Open%20Notes/pdf?filter_priority=High&order_by=title&order=asc&limit=5&offset=10"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("maps report compound filter expressions to query parameters", () => {
    const runtime = evaluateDeskClient(async () =>
      new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "content-type": "application/json" }
      })
    );
    const filterExpression = {
      kind: "group",
      match: "any",
      filters: [
        { filter: "priority", value: "High" },
        { filter: "title", value: "Urgent" }
      ]
    };
    const encoded = encodeURIComponent(JSON.stringify(filterExpression));

    expect(runtime.report.csvUrl("Open Notes", { filterExpression })).toBe(
      `/api/report/Open%20Notes/export.csv?filter_expression=${encoded}`
    );
    expect(runtime.report.pdfUrl("Open Notes", {
      filterExpression,
      filters: { count_range: [6, 8] },
      orderBy: "count"
    })).toBe(
      `/api/report/Open%20Notes/pdf?filter_count_range=6&filter_count_range=8&filter_expression=${encoded}&order_by=count`
    );
    expect(runtime.reportBuilder.csvUrl("Task Type", "report/high-counts", { filterExpression })).toBe(
      `/api/report-builder/Task%20Type/report%2Fhigh-counts/export.csv?filter_expression=${encoded}`
    );
  });

  it("wraps saved report-builder APIs without browser-side definition validation", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const input = {
      label: "High counts",
      definition: {
        columns: [{ name: "title", field: "title" }, { name: "count", field: "count" }],
        filters: [{ name: "priority", field: "priority", defaultValue: "High" }],
        orderBy: "count",
        order: "desc"
      }
    };
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/pdf?filter_priority=High&order_by=count&order=asc&limit=5&offset=10")) {
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" }
        });
      }
      if ((init?.method ?? "GET") === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: { ok: true }, rows: [] }), {
        headers: { "content-type": "application/json" },
        status: (init?.method ?? "GET") === "POST" ? 201 : 200
      });
    });

    await expect(runtime.reportBuilder.create("Task Type", input)).resolves.toEqual({ ok: true });
    await runtime.reportBuilder.list("Task Type");
    await runtime.reportBuilder.get("Task Type", "report/high-counts");
    await runtime.reportBuilder.update("Task Type", "report/high-counts", input);
    await expect(
      runtime.reportBuilder.run("Task Type", "report/high-counts", {
        filters: { priority: "High" },
        orderBy: "count",
        order: "asc",
        limit: 5,
        offset: 10
      })
    ).resolves.toEqual({ data: { ok: true }, rows: [] });
    await expect(
      runtime.reportBuilder.pdf("Task Type", "report/high-counts", {
        filters: { priority: "High" },
        orderBy: "count",
        order: "asc",
        limit: 5,
        offset: 10
      })
    ).resolves.toEqual(pdf.buffer);
    await expect(runtime.reportBuilder.delete("Task Type", "report/high-counts")).resolves.toBe("");

    expect(
      runtime.reportBuilder.csvUrl("Task Type", "report/high-counts", {
        filters: { priority: "High", outside_count: [2, 8] },
        order_by: "count",
        order: "desc",
        limit: 5,
        offset: 10
      })
    ).toBe("/api/report-builder/Task%20Type/report%2Fhigh-counts/export.csv?filter_priority=High&filter_outside_count=2&filter_outside_count=8&order_by=count&order=desc&limit=5");
    expect(
      runtime.reportBuilder.pdfUrl("Task Type", "report/high-counts", {
        filters: { priority: "High" },
        order_by: "count",
        order: "asc",
        limit: 5,
        offset: 10
      })
    ).toBe(
      "/api/report-builder/Task%20Type/report%2Fhigh-counts/pdf?filter_priority=High&order_by=count&order=asc&limit=5&offset=10"
    );
    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/report-builder/Task%20Type",
      "GET /api/report-builder/Task%20Type",
      "GET /api/report-builder/Task%20Type/report%2Fhigh-counts",
      "PUT /api/report-builder/Task%20Type/report%2Fhigh-counts",
      "GET /api/report-builder/Task%20Type/report%2Fhigh-counts/run?filter_priority=High&order_by=count&order=asc&limit=5&offset=10",
      "GET /api/report-builder/Task%20Type/report%2Fhigh-counts/pdf?filter_priority=High&order_by=count&order=asc&limit=5&offset=10",
      "DELETE /api/report-builder/Task%20Type/report%2Fhigh-counts"
    ]);
    expect(calls.map((call) => call.init.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin",
      "same-origin"
    ]);
    expect(calls.map((call) => call.init.body)).toEqual([
      JSON.stringify(input),
      undefined,
      undefined,
      JSON.stringify(input),
      undefined,
      undefined,
      undefined
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
          documentStatus: "draft",
          documentVersion: "7",
          realtimeRoute: "/rt",
          scope: "form",
          tenantId: "acme"
        }
      })
    ).toEqual({
      doctype: "Task",
      documentName: "TASK-1",
      documentStatus: "draft",
      documentVersion: 7,
      realtimeRoute: "/rt",
      script: "task-form",
      scope: "form",
      tenantId: "acme"
    });
    expect(runtime.realtime.url("document:acme:Task:TASK-1")).toBe(
      "wss://app.example/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1"
    );
    expect(runtime.realtime.url("document:acme:Task:TASK-1", { replayAfter: 12, replayLimit: 25 })).toBe(
      "wss://app.example/api/realtime?topic=document%3Aacme%3ATask%3ATASK-1&replayAfter=12&replayLimit=25"
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
    expect(runtime.realtime.userUrl("owner@example.com", { tenantId: "acme:west" })).toBe(
      "wss://app.example/api/realtime?topic=user%3Aacme%253Awest%3Aowner%2540example.com"
    );
    expect(runtime.realtime.presenceUrl("document:acme:Task:TASK-1")).toBe(
      "/api/realtime/presence?topic=document%3Aacme%3ATask%3ATASK-1"
    );
    expect(runtime.realtime.documentUrl("Task", "TASK-1", { tenantId: "acme", realtimeRoute: "/rt" })).toBe(
      "wss://app.example/rt?topic=document%3Aacme%3ATask%3ATASK-1"
    );
    expect(runtime.realtime.presenceUrl("document:acme:Task:TASK-1", { realtimeRoute: "/rt" })).toBe(
      "/rt/presence?topic=document%3Aacme%3ATask%3ATASK-1"
    );
  });

  it("fetches authorized realtime presence snapshots for Desk collaboration surfaces", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { topic: "document:acme:Task:TASK-1", connections: [] } }), {
        headers: { "content-type": "application/json" }
      });
    });

    await expect(runtime.realtime.presenceDocument("Task", "TASK-1", { tenantId: "acme" })).resolves.toEqual({
      topic: "document:acme:Task:TASK-1",
      connections: []
    });
    await runtime.realtime.presenceDoctype("Task", { tenantId: "acme" });
    await runtime.realtime.presenceTenant({ tenantId: "acme" });
    await runtime.realtime.presenceUser("owner@example.com", { tenantId: "acme" });

    expect(calls.map((call) => call.url)).toEqual([
      "/api/realtime/presence?topic=document%3Aacme%3ATask%3ATASK-1",
      "/api/realtime/presence?topic=doctype%3Aacme%3ATask",
      "/api/realtime/presence?topic=tenant%3Aacme",
      "/api/realtime/presence?topic=user%3Aacme%3Aowner%2540example.com"
    ]);
    expect(calls.every((call) => call.init.credentials === "same-origin")).toBe(true);
  });

  it("hydrates generated document presence panels from permissioned realtime snapshots", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const panel = new FakePresencePanel({
      doctype: "Task",
      documentName: "TASK-1",
      realtimeRoute: "/rt",
      tenantId: "acme"
    });

    evaluateDeskClient(
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          data: {
            topic: "document:acme:Task:TASK-1",
            connections: [
              { connectionId: "conn-1", userId: "owner@example.com" },
              { connectionId: "conn-2", userId: "owner@example.com" },
              { connectionId: "conn-3", userId: "support@example.com" }
            ]
          }
        }), {
          headers: { "content-type": "application/json" }
        });
      },
      new FakeDocument({ presencePanels: [panel] })
    );
    await flushPromises();

    expect(calls.map((call) => call.url)).toEqual([
      "/rt/presence?topic=document%3Aacme%3ATask%3ATASK-1"
    ]);
    expect(calls[0]?.init.credentials).toBe("same-origin");
    expect(panel.dataset.presenceState).toBe("ready");
    expect(panel.count.textContent).toBe("2 active collaborators");
    expect(panel.list.textContent).toBe("owner@example.com, support@example.com");
  });

  it("keeps generated document presence panels live with realtime presence messages", async () => {
    const sockets: FakeWebSocket[] = [];
    const panel = new FakePresencePanel({
      doctype: "Task Type",
      documentName: "TASK/1",
      realtimeRoute: "/rt",
      tenantId: "acme:west"
    });

    evaluateDeskClient(
      async () =>
        new Response(JSON.stringify({
          data: {
            topic: "document:acme%3Awest:Task%20Type:TASK%2F1",
            connections: [{ connectionId: "conn-1", userId: "owner@example.com" }]
          }
        }), {
          headers: { "content-type": "application/json" }
        }),
      new FakeDocument({ presencePanels: [panel] }),
      sockets
    );
    await flushPromises();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe(
      "wss://app.example/rt?topic=document%3Aacme%253Awest%3ATask%2520Type%3ATASK%252F1"
    );
    expect(panel.dataset.presenceState).toBe("ready");
    expect(panel.count.textContent).toBe("1 active collaborator");
    expect(panel.list.textContent).toBe("owner@example.com");

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "join",
        topic: "document:acme%3Awest:Task%20Type:TASK%2F1",
        connections: [
          { connectionId: "conn-1", userId: "owner@example.com" },
          { connectionId: "conn-2", userId: "support@example.com" },
          { connectionId: "conn-3", userId: "support@example.com" }
        ]
      }
    }));

    expect(panel.dataset.presenceState).toBe("live");
    expect(panel.count.textContent).toBe("2 active collaborators");
    expect(panel.list.textContent).toBe("owner@example.com, support@example.com");
  });

  it("marks generated document presence panels stale when document realtime events advance the version", async () => {
    const sockets: FakeWebSocket[] = [];
    const title = new FakeField("title", "Queued");
    const body = new FakeField("body", "Base body");
    const expectedVersion = new FakeField("expectedVersion", "3", "hidden");
    const form = new FakeForm([title, body, expectedVersion]);
    const panel = new FakePresencePanel({
      doctype: "Task",
      documentName: "TASK-1",
      documentVersion: "3",
      realtimeRoute: "/rt",
      tenantId: "acme"
    });
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];

    evaluateDeskClient(
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        if (init?.method === "POST" && String(url).endsWith("/merge")) {
          return jsonResponse({
            data: {
              status: "applied",
              plan: { status: "clean", baseVersion: 3, remoteVersion: 4, patch: { body: "Local body" }, unset: [] },
              document: {
                tenantId: "acme",
                doctype: "Task",
                name: "TASK-1",
                version: 5,
                docstatus: "draft",
                data: { title: "Queued", body: "Local body" },
                createdAt: "now",
                updatedAt: "now"
              }
            }
          });
        }
        return new Response(JSON.stringify({
          data: {
            topic: "document:acme:Task:TASK-1",
            connections: []
          }
        }), {
          headers: { "content-type": "application/json" }
        });
      },
      new FakeDocument({
        form,
        presencePanels: [panel],
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          documentVersion: "3",
          scope: "form",
          tenantId: "acme"
        }
      }),
      sockets
    );
    await flushPromises();

    expect(panel.update.textContent).toBe("Viewing latest saved version.");
    expect(form.dataset.remoteUpdate).toBeUndefined();
    expect(panel.merge.hidden).toBe(true);

    body.value = "Local body";
    body.emit("input");
    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.event",
      cursor: 9,
      event: {
        id: "event-9",
        type: "TaskUpdated",
        payload: {
          snapshot: {
            version: 4
          }
        }
      }
    }));

    expect(panel.dataset.documentState).toBe("stale");
    expect(panel.dataset.remoteVersion).toBe("4");
    expect(panel.update.textContent).toBe("Document updated to v4. Refresh to review latest changes.");
    expect(form.dataset.remoteUpdate).toBe("1");
    expect(panel.merge.hidden).toBe(false);
    expect(panel.merge.disabled).toBe(false);
    expect(panel.merge.textContent).toBe("Merge saved changes");

    panel.merge.click();
    expect(panel.merge.disabled).toBe(true);
    expect(panel.update.textContent).toBe("Merging saved changes.");
    await flushPromises();

    expect(calls.at(-1)).toMatchObject({
      url: "/api/resource/Task/TASK-1/merge",
      init: {
        method: "POST",
        body: JSON.stringify({ baseVersion: 3, patch: { body: "Local body" } })
      }
    });
    expect(panel.dataset.documentState).toBe("merged");
    expect(panel.dataset.documentVersion).toBe("5");
    expect(panel.update.textContent).toBe("Merged saved changes at v5.");
    expect(panel.merge.hidden).toBe(true);
    expect(expectedVersion.value).toBe("5");
  });

  it("does not report validation-blocked presence panel merges as conflicts", async () => {
    const sockets: FakeWebSocket[] = [];
    const form = new FakeForm([
      new FakeField("title", "Blocked"),
      new FakeField("expectedVersion", "3", "hidden")
    ]);
    const panel = new FakePresencePanel({
      doctype: "Task",
      documentName: "TASK-1",
      documentVersion: "3",
      realtimeRoute: "/rt",
      tenantId: "acme"
    });
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const runtime = evaluateDeskClient(
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({
          data: {
            topic: "document:acme:Task:TASK-1",
            connections: []
          }
        });
      },
      new FakeDocument({
        form,
        presencePanels: [panel],
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          documentVersion: "3",
          scope: "form",
          tenantId: "acme"
        }
      }),
      sockets
    );
    runtime.form.on("Task", {
      validate: (frm) => {
        if (frm.get_value("title") === "Blocked") {
          frm.validated = false;
        }
      }
    });
    await flushPromises();

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.event",
      cursor: 10,
      event: {
        id: "event-10",
        type: "TaskUpdated",
        payload: {
          snapshot: {
            version: 4,
            data: { title: "Remote" }
          }
        }
      }
    }));
    panel.merge.click();
    await flushPromises();

    expect(calls.filter((call) => call.init.method === "POST" && call.url.endsWith("/merge"))).toHaveLength(0);
    expect(panel.dataset.documentState).toBe("validation-blocked");
    expect(panel.update.textContent).toBe("Fix validation errors before merging saved changes.");
    expect(panel.merge.hidden).toBe(false);
    expect(panel.merge.disabled).toBe(false);
    expect(panel.merge.textContent).toBe("Try merge again");
  });

  it("parses realtime subscriptions into events and redacted user notifications", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);
    const seen: string[] = [];
    const subscription = runtime.realtime.subscribeUser("owner@example.com", {
      connected: (message, sub) => {
        seen.push(`connected:${String((message as { topic?: string }).topic)}:${sub.topic}`);
      },
      event: (event, message, sub) => {
        seen.push(`event:${String(event.type)}:${String((message as { readonly cursor?: number }).cursor)}:${sub.url}`);
      },
      notification: (notification, event) => {
        seen.push(`notification:${String(notification.recipientId)}:${String(event.id)}`);
      },
      replay: (replay, _message, sub) => {
        seen.push(`replay:${String(replay.nextCursor)}:${sub.topic}`);
      },
      presence: (presence, _message, sub) => {
        const connections = presence.connections as Array<{ readonly userId?: string }>;
        seen.push(`presence:${String(presence.action)}:${String(connections[0]?.userId)}:${sub.topic}`);
      },
      message: (message) => {
        seen.push(`message:${String((message as { type?: string }).type)}`);
      },
      malformed: (error, raw) => {
        seen.push(`malformed:${error.name}:${String(raw)}`);
      }
    }, { tenantId: "acme", protocols: ["cf-frappe.realtime.v1"] });

    expect(subscription.topic).toBe("user:acme:owner%40example.com");
    expect(subscription.url).toBe("wss://app.example/api/realtime?topic=user%3Aacme%3Aowner%2540example.com");
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe(subscription.url);
    expect(sockets[0]?.protocols).toEqual(["cf-frappe.realtime.v1"]);

    sockets[0]?.emitMessage(JSON.stringify({ type: "cf-frappe.realtime.connected", topic: subscription.topic }));
    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.event",
      cursor: 1,
      event: {
        id: "evt1:user:owner%40example.com",
        type: "NoteAssigned",
        payload: {
          kind: "DocumentUserNotification",
          recipientId: "owner@example.com"
        }
      }
    }));
    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.replay",
      replay: {
        topic: subscription.topic,
        events: [
          {
            cursor: 2,
            event: {
              id: "evt2:user:owner%40example.com",
              type: "NoteFollowed",
              payload: {
                kind: "DocumentUserNotification",
                recipientId: "owner@example.com"
              }
            }
          }
        ],
        nextCursor: 2
      }
    }));
    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "join",
        topic: subscription.topic,
        connections: [{ userId: "owner@example.com" }]
      }
    }));
    sockets[0]?.emitMessage("{");
    subscription.close(1000, "done");

    expect(seen).toEqual([
      `message:cf-frappe.realtime.connected`,
      `connected:user:acme:owner%40example.com:user:acme:owner%40example.com`,
      `message:cf-frappe.realtime.event`,
      `event:NoteAssigned:1:wss://app.example/api/realtime?topic=user%3Aacme%3Aowner%2540example.com`,
      `notification:owner@example.com:evt1:user:owner%40example.com`,
      `message:cf-frappe.realtime.replay`,
      `replay:2:user:acme:owner%40example.com`,
      `event:NoteFollowed:2:wss://app.example/api/realtime?topic=user%3Aacme%3Aowner%2540example.com`,
      `notification:owner@example.com:evt2:user:owner%40example.com`,
      `message:cf-frappe.realtime.presence`,
      `presence:join:owner@example.com:user:acme:owner%40example.com`,
      "malformed:SyntaxError:{"
    ]);
    expect(sockets[0]?.closed).toEqual({ code: 1000, reason: "done" });
  });

  it("parses realtime collaboration field-edit messages for document subscriptions", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);
    const seen: string[] = [];
    const subscription = runtime.realtime.subscribeDocument("Task", "TASK-1", {
      collaboration: (event, _message, sub) => {
        seen.push(`collaboration:${String(event.type)}:${sub.topic}`);
      },
      fieldEdit: (payload, event, _message, sub) => {
        seen.push(
          `field:${String(payload.actorId)}:${String(payload.field)}:${String(payload.editing)}:${String(event.id)}:${sub.url}`
        );
      },
      message: (message) => {
        seen.push(`message:${String((message as { readonly type?: string }).type)}`);
      }
    }, { tenantId: "acme" });

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.collaboration",
      event: {
        id: "edit-1",
        type: "DocumentFieldEditIntent",
        payload: {
          kind: "DocumentFieldEditIntent",
          field: "title",
          editing: true,
          connectionId: "conn-1",
          actorId: "support@example.com"
        }
      }
    }));

    expect(seen).toEqual([
      "message:cf-frappe.realtime.collaboration",
      "collaboration:DocumentFieldEditIntent:document:acme:Task:TASK-1",
      `field:support@example.com:title:true:edit-1:${subscription.url}`
    ]);
  });

  it("parses realtime shared draft patch messages for document subscriptions", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);
    const seen: string[] = [];
    const subscription = runtime.realtime.subscribeDocument("Task", "TASK-1", {
      collaboration: (event, _message, sub) => {
        seen.push(`collaboration:${String(event.type)}:${sub.topic}`);
      },
      sharedDraft: (payload, event, _message, sub) => {
        const patch = payload.patch as { readonly title?: string };
        const unset = payload.unset as readonly string[];
        seen.push(
          `draft:${String(payload.actorId)}:${String(payload.baseVersion)}:${String(patch.title)}:${unset.join(",")}:${String(event.id)}:${sub.url}`
        );
      },
      message: (message) => {
        seen.push(`message:${String((message as { readonly type?: string }).type)}`);
      }
    }, { tenantId: "acme" });

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.collaboration",
      event: {
        id: "draft-1",
        type: "DocumentSharedDraftPatch",
        payload: {
          kind: "DocumentSharedDraftPatch",
          baseVersion: 3,
          patch: { title: "Draft title" },
          unset: ["obsolete"],
          connectionId: "conn-1",
          actorId: "support@example.com"
        }
      }
    }));

    expect(seen).toEqual([
      "message:cf-frappe.realtime.collaboration",
      "collaboration:DocumentSharedDraftPatch:document:acme:Task:TASK-1",
      `draft:support@example.com:3:Draft title:obsolete:draft-1:${subscription.url}`
    ]);
  });

  it("sends transient field-edit collaboration messages over realtime subscriptions", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);
    const subscription = runtime.realtime.subscribeDocument("Task", "TASK-1", {}, { tenantId: "acme" });

    expect(runtime.collaboration.fieldEditMessage(" title ", { editing: true, value: "Queued" })).toEqual({
      type: "cf-frappe.collaboration.field_edit",
      field: "title",
      editing: true,
      value: "Queued"
    });
    expect(runtime.collaboration.sendFieldEdit(subscription, " title ", { editing: true, value: "Queued" })).toEqual({
      type: "cf-frappe.collaboration.field_edit",
      field: "title",
      editing: true,
      value: "Queued"
    });
    expect(sockets[0]?.sent).toEqual([
      JSON.stringify({
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true,
        value: "Queued"
      })
    ]);
  });

  it("sends explicit shared draft patches over realtime subscriptions", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);
    const subscription = runtime.realtime.subscribeDocument("Task", "TASK-1", {}, { tenantId: "acme" });

    expect(runtime.collaboration.sharedDraftMessage({
      baseVersion: 3,
      patch: { title: "Draft title" },
      unset: ["obsolete"]
    })).toEqual({
      type: "cf-frappe.collaboration.shared_draft",
      baseVersion: 3,
      patch: { title: "Draft title" },
      unset: ["obsolete"]
    });
    expect(runtime.collaboration.sendSharedDraft(subscription, {
      baseVersion: 3,
      patch: { title: "Draft title" },
      unset: ["obsolete"]
    })).toEqual({
      type: "cf-frappe.collaboration.shared_draft",
      baseVersion: 3,
      patch: { title: "Draft title" },
      unset: ["obsolete"]
    });
    expect(sockets[0]?.sent).toEqual([
      JSON.stringify({
        type: "cf-frappe.collaboration.shared_draft",
        baseVersion: 3,
        patch: { title: "Draft title" },
        unset: ["obsolete"]
      })
    ]);
  });

  it("plans field-level document merges for client scripts", () => {
    const runtime = evaluateDeskClient();

    expect(
      runtime.collaboration.mergePlan(
        { version: 1, docstatus: "draft", data: { title: "Queued", body: "Draft" } },
        { version: 2, docstatus: "draft", data: { title: "Queued", body: "Remote body" } },
        { title: "Local title", body: "Draft" }
      )
    ).toEqual({
      status: "clean",
      baseVersion: 1,
      remoteVersion: 2,
      localChangedFields: ["title"],
      remoteChangedFields: ["body"],
      mergedFields: ["title"],
      patch: { title: "Local title" },
      unset: [],
      conflicts: []
    });

    expect(
      runtime.collaboration.mergePlan(
        { version: 1, docstatus: "draft", data: { title: "Queued" } },
        { version: 2, docstatus: "draft", data: { title: "Remote title" } },
        { title: "Local title" }
      )
    ).toMatchObject({
      status: "conflict",
      conflicts: [
        {
          field: "title",
          reason: "remote_changed",
          baseValue: "Queued",
          localValue: "Local title",
          remoteValue: "Remote title"
        }
      ]
    });

    expect(
      runtime.collaboration.mergePlan(
        { version: 1, docstatus: "draft", data: { title: "Queued", body: "Draft" } },
        { version: 2, docstatus: "draft", data: { title: "Shared title", body: "Draft" } },
        { title: "Shared title", body: "Draft" }
      )
    ).toMatchObject({
      status: "clean",
      localChangedFields: ["title"],
      remoteChangedFields: ["title"],
      mergedFields: ["title"],
      patch: {},
      unset: [],
      conflicts: []
    });

    expect(
      runtime.collaboration.mergePlan(
        { version: 1, docstatus: "draft", data: { title: "Queued" } },
        { version: 2, docstatus: "submitted", data: { title: "Queued" } },
        { title: "Local title" }
      )
    ).toMatchObject({
      status: "conflict",
      conflicts: [
        {
          field: "docstatus",
          reason: "remote_status_changed",
          baseValue: "draft",
          localValue: "draft",
          remoteValue: "submitted"
        }
      ]
    });
  });

  it("exposes generated form merge plans from the initial rendered form state", () => {
    const title = new FakeField("title", "Queued");
    const body = new FakeField("body", "Draft");
    const expectedVersion = new FakeField("expectedVersion", "1", "hidden");
    const runtime = evaluateDeskClient(
      fetch,
      new FakeDocument({
        form: new FakeForm([title, body, expectedVersion]),
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          scope: "form",
          tenantId: "acme"
        }
      })
    );

    expect(runtime.form.current()?.doc).toMatchObject({ title: "Queued", body: "Draft" });
    title.value = "Local title";
    title.emit("input");

    expect(runtime.form.current()?.mergePlan({
      version: 2,
      docstatus: "draft",
      data: {
        title: "Queued",
        body: "Remote body"
      }
    })).toEqual({
      status: "clean",
      baseVersion: 1,
      remoteVersion: 2,
      localChangedFields: ["title"],
      remoteChangedFields: ["body"],
      mergedFields: ["title"],
      patch: { title: "Local title" },
      unset: [],
      conflicts: []
    });
  });

  it("plans generated form table edits at the top-level table field", () => {
    const product = new FakeField("items[0].product", "SKU-1");
    const quantity = new FakeField("items[0].quantity", "2", "number");
    quantity.dataset.cfFrappeFieldType = "integer";
    const runtime = evaluateDeskClient(
      fetch,
      new FakeDocument({
        form: new FakeForm([
          product,
          quantity,
          new FakeField("items[0].__cf_frappe_row_index", "0", "hidden"),
          new FakeField("expectedVersion", "1", "hidden")
        ]),
        runtimeDataset: {
          doctype: "Sales Invoice",
          documentName: "INV-1",
          documentStatus: "draft",
          documentVersion: "1",
          scope: "form",
          tenantId: "acme"
        }
      })
    );

    expect(runtime.form.current()?.doc).toEqual({
      items: [{ product: "SKU-1", quantity: 2 }]
    });

    quantity.value = "3";
    quantity.emit("input");

    expect(runtime.form.current()?.mergePlan({
      version: 2,
      docstatus: "draft",
      data: {
        items: [{ product: "SKU-2", quantity: 2 }]
      }
    })).toEqual({
      status: "conflict",
      baseVersion: 1,
      remoteVersion: 2,
      localChangedFields: ["items"],
      remoteChangedFields: ["items"],
      mergedFields: [],
      patch: {},
      unset: [],
      conflicts: [
        {
          field: "items",
          reason: "remote_changed",
          basePresent: true,
          localPresent: true,
          remotePresent: true,
          baseValue: [{ product: "SKU-1", quantity: 2 }],
          localValue: [{ product: "SKU-1", quantity: 3 }],
          remoteValue: [{ product: "SKU-2", quantity: 2 }]
        }
      ]
    });
  });

  it("includes rendered document status in generated form merge plans", () => {
    const runtime = evaluateDeskClient(
      fetch,
      new FakeDocument({
        form: new FakeForm([new FakeField("title", "Queued")]),
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          documentStatus: "draft",
          documentVersion: "1",
          scope: "form",
          tenantId: "acme"
        }
      })
    );

    expect(runtime.form.current()?.mergePlan({
      version: 2,
      docstatus: "submitted",
      data: { title: "Queued" }
    })).toMatchObject({
      status: "conflict",
      baseVersion: 1,
      remoteVersion: 2,
      conflicts: [
        {
          field: "docstatus",
          reason: "remote_status_changed",
          baseValue: "draft",
          localValue: "draft",
          remoteValue: "submitted"
        }
      ]
    });
  });

  it("coerces generated typed form controls before planning merges", () => {
    const quantity = new FakeField("quantity", "2", "number");
    quantity.dataset.cfFrappeFieldType = "integer";
    const amount = new FakeField("amount", "10.5", "number");
    amount.dataset.cfFrappeFieldType = "number";
    const metadata = new FakeField("metadata", "{\"color\":\"red\"}", "textarea");
    metadata.dataset.cfFrappeFieldType = "json";
    const reviewed = new FakeField("reviewed", "true", "checkbox");
    reviewed.checked = true;
    reviewed.dataset.cfFrappeFieldType = "boolean";
    const runtime = evaluateDeskClient(
      fetch,
      new FakeDocument({
        form: new FakeForm([
          quantity,
          amount,
          metadata,
          reviewed,
          new FakeField("expectedVersion", "5", "hidden")
        ]),
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          documentStatus: "draft",
          documentVersion: "5",
          scope: "form",
          tenantId: "acme"
        }
      })
    );

    expect(runtime.form.current()?.doc).toEqual({
      quantity: 2,
      amount: 10.5,
      metadata: { color: "red" },
      reviewed: true
    });

    quantity.value = "3";
    quantity.emit("input");

    expect(runtime.form.current()?.mergePlan({
      version: 6,
      docstatus: "draft",
      data: {
        quantity: 2,
        amount: 10.5,
        metadata: { color: "red" },
        reviewed: true
      }
    })).toEqual({
      status: "clean",
      baseVersion: 5,
      remoteVersion: 6,
      localChangedFields: ["quantity"],
      remoteChangedFields: [],
      mergedFields: ["quantity"],
      patch: { quantity: 3 },
      unset: [],
      conflicts: []
    });
  });

  it("shows generated document presence panel field-edit activity from collaboration messages", async () => {
    const sockets: FakeWebSocket[] = [];
    const panel = new FakePresencePanel({
      doctype: "Task",
      documentName: "TASK-1",
      realtimeRoute: "/rt",
      tenantId: "acme"
    });

    evaluateDeskClient(
      async () =>
        new Response(JSON.stringify({
          data: {
            topic: "document:acme:Task:TASK-1",
            connections: []
          }
        }), {
          headers: { "content-type": "application/json" }
        }),
      new FakeDocument({ presencePanels: [panel] }),
      sockets
    );
    await flushPromises();

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.collaboration",
      event: {
        id: "edit-1",
        type: "DocumentFieldEditIntent",
        payload: {
          kind: "DocumentFieldEditIntent",
          field: "title",
          editing: true,
          connectionId: "conn-1",
          actorId: "support@example.com"
        }
      }
    }));
    expect(panel.fieldEdits.textContent).toBe("support@example.com editing title");

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.presence",
      presence: {
        action: "leave",
        topic: "document:acme:Task:TASK-1",
        connections: []
      }
    }));
    expect(panel.fieldEdits.textContent).toBe("No live field edits.");

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.collaboration",
      event: {
        id: "edit-2",
        type: "DocumentFieldEditIntent",
        payload: {
          kind: "DocumentFieldEditIntent",
          field: "title",
          editing: true,
          connectionId: "conn-1",
          actorId: "support@example.com"
        }
      }
    }));
    expect(panel.fieldEdits.textContent).toBe("support@example.com editing title");

    sockets[0]?.emitMessage(JSON.stringify({
      type: "cf-frappe.realtime.collaboration",
      event: {
        id: "edit-3",
        type: "DocumentFieldEditIntent",
        payload: {
          kind: "DocumentFieldEditIntent",
          field: "title",
          editing: false,
          connectionId: "conn-1",
          actorId: "support@example.com"
        }
      }
    }));
    expect(panel.fieldEdits.textContent).toBe("No live field edits.");
  });

  it("builds document realtime subscriptions with canonical encoded topics", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);

    const subscription = runtime.realtime.subscribeDocument("Task Type", "TASK:1", {}, { tenantId: "acme:west" });

    expect(subscription.topic).toBe("document:acme%3Awest:Task%20Type:TASK%3A1");
    expect(subscription.url).toBe(
      "wss://app.example/api/realtime?topic=document%3Aacme%253Awest%3ATask%2520Type%3ATASK%253A1"
    );
    expect(sockets[0]?.url).toBe(subscription.url);
  });

  it("builds doctype and tenant realtime subscriptions and forwards socket lifecycle callbacks", () => {
    const sockets: FakeWebSocket[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), sockets);
    const seen: string[] = [];

    const doctypeSubscription = runtime.realtime.subscribeDoctype("Task Type", {
      open: (_event, sub) => seen.push(`open:${sub.topic}`),
      close: (_event, sub) => seen.push(`close:${sub.topic}`),
      error: (_event, sub) => seen.push(`error:${sub.topic}`)
    }, { tenantId: "acme:west" });
    const tenantSubscription = runtime.realtime.subscribeTenant({}, { tenantId: "acme:west" });

    expect(doctypeSubscription.topic).toBe("doctype:acme%3Awest:Task%20Type");
    expect(doctypeSubscription.url).toBe("wss://app.example/api/realtime?topic=doctype%3Aacme%253Awest%3ATask%2520Type");
    expect(tenantSubscription.topic).toBe("tenant:acme%3Awest");
    expect(tenantSubscription.url).toBe("wss://app.example/api/realtime?topic=tenant%3Aacme%253Awest");

    sockets[0]?.emit("open", { type: "open" });
    sockets[0]?.emit("error", { type: "error" });
    sockets[0]?.emit("close", { type: "close" });

    expect(seen).toEqual([
      "open:doctype:acme%3Awest:Task%20Type",
      "error:doctype:acme%3Awest:Task%20Type",
      "close:doctype:acme%3Awest:Task%20Type"
    ]);
  });

  it("emits generated form field-edit intent without exposing draft values", () => {
    const sockets: FakeWebSocket[] = [];
    const title = new FakeField("title", "Queued");
    const expectedVersion = new FakeField("expectedVersion", "3", "hidden");
    const runtime = evaluateDeskClient(
      fetch,
      new FakeDocument({
        form: new FakeForm([title, expectedVersion]),
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          realtimeRoute: "/rt",
          scope: "form",
          tenantId: "acme"
        }
      }),
      sockets
    );

    expect(runtime.form.current()?.doc).toMatchObject({ title: "Queued" });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("wss://app.example/rt?topic=document%3Aacme%3ATask%3ATASK-1");

    title.emit("focus");
    title.value = "In Progress";
    title.emit("input");
    title.emit("blur");
    expectedVersion.emit("focus");

    expect(sockets[0]?.sent.map((message) => JSON.parse(message) as unknown)).toEqual([
      {
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true
      },
      {
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true
      },
      {
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: false
      }
    ]);
  });

  it("shares generated form draft patches only through explicit form calls", () => {
    const sockets: FakeWebSocket[] = [];
    const title = new FakeField("title", "Queued");
    const obsolete = new FakeField("obsolete", "remove me");
    const expectedVersion = new FakeField("expectedVersion", "3", "hidden");
    const runtime = evaluateDeskClient(
      fetch,
      new FakeDocument({
        form: new FakeForm([title, obsolete, expectedVersion]),
        runtimeDataset: {
          doctype: "Task",
          documentName: "TASK-1",
          documentVersion: "3",
          realtimeRoute: "/rt",
          scope: "form",
          tenantId: "acme"
        }
      }),
      sockets
    );

    expect(runtime.form.current()?.share_draft()).toEqual({
      type: "cf-frappe.collaboration.shared_draft",
      baseVersion: 3,
      patch: {}
    });
    expect(sockets[0]?.sent).toEqual([]);

    title.value = "Draft title";
    title.emit("input");
    obsolete.value = "";
    obsolete.emit("change");

    expect(runtime.form.current()?.share_draft({ unset: ["obsolete"] })).toEqual({
      type: "cf-frappe.collaboration.shared_draft",
      baseVersion: 3,
      patch: { title: "Draft title" },
      unset: ["obsolete"]
    });
    expect(sockets[0]?.sent.map((message) => JSON.parse(message) as unknown)).toEqual([
      {
        type: "cf-frappe.collaboration.field_edit",
        field: "title",
        editing: true
      },
      {
        type: "cf-frappe.collaboration.field_edit",
        field: "obsolete",
        editing: true
      },
      {
        type: "cf-frappe.collaboration.shared_draft",
        baseVersion: 3,
        patch: { title: "Draft title" },
        unset: ["obsolete"]
      }
    ]);
  });

  it("runs Frappe-style form hooks over generated form fields", async () => {
    const title = new FakeField("title", "Queued");
    const priorityWrapper = new FakeFieldWrapper();
    const priority = new FakeField("priority", "Medium", "select", priorityWrapper);
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
    expect(runtime.form.current()?.get_field("priority")).toBe(priority);
    runtime.form.current()?.set_df_property("priority", "reqd", true);
    runtime.form.current()?.set_df_property("priority", "read_only", true);
    expect(priority.required).toBe(true);
    expect(priority.readOnly).toBe(true);
    expect(priority.attributes["aria-readonly"]).toBe("true");
    priority.value = "Low";
    priority.emit("change");
    expect(priority.value).toBe("Medium");
    runtime.form.current()?.toggle_display("priority", false);
    runtime.form.current()?.toggle_enable("priority", false);
    expect(priority.hidden).toBe(true);
    expect(priorityWrapper.hidden).toBe(true);
    expect(priority.disabled).toBe(false);
    expect(priority.attributes["aria-disabled"]).toBe("true");
    runtime.form.current()?.toggle_display("priority", true);
    expect(priority.hidden).toBe(false);
    expect(priorityWrapper.hidden).toBe(false);
    await runtime.form.current()?.set_value("priority", "High");
    expect(priority.value).toBe("High");
    priority.value = "Low";
    priority.emit("change");
    expect(priority.value).toBe("High");
    expect(form.nativeValues().priority).toBe("High");
    runtime.form.current()?.toggle_enable("priority", true);
    expect(priority.disabled).toBe(false);
    await runtime.form.current()?.clear_value("priority");
    expect(priority.value).toBe("");
    expect(runtime.form.current()?.get_value("priority")).toBe("");

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

  it("merge-saves generated form drafts through the resource merge endpoint", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        data: {
          status: "applied",
          plan: {
            status: "clean",
            baseVersion: 1,
            remoteVersion: 2,
            patch: { body: "Local body" },
            unset: []
          },
          document: {
            tenantId: "acme",
            doctype: "Note",
            name: "My Note",
            version: 3,
            docstatus: "draft",
            data: { title: "My Note", body: "Local body", priority: "High", metadata: { color: "red" } },
            createdAt: "now",
            updatedAt: "now"
          }
        }
      });
    };
    const title = new FakeField("title", "My Note");
    const body = new FakeField("body", "Base body");
    const priority = new FakeField("priority", "Low");
    const metadata = new FakeField("metadata", "{\"color\":\"blue\"}");
    metadata.dataset.cfFrappeFieldType = "json";
    const expectedVersion = new FakeField("expectedVersion", "1", "hidden");
    const form = new FakeForm([title, body, priority, metadata, expectedVersion]);
    const runtime = evaluateDeskClient(fetch, new FakeDocument({
      form,
      runtimeDataset: {
        doctype: "Note",
        documentName: "My Note",
        documentStatus: "draft",
        documentVersion: "1",
        scope: "form",
        tenantId: "acme"
      }
    }));

    body.value = "Local body";
    body.emit("input");
    const result = await runtime.form.current()?.save({ merge: true });

    expect(result).toMatchObject({ status: "applied", document: { version: 3 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/resource/Note/My%20Note/merge");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(JSON.stringify({
      baseVersion: 1,
      patch: { body: "Local body" }
    }));
    expect(expectedVersion.value).toBe("3");
    expect(priority.value).toBe("High");
    expect(JSON.parse(metadata.value)).toEqual({ color: "red" });
    expect(form.dataset.documentVersion).toBe("3");
    expect(form.dataset.remoteMergeState).toBe("clean");
    expect(form.dataset.dirty).toBeUndefined();
    expect(runtime.form.current()?.is_dirty()).toBe(false);
    expect(runtime.form.current()?.last_merge_result).toMatchObject({ status: "applied" });
  });

  it("keeps generated form drafts in place when merge-save returns conflicts", async () => {
    const fetch = async () => jsonResponse({
      data: {
        status: "conflict",
        plan: {
          status: "conflict",
          baseVersion: 1,
          remoteVersion: 2,
          patch: {},
          unset: [],
          conflicts: [
            {
              field: "body",
              reason: "remote_changed",
              baseValue: "Base body",
              localValue: "Local body",
              remoteValue: "Remote body"
            }
          ]
        },
        document: {
          tenantId: "acme",
          doctype: "Note",
          name: "My Note",
          version: 2,
          docstatus: "draft",
          data: { title: "My Note", body: "Remote body" },
          createdAt: "now",
          updatedAt: "now"
        }
      }
    });
    const body = new FakeField("body", "Base body");
    const expectedVersion = new FakeField("expectedVersion", "1", "hidden");
    const form = new FakeForm([new FakeField("title", "My Note"), body, expectedVersion]);
    const runtime = evaluateDeskClient(fetch, new FakeDocument({
      form,
      runtimeDataset: {
        doctype: "Note",
        documentName: "My Note",
        documentVersion: "1",
        scope: "form",
        tenantId: "acme"
      }
    }));

    body.value = "Local body";
    body.emit("input");
    const result = await runtime.form.current()?.merge_save();

    expect(result).toMatchObject({
      status: "conflict",
      plan: {
        status: "conflict",
        conflicts: [expect.objectContaining({ field: "body", reason: "remote_changed" })]
      }
    });
    expect(body.value).toBe("Local body");
    expect(expectedVersion.value).toBe("1");
    expect(form.dataset.remoteMergeState).toBe("conflict");
    expect(runtime.form.current()?.last_merge_result).toMatchObject({ status: "conflict" });
  });

  it("exposes Frappe-style user feedback helpers for client scripts", () => {
    const alerts: string[] = [];
    const runtime = evaluateDeskClient(fetch, new FakeDocument(), [], (message) => alerts.push(message));

    expect(runtime.msgprint("Saved")).toBe("Saved");
    expect(runtime.ui.msgprint(null)).toBe("");
    expect(alerts).toEqual(["Saved", ""]);
    expect(() => runtime.throw("Nope")).toThrow("Nope");
    expect(alerts).toEqual(["Saved", "", "Nope"]);
  });
});

function evaluateDeskClient(
  fetchImpl: typeof fetch = fetch,
  documentImpl: unknown = new FakeDocument(),
  sockets: FakeWebSocket[] = [],
  alertImpl?: (message: string) => void
): DeskClientRuntime {
  const fakeWindow = {
    ...(alertImpl === undefined ? {} : { alert: alertImpl }),
    location: { href: "https://app.example/desk/Task/TASK-1" }
  } as { alert?: (message: string) => void; cfFrappe?: DeskClientRuntime; location: { href: string } };

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
  )(fakeWindow, fetchImpl, Headers, FormData, URLSearchParams, Blob, fakeWebSocketClass(sockets), documentImpl);

  if (!fakeWindow.cfFrappe) {
    throw new Error("Desk client runtime was not installed");
  }
  return fakeWindow.cfFrappe;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeWebSocket {
  readonly listeners: Record<string, Array<(event: unknown) => void>> = {};
  readonly sent: string[] = [];
  closed?: { readonly code?: number; readonly reason?: string };

  constructor(readonly url: string, readonly protocols?: string | readonly string[]) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  close(code?: number, reason?: string): void {
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason })
    };
  }

  send(message: string): void {
    this.sent.push(message);
  }

  emitMessage(data: unknown): void {
    this.emit("message", { data });
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

function fakeWebSocketClass(sockets: FakeWebSocket[]) {
  return class extends FakeWebSocket {
    constructor(url: string, protocols?: string | readonly string[]) {
      super(url, protocols);
      sockets.push(this);
    }
  };
}

class FakeField {
  readonly attributes: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly listeners: Record<string, Array<() => void>> = {};
  checked = false;
  disabled = false;
  hidden = false;
  readOnly = false;
  required = false;

  constructor(
    readonly name: string,
    public value: string,
    readonly type = "text",
    private readonly wrapper?: FakeFieldWrapper
  ) {}

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  closest(selector: string): FakeFieldWrapper | null {
    return selector === ".field" ? this.wrapper ?? null : null;
  }

  emit(type: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener();
    }
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakeFieldWrapper {
  hidden = false;
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

  nativeValues(): Record<string, string> {
    return Object.fromEntries(
      this.fields
        .filter((field) => !field.disabled)
        .map((field) => [field.name, field.type === "checkbox" ? String(field.checked) : field.value])
    );
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

class FakeCompoundControl {
  readonly listeners: Record<string, Array<() => void>> = {};

  constructor(public value: string) {}

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  emit(type: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener();
    }
  }
}

class FakeCompoundButton {
  readonly listeners: Record<string, Array<() => void>> = {};

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  click(): void {
    for (const listener of this.listeners.click ?? []) {
      listener();
    }
  }
}

type FakeCompoundFilterItem = FakeCompoundFilterGroup | FakeCompoundFilterRow;

class FakeCompoundFilterRow {
  readonly field: FakeCompoundControl;
  readonly operator: FakeCompoundControl;
  readonly value: FakeCompoundControl;
  readonly removeButton = new FakeCompoundButton();
  parentElement: FakeCompoundFilterItems | undefined = undefined;
  removed = false;

  constructor(field: string, operator: string, value: string) {
    this.field = new FakeCompoundControl(field);
    this.operator = new FakeCompoundControl(operator);
    this.value = new FakeCompoundControl(value);
  }

  cloneNode(): FakeCompoundFilterRow {
    return new FakeCompoundFilterRow(this.field.value, this.operator.value, this.value.value);
  }

  querySelector(selector: string): FakeCompoundControl | FakeCompoundButton | null {
    if (selector === "[data-cf-frappe-filter-field]") {
      return this.field;
    }
    if (selector === "[data-cf-frappe-filter-operator]") {
      return this.operator;
    }
    if (selector === "[data-cf-frappe-filter-value]") {
      return this.value;
    }
    if (selector === "[data-cf-frappe-remove-filter]") {
      return this.removeButton;
    }
    return null;
  }

  querySelectorAll(selector: string): readonly FakeCompoundControl[] {
    return selector === "select, input" ? [this.field, this.operator, this.value] : [];
  }

  closest(selector: string): FakeCompoundFilterGroup | null {
    return selector === "[data-cf-frappe-filter-group]" ? this.parentElement?.group ?? null : null;
  }

  matches(selector: string): boolean {
    return selector === "[data-cf-frappe-filter-row]";
  }

  remove(): void {
    this.parentElement?.removeChild(this);
    this.removed = true;
  }
}

class FakeCompoundFilterItems {
  constructor(readonly group: FakeCompoundFilterGroup) {}

  get children(): readonly FakeCompoundFilterItem[] {
    return this.group.items.filter((item) => !item.removed);
  }

  get firstChild(): FakeCompoundFilterItem | undefined {
    return this.children[0];
  }

  appendChild(item: FakeCompoundFilterItem): void {
    item.parentElement = this;
    item.removed = false;
    this.group.items.push(item);
  }

  removeChild(item: FakeCompoundFilterItem): void {
    this.group.items = this.group.items.filter((child) => child !== item);
    item.parentElement = undefined;
    item.removed = true;
  }

  closest(selector: string): FakeCompoundFilterGroup | null {
    return selector === "[data-cf-frappe-filter-group]" ? this.group : null;
  }
}

class FakeCompoundFilterGroup {
  readonly addFilter = new FakeCompoundButton();
  readonly addGroup = new FakeCompoundButton();
  readonly itemsContainer = new FakeCompoundFilterItems(this);
  readonly match: FakeCompoundControl;
  readonly removeGroupButton = new FakeCompoundButton();
  parentElement: FakeCompoundFilterItems | undefined = undefined;
  removed = false;
  items: FakeCompoundFilterItem[];

  constructor(
    options: {
      readonly match?: string;
      readonly items?: readonly FakeCompoundFilterItem[];
    } = {}
  ) {
    this.match = new FakeCompoundControl(options.match ?? "all");
    this.items = [];
    for (const item of options.items ?? [new FakeCompoundFilterRow("", "eq", "")]) {
      this.itemsContainer.appendChild(item);
    }
  }

  get rows(): readonly FakeCompoundFilterRow[] {
    return this.children.flatMap((item) =>
      item instanceof FakeCompoundFilterRow ? [item] : item.rows
    );
  }

  get groups(): readonly FakeCompoundFilterGroup[] {
    return this.children.flatMap((item) =>
      item instanceof FakeCompoundFilterGroup ? [item, ...item.groups] : []
    );
  }

  private get children(): readonly FakeCompoundFilterItem[] {
    return this.items.filter((item) => !item.removed);
  }

  cloneNode(): FakeCompoundFilterGroup {
    return new FakeCompoundFilterGroup({
      match: this.match.value,
      items: this.children.map((item) => item.cloneNode())
    });
  }

  querySelector(
    selector: string
  ): FakeCompoundControl | FakeCompoundButton | FakeCompoundFilterGroup | FakeCompoundFilterItems | FakeCompoundFilterRow | null {
    if (selector === "[data-cf-frappe-filter-match]") {
      return this.match;
    }
    if (selector === "[data-cf-frappe-add-filter]") {
      return this.addFilter;
    }
    if (selector === "[data-cf-frappe-add-filter-group]") {
      return this.addGroup;
    }
    if (selector === "[data-cf-frappe-remove-filter-group]") {
      return this.removeGroupButton;
    }
    if (selector === "[data-cf-frappe-filter-items]" || selector === "[data-cf-frappe-filter-rows]") {
      return this.itemsContainer;
    }
    if (selector === "[data-cf-frappe-filter-row]") {
      return this.rows[0] ?? null;
    }
    if (selector === "[data-cf-frappe-filter-group]") {
      return this.groups[0] ?? null;
    }
    return null;
  }

  querySelectorAll(selector: string): readonly (FakeCompoundFilterGroup | FakeCompoundFilterRow)[] {
    if (selector === "[data-cf-frappe-filter-row]") {
      return this.rows;
    }
    if (selector === "[data-cf-frappe-filter-group]") {
      return this.groups;
    }
    return [];
  }

  closest(selector: string): FakeCompoundFilterGroup | null {
    return selector === "[data-cf-frappe-filter-group]" ? this : null;
  }

  matches(selector: string): boolean {
    return selector === "[data-cf-frappe-filter-group]";
  }

  remove(): void {
    this.parentElement?.removeChild(this);
    this.removed = true;
  }
}

class FakeCompoundTemplate<T extends FakeCompoundFilterGroup | FakeCompoundFilterRow> {
  readonly content: { readonly firstElementChild: T };

  constructor(element: T) {
    this.content = { firstElementChild: element };
  }
}

class FakeCompoundFilterBuilder {
  readonly dataset: Record<string, string> = {
    filterFields: JSON.stringify([
      {
        field: "priority",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" }
        ]
      },
      {
        field: "count",
        inputType: "number",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "between", label: "between" }
        ]
      }
    ])
  };
  readonly expression: FakeCompoundControl;
  readonly groupTemplate = new FakeCompoundTemplate(new FakeCompoundFilterGroup());
  readonly root: FakeCompoundFilterGroup;
  readonly rowTemplate = new FakeCompoundTemplate(new FakeCompoundFilterRow("", "eq", ""));

  constructor(
    private readonly form: FakeForm,
    options: {
      readonly expression?: string;
      readonly filterExpressionKind?: string;
      readonly items?: readonly FakeCompoundFilterItem[];
      readonly match?: string;
      readonly rows?: readonly FakeCompoundFilterRow[];
    } = {}
  ) {
    if (options.filterExpressionKind !== undefined) {
      this.dataset.filterExpressionKind = options.filterExpressionKind;
    }
    this.expression = new FakeCompoundControl(options.expression ?? "");
    this.root = new FakeCompoundFilterGroup({
      match: options.match ?? "all",
      items: options.items ?? options.rows ?? [new FakeCompoundFilterRow("", "eq", "")]
    });
  }

  get add(): FakeCompoundButton {
    return this.root.addFilter;
  }

  get addGroup(): FakeCompoundButton {
    return this.root.addGroup;
  }

  get match(): FakeCompoundControl {
    return this.root.match;
  }

  get rows(): readonly FakeCompoundFilterRow[] {
    return this.root.rows;
  }

  closest(selector: string): FakeForm | null {
    return selector === "form" ? this.form : null;
  }

  querySelector(
    selector: string
  ):
    | FakeCompoundControl
    | FakeCompoundButton
    | FakeCompoundFilterGroup
    | FakeCompoundFilterItems
    | FakeCompoundFilterRow
    | FakeCompoundTemplate<FakeCompoundFilterGroup>
    | FakeCompoundTemplate<FakeCompoundFilterRow>
    | null {
    if (selector === '[name="filter_expression"]') {
      return this.expression;
    }
    if (selector === "[data-cf-frappe-filter-group]") {
      return this.root;
    }
    if (selector === "[data-cf-frappe-filter-match]") {
      return this.match;
    }
    if (selector === "[data-cf-frappe-add-filter]") {
      return this.add;
    }
    if (selector === "[data-cf-frappe-filter-row]") {
      return this.rows[0] ?? null;
    }
    if (selector === "[data-cf-frappe-filter-items]" || selector === "[data-cf-frappe-filter-rows]") {
      return this.root.itemsContainer;
    }
    if (selector === "[data-cf-frappe-filter-row-template]") {
      return this.rowTemplate;
    }
    if (selector === "[data-cf-frappe-filter-group-template]") {
      return this.groupTemplate;
    }
    return null;
  }

  querySelectorAll(selector: string): readonly (FakeCompoundFilterGroup | FakeCompoundFilterRow)[] {
    if (selector === "[data-cf-frappe-filter-row]") {
      return this.rows;
    }
    if (selector === "[data-cf-frappe-filter-group]") {
      return [this.root, ...this.root.groups];
    }
    return [];
  }
}

class FakeFormulaElement {
  readonly attributes: Record<string, string> = {};
  readonly children: FakeFormulaElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners: Record<string, Array<() => void>> = {};
  className = "";
  name = "";
  parentElement: FakeFormulaElement | undefined = undefined;
  step = "";
  textContent = "";
  type = "";
  value = "";

  constructor(readonly tagName: string) {}

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  appendChild(child: FakeFormulaElement): FakeFormulaElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  emit(type: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener();
    }
  }

  get firstChild(): FakeFormulaElement | undefined {
    return this.children[0];
  }

  optionValues(): readonly string[] {
    return this.children.filter((child) => child.tagName === "option").map((child) => child.value);
  }

  querySelector(selector: string): FakeFormulaElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): readonly FakeFormulaElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }

  removeChild(child: FakeFormulaElement): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = undefined;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "name") {
      this.name = value;
    }
  }

  private matches(selector: string): boolean {
    if (selector === "[data-cf-frappe-formula-operand]") {
      return Object.prototype.hasOwnProperty.call(this.attributes, "data-cf-frappe-formula-operand");
    }
    if (selector === "[data-cf-frappe-formula-kind]") {
      return Object.prototype.hasOwnProperty.call(this.attributes, "data-cf-frappe-formula-kind");
    }
    if (selector === "[data-cf-frappe-formula-nested]") {
      return Object.prototype.hasOwnProperty.call(this.attributes, "data-cf-frappe-formula-nested");
    }
    const nameMatch = selector.match(/^\[name="(.+)"\]$/);
    return nameMatch ? this.name === nameMatch[1] : false;
  }
}

class FakeReportFormulaBuilder extends FakeFormulaElement {
  constructor(maxDepth: number) {
    super("div");
    this.setAttribute("data-cf-frappe-report-formula-builder", "");
    this.dataset.formulaMaxDepth = String(maxDepth);
    this.dataset.formulaFields = JSON.stringify([{ name: "count", label: "count" }]);
    this.appendChild(fakeFormulaOperand("formulaLeft", "Formula Left", 2, maxDepth));
    this.appendChild(fakeFormulaOperand("formulaRight", "Formula Right", 2, maxDepth));
  }

  namedControl(name: string): FakeFormulaElement {
    const control = this.querySelector(`[name="${name}"]`);
    if (!control) {
      throw new Error(`Missing formula control ${name}`);
    }
    return control;
  }
}

function fakeFormulaOperand(prefix: string, label: string, depth: number, maxDepth: number): FakeFormulaElement {
  const operand = new FakeFormulaElement("div");
  operand.setAttribute("data-cf-frappe-formula-operand", "");
  operand.dataset.formulaPrefix = prefix;
  operand.dataset.formulaLabel = label;
  operand.dataset.formulaDepth = String(depth);
  operand.appendChild(fakeFormulaSelect(`${prefix}Kind`, "field", true, depth <= maxDepth));
  operand.appendChild(fakeFormulaSelect(prefix, "", false, false));
  const literal = new FakeFormulaElement("input");
  literal.name = `${prefix}Literal`;
  literal.type = "number";
  literal.step = "any";
  operand.appendChild(literal);
  const nested = new FakeFormulaElement("div");
  nested.setAttribute("data-cf-frappe-formula-nested", "");
  operand.appendChild(nested);
  return operand;
}

function fakeFormulaSelect(
  name: string,
  value: string,
  kind: boolean,
  nested: boolean
): FakeFormulaElement {
  const select = new FakeFormulaElement("select");
  select.name = name;
  select.value = value;
  if (kind) {
    select.setAttribute("data-cf-frappe-formula-kind", "");
    select.appendChild(fakeFormulaOption("field"));
    select.appendChild(fakeFormulaOption("literal"));
    if (nested) {
      select.appendChild(fakeFormulaOption("nested"));
    }
  }
  return select;
}

function fakeFormulaOption(value: string): FakeFormulaElement {
  const option = new FakeFormulaElement("option");
  option.value = value;
  option.textContent = value;
  return option;
}

class FakePresenceText {
  constructor(public textContent = "") {}
}

class FakePresenceButton {
  readonly listeners: Record<string, Array<() => void>> = {};
  disabled = false;
  hidden = true;
  textContent = "";

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  click(): void {
    for (const listener of this.listeners.click ?? []) {
      listener();
    }
  }
}

class FakePresencePanel {
  readonly count = new FakePresenceText();
  readonly fieldEdits = new FakePresenceText("No live field edits.");
  readonly list = new FakePresenceText();
  readonly merge = new FakePresenceButton();
  readonly update = new FakePresenceText();

  constructor(readonly dataset: Record<string, string>) {}

  querySelector(selector: string): FakePresenceText | FakePresenceButton | null {
    if (selector === "[data-cf-frappe-presence-count]") {
      return this.count;
    }
    if (selector === "[data-cf-frappe-presence-list]") {
      return this.list;
    }
    if (selector === "[data-cf-frappe-field-edits]") {
      return this.fieldEdits;
    }
    if (selector === "[data-cf-frappe-document-update]") {
      return this.update;
    }
    if (selector === "[data-cf-frappe-merge-save]") {
      return this.merge;
    }
    return null;
  }
}

class FakeDocument {
  readonly currentScript = undefined;
  readonly readyState = "complete";
  private readonly form: FakeForm | undefined;
  private readonly compoundFilterBuilders: readonly FakeCompoundFilterBuilder[];
  private readonly formulaBuilders: readonly FakeReportFormulaBuilder[];
  private readonly presencePanels: readonly FakePresencePanel[];
  private readonly runtime: { readonly dataset: Record<string, string> } | undefined;

  constructor(
    options: {
      readonly form?: FakeForm;
      readonly compoundFilterBuilders?: readonly FakeCompoundFilterBuilder[];
      readonly formulaBuilders?: readonly FakeReportFormulaBuilder[];
      readonly presencePanels?: readonly FakePresencePanel[];
      readonly runtimeDataset?: Record<string, string>;
    } = {}
  ) {
    this.form = options.form;
    this.compoundFilterBuilders = options.compoundFilterBuilders ?? [];
    this.formulaBuilders = options.formulaBuilders ?? [];
    this.presencePanels = options.presencePanels ?? [];
    this.runtime = options.runtimeDataset ? { dataset: options.runtimeDataset } : undefined;
  }

  addEventListener(): void {}

  createElement(tagName: string): FakeFormulaElement {
    return new FakeFormulaElement(tagName);
  }

  querySelector(selector: string): FakeForm | { readonly dataset: Record<string, string> } | null {
    if (selector === 'script[data-cf-frappe-runtime="desk"]') {
      return this.runtime ?? null;
    }
    if (selector === "form.form") {
      return this.form ?? null;
    }
    return null;
  }

  querySelectorAll(selector: string): readonly (FakePresencePanel | FakeCompoundFilterBuilder | FakeReportFormulaBuilder)[] {
    if (selector === '[data-cf-frappe-presence="document"]') {
      return this.presencePanels;
    }
    if (selector === "[data-cf-frappe-compound-filter-builder]") {
      return this.compoundFilterBuilders;
    }
    if (selector === "[data-cf-frappe-report-formula-builder]") {
      return this.formulaBuilders;
    }
    return [];
  }
}
