import { renderDeskClientScript } from "../../src/adapters/desk/client";

interface DeskClientRuntime {
  readonly context: (script?: { readonly dataset?: Record<string, string> }) => {
    readonly doctype?: string;
    readonly documentName?: string;
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
  readonly form: {
    readonly current: () => DeskFormRuntime | null;
    readonly on: (doctype: string, handlers: DeskFormHandlers) => void;
  };
  readonly msgprint: (message: unknown) => string;
  readonly "throw": (message: unknown) => never;
  readonly ui: {
    readonly msgprint: (message: unknown) => string;
  };
  readonly meta: {
    readonly listView: (doctype: string) => Promise<unknown>;
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
    readonly completeDirectUpload: (name: string, options?: { readonly expectedVersion?: number }) => Promise<unknown>;
    readonly contentUrl: (name: string) => string;
    readonly delete: (name: string, options?: { readonly expectedVersion?: number }) => Promise<unknown>;
    readonly list: (options?: Record<string, unknown>) => Promise<unknown>;
    readonly prepareDirectUpload: (input: Record<string, unknown>) => Promise<unknown>;
    readonly previewUrl: (name: string) => string;
    readonly updateMetadata: (
      name: string,
      input: Record<string, unknown>,
      options?: { readonly expectedVersion?: number }
    ) => Promise<unknown>;
    readonly upload: (body: Blob, options: Record<string, unknown>) => Promise<unknown>;
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
    readonly list: (doctype: string, options: { readonly filters: Record<string, unknown> }) => Promise<unknown>;
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
  readonly connected?: (message: unknown, subscription: DeskRealtimeSubscription) => void;
  readonly event?: (event: Record<string, unknown>, message: unknown, subscription: DeskRealtimeSubscription) => void;
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
  readonly refresh: () => boolean;
  readonly refresh_field: (fieldname: string) => void;
  readonly save: () => boolean;
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

    expect(runtime.files.contentUrl("file/1")).toBe("/api/files/file%2F1/content");
    expect(runtime.files.previewUrl("file/1")).toBe("/api/files/file%2F1/preview");
    expect(calls.map((call) => `${call.init.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/files?attached_to_doctype=Task+Type&attached_to_name=TASK%2F1&filename=hello.txt&is_private=true",
      "POST /api/files/direct-upload",
      "POST /api/files/file%2F1/complete-upload"
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
      "DELETE /api/resource/Task%20Type/saved-filters/filter%2F1"
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
      undefined
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

  it("exposes client-script context and WebSocket realtime URLs", () => {
    const runtime = evaluateDeskClient();

    expect(
      runtime.context({
        dataset: {
          cfFrappeScript: "task-form",
          doctype: "Task",
          documentName: "TASK-1",
          realtimeRoute: "/rt",
          scope: "form",
          tenantId: "acme"
        }
      })
    ).toEqual({
      doctype: "Task",
      documentName: "TASK-1",
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeWebSocket {
  readonly listeners: Record<string, Array<(event: unknown) => void>> = {};
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

class FakePresenceText {
  textContent = "";
}

class FakePresencePanel {
  readonly count = new FakePresenceText();
  readonly list = new FakePresenceText();

  constructor(readonly dataset: Record<string, string>) {}

  querySelector(selector: string): FakePresenceText | null {
    if (selector === "[data-cf-frappe-presence-count]") {
      return this.count;
    }
    if (selector === "[data-cf-frappe-presence-list]") {
      return this.list;
    }
    return null;
  }
}

class FakeDocument {
  readonly currentScript = undefined;
  readonly readyState = "complete";
  private readonly form: FakeForm | undefined;
  private readonly presencePanels: readonly FakePresencePanel[];
  private readonly runtime: { readonly dataset: Record<string, string> } | undefined;

  constructor(
    options: {
      readonly form?: FakeForm;
      readonly presencePanels?: readonly FakePresencePanel[];
      readonly runtimeDataset?: Record<string, string>;
    } = {}
  ) {
    this.form = options.form;
    this.presencePanels = options.presencePanels ?? [];
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

  querySelectorAll(selector: string): readonly FakePresencePanel[] {
    return selector === '[data-cf-frappe-presence="document"]' ? this.presencePanels : [];
  }
}
