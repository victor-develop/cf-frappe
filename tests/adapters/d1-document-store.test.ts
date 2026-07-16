import { D1DocumentStore, D1EventStore, D1ProjectionStore } from "../../src";
import type { DocumentData, DocumentEventPayload, DocumentSnapshot, JsonValue, NewDomainEvent } from "../../src";

describe("D1DocumentStore", () => {
  const stream = "acme:Note:One";
  const event: NewDomainEvent = {
    id: "evt1",
    tenantId: "acme",
    stream,
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };

  it("commits event and projection in one batch", async () => {
    const db = new FakeD1Database();
    const store = new D1DocumentStore(db as unknown as D1Database);

    const commit = await store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!));

    expect(commit.snapshot).toMatchObject({ name: "One", version: 1 });
    await expect(store.readStream(stream)).resolves.toMatchObject([{ id: "evt1", sequence: 1 }]);
    expect(db.documents.get("acme:Note:One")).toMatchObject({ version: 1 });
  });

  it("commits multi-stream events and projections in one batch", async () => {
    const db = new FakeD1Database();
    const store = new D1DocumentStore(db as unknown as D1Database);
    const uniqueStream = "acme:__UniqueValues:Note%3Atitle%3As%3AOne";
    const uniqueEvent: NewDomainEvent = {
      ...event,
      id: "unique1",
      stream: uniqueStream,
      type: "UniqueValueStarted",
      doctype: "__UniqueValues",
      documentName: "Note:title:s:One",
      payload: {
        kind: "DocumentCreated",
        data: { doctype: "Note", field: "title", value: "One", valueKey: "s:One", documentName: "One", active: true },
        docstatus: "draft"
      },
      metadata: { target_doctype: "Note", target_field: "title" }
    };

    const commit = await store.commitBatch(
      [
        { stream: uniqueStream, expectedVersion: 0, events: [uniqueEvent] },
        { stream, expectedVersion: 0, events: [event] }
      ],
      (saved) => {
        const uniqueSaved = saved.find((item) => item.id === "unique1")!;
        const documentSaved = saved.find((item) => item.id === "evt1")!;
        return {
          snapshot: snapshotFrom(documentSaved),
          auxiliarySnapshots: [snapshotFrom(uniqueSaved)]
        };
      }
    );

    expect(commit.events.map((item) => `${item.stream}:${String(item.sequence)}`)).toEqual([
      `${uniqueStream}:1`,
      `${stream}:1`
    ]);
    expect(commit.snapshot).toMatchObject({ doctype: "Note", name: "One", version: 1 });
    await expect(store.readStream(uniqueStream)).resolves.toMatchObject([{ id: "unique1", sequence: 1 }]);
    await expect(store.readStream(stream)).resolves.toMatchObject([{ id: "evt1", sequence: 1 }]);
    expect(db.documents.get("acme:__UniqueValues:Note:title:s:One")).toMatchObject({ version: 1 });
    expect(db.documents.get("acme:Note:One")).toMatchObject({ version: 1 });
  });

  it("updates the D1 automation run claim index with automation run projections", async () => {
    const db = new FakeD1Database();
    const store = new D1DocumentStore(db as unknown as D1Database);
    const projections = new D1ProjectionStore(db as unknown as D1Database);
    const source: NewDomainEvent = {
      ...event,
      id: "evt-source",
      type: "NoteUpdated",
      payload: { kind: "DocumentUpdated", patch: { title: "Two" } }
    };
    const automationRun = automationRunEvent("evt-run", "run-1", {
      status: "pending",
      enqueuedAt: "2026-01-01T00:00:00.000Z"
    });
    const futureRetry = automationRunEvent("evt-future", "run-2", {
      status: "failed",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      retryAt: "2026-01-01T00:05:00.000Z"
    });
    const delivered = automationRunEvent("evt-delivered", "run-3", {
      status: "delivered",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      deliveredAt: "2026-01-01T00:01:00.000Z"
    });

    await store.commitBatch(
      [
        { stream, expectedVersion: 0, events: [source] },
        { stream: "acme:__AutomationRuns:run-1", expectedVersion: 0, events: [automationRun] },
        { stream: "acme:__AutomationRuns:run-2", expectedVersion: 0, events: [futureRetry] },
        { stream: "acme:__AutomationRuns:run-3", expectedVersion: 0, events: [delivered] }
      ],
      () => ({
        snapshot: {
          tenantId: "acme",
          doctype: "Note",
          name: "One",
          version: 1,
          docstatus: "draft",
          data: { title: "Two" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        auxiliarySnapshots: [
          automationRunSnapshot("run-1", 1, "pending", { enqueuedAt: "2026-01-01T00:00:00.000Z" }),
          automationRunSnapshot("run-2", 1, "failed", {
            enqueuedAt: "2026-01-01T00:00:00.000Z",
            retryAt: "2026-01-01T00:05:00.000Z"
          }),
          automationRunSnapshot("run-3", 1, "delivered", {
            enqueuedAt: "2026-01-01T00:00:00.000Z",
            deliveredAt: "2026-01-01T00:01:00.000Z"
          })
        ]
      })
    );

    expect(db.automationRuns.get("acme:run-1")).toMatchObject({
      status: "pending",
      available_at: "2026-01-01T00:00:00.000Z"
    });
    expect(db.automationRuns.get("acme:run-2")).toMatchObject({
      status: "failed",
      available_at: "2026-01-01T00:05:00.000Z"
    });
    expect(db.automationRuns.get("acme:run-3")).toMatchObject({
      status: "delivered",
      available_at: null
    });
    await expect(projections.listAutomationRunClaimCandidates({
      tenantId: "acme",
      now: "2026-01-01T00:01:00.000Z",
      limit: 10
    })).resolves.toMatchObject([{ doctype: "__AutomationRuns", name: "run-1" }]);
  });

  it("rolls back event inserts when projection upsert fails", async () => {
    const db = new FakeD1Database({ failDocumentUpsert: true });
    const store = new D1DocumentStore(db as unknown as D1Database);

    await expect(store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!))).rejects.toThrow(
      "projection failed"
    );
    await expect(store.readStream(stream)).resolves.toEqual([]);
    expect(db.documents.size).toBe(0);
  });

  it("rolls back multi-stream event inserts when a batch projection upsert fails", async () => {
    const db = new FakeD1Database({ failDocumentUpsert: true });
    const store = new D1DocumentStore(db as unknown as D1Database);
    const otherStream = "acme:Note:Two";
    const otherEvent = { ...event, id: "evt2", stream: otherStream, documentName: "Two" };

    await expect(
      store.commitBatch(
        [
          { stream, expectedVersion: 0, events: [event] },
          { stream: otherStream, expectedVersion: 0, events: [otherEvent] }
        ],
        ([first, second]) => ({
          snapshot: snapshotFrom(first!),
          auxiliarySnapshots: [snapshotFrom(second!)]
        })
      )
    ).rejects.toThrow("projection failed");
    await expect(store.readStream(stream)).resolves.toEqual([]);
    await expect(store.readStream(otherStream)).resolves.toEqual([]);
    expect(db.documents.size).toBe(0);
  });

  it("reads a bounded recent stream page with bound sequence and limit parameters", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      updateEvent("evt3", "Three"),
      updateEvent("evt4", "Four")
    ]);

    const page = await store.readStream(stream, { maxSequence: 3, limit: 2 });

    expect(page.map((item) => item.sequence)).toEqual([2, 3]);
    const read = db.statements.at(-1);
    expect(read?.sql).toContain("sequence <= ?");
    expect(read?.sql).toContain("ORDER BY sequence DESC LIMIT ?");
    expect(read?.params).toEqual([stream, 3, 2]);
  });

  it("snapshots D1 event payloads and metadata across append and reads", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    const payload: Extract<DocumentEventPayload, { readonly kind: "DocumentUpdated" }> = {
      kind: "DocumentUpdated",
      patch: { title: "One", tags: ["first"] }
    };
    const metadata = { source: "desk", nested: { attempt: 1 } };
    const [saved] = await store.append(stream, 0, [
      {
        ...event,
        id: "evt-snapshot",
        type: "NoteUpdated",
        payload,
        metadata
      }
    ]);

    payload.patch.title = "mutated";
    (payload.patch.tags as JsonValue[]).push("caller");
    metadata.source = "mutated";
    metadata.nested.attempt = 2;
    ((saved!.payload as DocumentData).patch as DocumentData).title = "returned";
    (((saved!.payload as DocumentData).patch as DocumentData).tags as JsonValue[]).push("returned");
    (saved!.metadata as DocumentData).source = "returned";

    const [firstRead] = await store.readStream(stream);
    expect(firstRead).toMatchObject({
      payload: { kind: "DocumentUpdated", patch: { title: "One", tags: ["first"] } },
      metadata: { source: "desk", nested: { attempt: 1 } }
    });

    ((firstRead!.payload as DocumentData).patch as DocumentData).title = "read";
    (((firstRead!.payload as DocumentData).patch as DocumentData).tags as JsonValue[]).push("read");
    (firstRead!.metadata as DocumentData).source = "read";

    await expect(store.searchEvents({ tenantId: "acme", payloadKinds: ["DocumentUpdated"], limit: 1 })).resolves.toMatchObject([
      {
        payload: { kind: "DocumentUpdated", patch: { title: "One", tags: ["first"] } },
        metadata: { source: "desk", nested: { attempt: 1 } }
      }
    ]);
  });

  it("filters stream reads by payload kind in SQL", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      assignmentEvent("evt3", "DocumentAssigned"),
      assignmentEvent("evt4", "DocumentUnassigned")
    ]);

    const assignments = await store.readStream(stream, {
      maxSequence: 4,
      payloadKinds: ["DocumentAssigned", "DocumentUnassigned"]
    });

    expect(assignments.map((item) => item.payload.kind)).toEqual(["DocumentAssigned", "DocumentUnassigned"]);
    const read = db.statements.at(-1);
    expect(read?.sql).toContain("json_extract(payload_json, '$.kind') IN (?, ?)");
    expect(read?.params).toEqual([stream, 4, "DocumentAssigned", "DocumentUnassigned"]);
  });

  it("filters D1 stream and audit reads from payload kind when event type names are misleading", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      {
        ...updateEvent("evt2", "Two"),
        type: "NoteDeleted"
      },
      assignmentEvent("evt3", "DocumentAssigned")
    ]);

    await expect(store.readStream(stream, { payloadKinds: ["DocumentUpdated"] })).resolves.toMatchObject([
      {
        id: "evt2",
        type: "NoteDeleted",
        payload: { kind: "DocumentUpdated", patch: { title: "Two" } }
      }
    ]);
    await expect(store.searchEvents({ tenantId: "acme", payloadKinds: ["DocumentUpdated"] })).resolves.toMatchObject([
      {
        id: "evt2",
        type: "NoteDeleted",
        payload: { kind: "DocumentUpdated", patch: { title: "Two" } }
      }
    ]);
  });

  it("returns no D1 stream or audit events for empty payload kind filters", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two")
    ]);

    await expect(store.readStream(stream, { payloadKinds: [] })).resolves.toEqual([]);
    await expect(store.searchEvents({ tenantId: "acme", payloadKinds: [] })).resolves.toEqual([]);
    expect(db.statements.at(-2)?.sql).toContain("1 = 0");
    expect(db.statements.at(-1)?.sql).toContain("1 = 0");
  });

  it("searches audit events with tenant, metadata, kind, and limit filters", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      assignmentEvent("evt3", "DocumentAssigned")
    ]);
    await store.append("acme:Task:Two", 0, [{ ...event, id: "evt4", stream: "acme:Task:Two", doctype: "Task", documentName: "Two" }]);

    const results = await store.searchEvents({
      tenantId: "acme",
      doctype: "Note",
      documentName: "One",
      actorId: "owner",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-01T00:00:00.000Z",
      payloadKinds: ["DocumentUpdated"],
      limit: 10
    });

    expect(results.map((item) => item.id)).toEqual(["evt2"]);
    const read = db.statements.at(-1);
    expect(read?.sql).toContain("tenant_id = ?");
    expect(read?.sql).toContain("doctype = ?");
    expect(read?.sql).toContain("document_name = ?");
    expect(read?.sql).toContain("actor_id = ?");
    expect(read?.sql).toContain("occurred_at >= ?");
    expect(read?.sql).toContain("occurred_at <= ?");
    expect(read?.sql).toContain("json_extract(payload_json, '$.kind') IN (?)");
    expect(read?.sql).toContain("ORDER BY occurred_at DESC, stream ASC, sequence DESC LIMIT ?");
    expect(read?.params).toEqual([
      "acme",
      "Note",
      "One",
      "owner",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "DocumentUpdated",
      10
    ]);
  });

  it("reads one audit document stream chronologically through the stream index", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      assignmentEvent("evt3", "DocumentAssigned")
    ]);

    const results = await store.readDocumentEvents({
      tenantId: "acme",
      doctype: "Note",
      documentName: "One",
      limit: 2
    });

    expect(results.map((item) => item.id)).toEqual(["evt1", "evt2"]);
    const read = db.statements.at(-1);
    expect(read?.sql).toContain("WHERE stream = ?");
    expect(read?.sql).toContain("ORDER BY sequence ASC LIMIT ?");
    expect(read?.params).toEqual([stream, 2]);
  });

  it("rejects invalid stored D1 event JSON rows", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [event]);
    const row = db.events[0]!;

    row.payload_json = "[]";
    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });

    row.payload_json = JSON.stringify(event.payload);
    row.metadata_json = "{";
    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });
  });

  it("rejects stored D1 event payloads with non-finite JSON numbers", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [event]);
    const row = db.events[0]!;
    row.payload_json = '{"kind":"DocumentUpdated","patch":{"count":1e999}}';

    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });
  });

  it("rejects non-JSON D1 event payloads before writing rows", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);

    await expect(
      store.append(stream, 0, [
        {
          ...event,
          payload: { kind: "DocumentUpdated", patch: { count: Number.POSITIVE_INFINITY } } as never
        }
      ])
    ).rejects.toMatchObject({
      code: "EVENT_INVALID",
      status: 409
    });
    expect(db.events).toEqual([]);
  });

  it("rejects non-JSON D1 event metadata before writing rows", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);

    await expect(
      store.append(stream, 0, [{ ...event, metadata: { count: Number.POSITIVE_INFINITY } as never }])
    ).rejects.toMatchObject({
      code: "EVENT_INVALID",
      status: 409
    });
    expect(db.events).toEqual([]);
  });

  it("translates event append constraint races into document conflicts", async () => {
    const db = new FakeD1Database({ failEventInsertAsConstraint: true });
    const store = new D1EventStore(db as unknown as D1Database);

    await expect(store.append(stream, 0, [event])).rejects.toMatchObject({
      code: "DOCUMENT_CONFLICT",
      message: `Stream '${stream}' changed while appending`
    });
  });

  function updateEvent(id: string, title: string): NewDomainEvent {
    return {
      ...event,
      id,
      type: "NoteUpdated",
      payload: { kind: "DocumentUpdated", patch: { title } }
    };
  }

  function assignmentEvent(id: string, kind: "DocumentAssigned" | "DocumentUnassigned"): NewDomainEvent {
    return {
      ...event,
      id,
      type: kind,
      payload: { kind, assigneeId: "amy@example.com" }
    };
  }
});

function snapshotFrom(event: { tenantId: string; doctype: string; documentName: string; sequence: number; occurredAt: string; payload: any }): DocumentSnapshot {
  return {
    tenantId: event.tenantId,
    doctype: event.doctype,
    name: event.documentName,
    version: event.sequence,
    docstatus: event.payload.docstatus,
    data: event.payload.data,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt
  };
}

function automationRunEvent(
  id: string,
  runId: string,
  data: { readonly status: string; readonly enqueuedAt: string; readonly retryAt?: string; readonly deliveredAt?: string }
): NewDomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: `acme:__AutomationRuns:${runId}`,
    type: "AutomationRunEnqueued",
    doctype: "__AutomationRuns",
    documentName: runId,
    actorId: "owner",
    occurredAt: data.enqueuedAt,
    payload: {
      kind: "AutomationRunEnqueued",
      runId,
      sourceEventId: "evt-source",
      sourceEventType: "NoteUpdated",
      sourcePayloadKind: "DocumentUpdated",
      sourceDoctype: "Note",
      sourceDocumentName: "One",
      sourceActorId: "owner",
      ruleName: "Mirror",
      actionIndex: 0,
      action: { kind: "updateDocument", target: { doctype: "Note", name: "One" }, patch: { title: "Two" } },
      retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 }
    },
    metadata: {}
  };
}

function automationRunSnapshot(
  runId: string,
  version: number,
  status: string,
  data: { readonly enqueuedAt: string; readonly retryAt?: string; readonly deliveredAt?: string }
): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "__AutomationRuns",
    name: runId,
    version,
    docstatus: status === "delivered" ? "submitted" : status === "dead" ? "cancelled" : "draft",
    data: {
      sourceEventId: "evt-source",
      sourceEventType: "NoteUpdated",
      sourcePayloadKind: "DocumentUpdated",
      sourceDoctype: "Note",
      sourceDocumentName: "One",
      sourceActorId: "owner",
      ruleName: "Mirror",
      actionIndex: 0,
      action: { kind: "updateDocument", target: { doctype: "Note", name: "One" }, patch: { title: "Two" } },
      retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
      status,
      attempts: 0,
      enqueuedAt: data.enqueuedAt,
      ...(data.retryAt === undefined ? {} : { retryAt: data.retryAt }),
      ...(data.deliveredAt === undefined ? {} : { deliveredAt: data.deliveredAt })
    },
    createdAt: data.enqueuedAt,
    updatedAt: data.deliveredAt ?? data.retryAt ?? data.enqueuedAt
  };
}

class FakeD1Database {
  readonly events: any[] = [];
  readonly documents = new Map<string, any>();
  readonly automationRuns = new Map<string, any>();
  readonly statements: FakeD1PreparedStatement[] = [];
  readonly failDocumentUpsert: boolean;
  readonly failEventInsertAsConstraint: boolean;

  constructor(options: { readonly failDocumentUpsert?: boolean; readonly failEventInsertAsConstraint?: boolean } = {}) {
    this.failDocumentUpsert = options.failDocumentUpsert ?? false;
    this.failEventInsertAsConstraint = options.failEventInsertAsConstraint ?? false;
  }

  prepare(sql: string) {
    const statement = new FakeD1PreparedStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: FakeD1PreparedStatement[]) {
    const events = [...this.events];
    const documents = new Map(this.documents);
    const automationRuns = new Map(this.automationRuns);
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    } catch (error) {
      this.events.length = 0;
      this.events.push(...events);
      this.documents.clear();
      for (const [key, value] of documents) {
        this.documents.set(key, value);
      }
      this.automationRuns.clear();
      for (const [key, value] of automationRuns) {
        this.automationRuns.set(key, value);
      }
      throw error;
    }
  }
}

class FakeD1PreparedStatement {
  params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("COALESCE(MAX(sequence)")) {
      const stream = String(this.params[0]);
      const version = this.db.events
        .filter((event) => event.stream === stream)
        .reduce((max, event) => Math.max(max, event.sequence), 0);
      return { version };
    }
    return null;
  }

  async all() {
    if (this.sql.includes("FROM cf_frappe_automation_runs")) {
      const tenantId = String(this.params[0]);
      const now = String(this.params[1]);
      const limit = Number(this.params[2]);
      const indexed = [...this.db.automationRuns.values()]
        .filter((run) => run.tenant_id === tenantId)
        .filter((run) => ["pending", "failed", "claimed"].includes(String(run.status)))
        .filter((run) => run.available_at !== null && String(run.available_at) <= now)
        .sort((left, right) =>
          String(left.enqueued_at).localeCompare(String(right.enqueued_at)) ||
          String(left.run_id).localeCompare(String(right.run_id))
        )
        .slice(0, limit);
      return {
        results: indexed
          .map((run) => this.db.documents.get(`${run.tenant_id}:__AutomationRuns:${run.run_id}`))
          .filter((document) => document !== undefined)
      };
    }
    if (this.sql.includes("FROM cf_frappe_events") && this.sql.includes("stream = ?")) {
      if (this.sql.includes("1 = 0")) {
        return { results: [] };
      }
      const stream = String(this.params[0]);
      const maxSequence = this.sql.includes("sequence <= ?") ? Number(this.params[1]) : undefined;
      const limit = this.sql.includes("LIMIT ?") ? Number(this.params.at(-1)) : undefined;
      const kindOffset = 1 + (maxSequence === undefined ? 0 : 1);
      const kindParams = this.sql.includes("json_extract(payload_json, '$.kind')")
        ? this.params
            .slice(kindOffset, limit === undefined ? undefined : -1)
            .map(String)
        : undefined;
      const sortDescending = this.sql.includes("ORDER BY sequence DESC");
      const filtered = this.db.events
        .filter((event) => event.stream === stream)
        .filter((event) => maxSequence === undefined || event.sequence <= maxSequence)
        .filter((event) => kindParams === undefined || kindParams.includes(JSON.parse(String(event.payload_json)).kind))
        .sort((left, right) => sortDescending ? right.sequence - left.sequence : left.sequence - right.sequence);
      return {
        results: limit === undefined ? filtered : filtered.slice(0, limit)
      };
    }
    if (this.sql.includes("FROM cf_frappe_events") && this.sql.includes("tenant_id = ?")) {
      if (this.sql.includes("1 = 0")) {
        return { results: [] };
      }
      let index = 0;
      const tenantId = String(this.params[index++]);
      const doctype = this.sql.includes("doctype = ?") ? String(this.params[index++]) : undefined;
      const documentName = this.sql.includes("document_name = ?") ? String(this.params[index++]) : undefined;
      const actorId = this.sql.includes("actor_id = ?") ? String(this.params[index++]) : undefined;
      const since = this.sql.includes("occurred_at >= ?") ? String(this.params[index++]) : undefined;
      const until = this.sql.includes("occurred_at <= ?") ? String(this.params[index++]) : undefined;
      const kindParams = this.sql.includes("json_extract(payload_json, '$.kind')")
        ? this.params
            .slice(index, this.sql.includes("LIMIT ?") ? -1 : undefined)
            .map(String)
        : undefined;
      const limit = this.sql.includes("LIMIT ?") ? Number(this.params.at(-1)) : undefined;
      const filtered = this.db.events
        .filter((event) => event.tenant_id === tenantId)
        .filter((event) => doctype === undefined || event.doctype === doctype)
        .filter((event) => documentName === undefined || event.document_name === documentName)
        .filter((event) => actorId === undefined || event.actor_id === actorId)
        .filter((event) => since === undefined || event.occurred_at >= since)
        .filter((event) => until === undefined || event.occurred_at <= until)
        .filter((event) => kindParams === undefined || kindParams.includes(JSON.parse(String(event.payload_json)).kind))
        .sort((left, right) => {
          const time = String(right.occurred_at).localeCompare(String(left.occurred_at));
          if (time !== 0) {
            return time;
          }
          const stream = String(left.stream).localeCompare(String(right.stream));
          if (stream !== 0) {
            return stream;
          }
          return Number(right.sequence) - Number(left.sequence);
        });
      return {
        results: limit === undefined ? filtered : filtered.slice(0, limit)
      };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.includes("INSERT INTO cf_frappe_events")) {
      if (this.db.failEventInsertAsConstraint) {
        throw new Error("UNIQUE constraint failed");
      }
      const [
        id,
        tenant_id,
        stream,
        sequence,
        type,
        doctype,
        document_name,
        actor_id,
        occurred_at,
        payload_json,
        metadata_json
      ] = this.params;
      if (this.db.events.some((event) => event.stream === stream && event.sequence === sequence)) {
        throw new Error("UNIQUE constraint failed");
      }
      this.db.events.push({
        id,
        tenant_id,
        stream,
        sequence,
        type,
        doctype,
        document_name,
        actor_id,
        occurred_at,
        payload_json,
        metadata_json
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO cf_frappe_documents")) {
      if (this.db.failDocumentUpsert) {
        throw new Error("projection failed");
      }
      const [tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at] = this.params;
      this.db.documents.set(`${tenant_id}:${doctype}:${name}`, {
        tenant_id,
        doctype,
        name,
        version,
        docstatus,
        data_json,
        created_at,
        updated_at
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO cf_frappe_automation_runs")) {
      const [tenant_id, run_id, status, available_at, enqueued_at, updated_at] = this.params;
      this.db.automationRuns.set(`${tenant_id}:${run_id}`, {
        tenant_id,
        run_id,
        status,
        available_at,
        enqueued_at,
        updated_at
      });
      return { success: true };
    }
    return { success: true };
  }
}
