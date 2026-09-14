import { D1DocumentStore, D1EventStore, D1ProjectionStore } from "../../src";
import type { DocumentData, DocumentEventPayload, DocumentSnapshot, JsonValue, NewDomainEvent } from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";

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
    const d1 = engine();
    const store = new D1DocumentStore(d1.database);

    const commit = await store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!));

    expect(commit.snapshot).toMatchObject({ name: "One", version: 1 });
    await expect(store.readStream(stream)).resolves.toMatchObject([{ id: "evt1", sequence: 1 }]);
    expect(documentRow(d1, "Note", "One")).toMatchObject({ version: 1 });
  });

  it("commits multi-stream events and projections in one batch", async () => {
    const d1 = engine();
    const store = new D1DocumentStore(d1.database);
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
    expect(documentRow(d1, "__UniqueValues", "Note:title:s:One")).toMatchObject({ version: 1 });
    expect(documentRow(d1, "Note", "One")).toMatchObject({ version: 1 });
  });

  it("updates the D1 automation run claim index with automation run projections", async () => {
    const d1 = engine();
    const store = new D1DocumentStore(d1.database);
    const projections = new D1ProjectionStore(d1.database);
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

    expect(automationRunRow(d1, "run-1")).toMatchObject({
      status: "pending",
      available_at: "2026-01-01T00:00:00.000Z"
    });
    expect(automationRunRow(d1, "run-2")).toMatchObject({
      status: "failed",
      available_at: "2026-01-01T00:05:00.000Z"
    });
    expect(automationRunRow(d1, "run-3")).toMatchObject({
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
    const d1 = engine({ failSqlIncludes: "INSERT INTO cf_frappe_documents" });
    const store = new D1DocumentStore(d1.database);

    await expect(store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!))).rejects.toThrow(
      "planned statement failed"
    );
    await expect(store.readStream(stream)).resolves.toEqual([]);
    expect(documentCount(d1)).toBe(0);
  });

  it("rejects stale document batches and translates D1 constraint races", async () => {
    const d1 = engine();
    const store = new D1DocumentStore(d1.database);
    await store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!));
    await expect(store.commit(stream, 0, [{ ...event, id: "evt-stale" }], ([saved]) => snapshotFrom(saved!)))
      .rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    // A constraint race, for real: the same event id already committed under a
    // different stream passes the version check but violates the events table's
    // primary key mid-batch, which the adapter translates into a conflict.
    seedEvent(d1, { ...event, id: "evt-race", stream: "acme:Note:Other", documentName: "Other" });
    const racingStore = new D1DocumentStore(d1.database);
    await expect(
      racingStore.commit(
        "acme:Note:Fresh",
        0,
        [{ ...event, id: "evt-race", stream: "acme:Note:Fresh" }],
        ([saved]) => snapshotFrom(saved!)
      )
    ).rejects.toMatchObject({
      code: "DOCUMENT_CONFLICT",
      message: "One or more streams changed while committing"
    });
  });

  it("treats a missing D1 version row as an empty stream", async () => {
    const d1 = engine();
    const store = new D1DocumentStore(d1.database);
    await expect(store.currentVersion("missing")).resolves.toBe(0);
  });

  it("rolls back multi-stream event inserts when a batch projection upsert fails", async () => {
    const d1 = engine({ failSqlIncludes: "INSERT INTO cf_frappe_documents" });
    const store = new D1DocumentStore(d1.database);
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
    ).rejects.toThrow("planned statement failed");
    await expect(store.readStream(stream)).resolves.toEqual([]);
    await expect(store.readStream(otherStream)).resolves.toEqual([]);
    expect(documentCount(d1)).toBe(0);
  });

  it("reads a bounded recent stream page with bound sequence and limit parameters", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      updateEvent("evt3", "Three"),
      updateEvent("evt4", "Four")
    ]);

    const page = await store.readStream(stream, { maxSequence: 3, limit: 2 });

    expect(page.map((item) => item.sequence)).toEqual([2, 3]);
    const read = d1.statements.at(-1);
    expect(read?.sql).toContain("sequence <= ?");
    expect(read?.sql).toContain("ORDER BY sequence DESC LIMIT ?");
    expect(read?.params).toEqual([stream, 3, 2]);
  });

  it("reads the first forward stream page after a lower bound", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      updateEvent("evt3", "Three"),
      updateEvent("evt4", "Four")
    ]);

    const page = await store.readStream(stream, { minSequence: 2, limit: 2 });

    expect(page.map((item) => item.sequence)).toEqual([2, 3]);
    const read = d1.statements.at(-1);
    expect(read?.sql).toContain("sequence >= ?");
    expect(read?.sql).toContain("ORDER BY sequence ASC LIMIT ?");
    expect(read?.params).toEqual([stream, 2, 2]);
  });

  it("reads a continuation forward page with all stream filters", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      updateEvent("evt3", "Three"),
      updateEvent("evt4", "Four")
    ]);

    const page = await store.readStream(stream, {
      minSequence: 4,
      maxSequence: 4,
      payloadKinds: ["DocumentUpdated"],
      limit: 2
    });

    expect(page.map((item) => item.sequence)).toEqual([4]);
    const read = d1.statements.at(-1);
    expect(read?.sql).toContain("sequence >= ? AND sequence <= ?");
    expect(read?.sql).toContain("json_extract(payload_json, '$.kind') IN (?)");
    expect(read?.sql).toContain("ORDER BY sequence ASC LIMIT ?");
    expect(read?.params).toEqual([stream, 4, 4, "DocumentUpdated", 2]);
  });

  it("appends independent event streams in one D1 batch", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    const otherStream = "acme:__NamedWorkflowFields:Note%3Aworkflow_state";
    const saved = await store.appendBatch([
      { stream, expectedVersion: 0, events: [event] },
      {
        stream: otherStream,
        expectedVersion: 0,
        events: [{ ...event, id: "evt-field", stream: otherStream, doctype: "__NamedWorkflowFields" }]
      }
    ]);

    expect(saved).toMatchObject([
      { id: event.id, stream, sequence: 1 },
      { id: "evt-field", stream: otherStream, sequence: 1 }
    ]);
    await expect(store.readStream(stream)).resolves.toHaveLength(1);
    await expect(store.readStream(otherStream)).resolves.toHaveLength(1);
  });

  it("does not partially append a D1 event batch when one expected version is stale", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    const otherStream = "acme:__NamedWorkflowFields:Note%3Aworkflow_state";
    await store.append(stream, 0, [event]);

    await expect(store.appendBatch([
      { stream, expectedVersion: 0, events: [updateEvent("evt-stale", "Stale")] },
      {
        stream: otherStream,
        expectedVersion: 0,
        events: [{ ...event, id: "evt-field", stream: otherStream, doctype: "__NamedWorkflowFields" }]
      }
    ])).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(store.readStream(stream)).resolves.toHaveLength(1);
    await expect(store.readStream(otherStream)).resolves.toEqual([]);
  });

  it("snapshots D1 event payloads and metadata across append and reads", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
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
    const d1 = engine();
    const store = new D1EventStore(d1.database);
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
    const read = d1.statements.at(-1);
    expect(read?.sql).toContain("json_extract(payload_json, '$.kind') IN (?, ?)");
    expect(read?.params).toEqual([stream, 4, "DocumentAssigned", "DocumentUnassigned"]);
  });

  it("filters D1 stream and audit reads from payload kind when event type names are misleading", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
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
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two")
    ]);

    await expect(store.readStream(stream, { payloadKinds: [] })).resolves.toEqual([]);
    await expect(store.searchEvents({ tenantId: "acme", payloadKinds: [] })).resolves.toEqual([]);
    expect(d1.statements.at(-2)?.sql).toContain("1 = 0");
    expect(d1.statements.at(-1)?.sql).toContain("1 = 0");
  });

  it("searches audit events with tenant, metadata, kind, and limit filters", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
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
    const read = d1.statements.at(-1);
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
    const d1 = engine();
    const store = new D1EventStore(d1.database);
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
    const read = d1.statements.at(-1);
    expect(read?.sql).toContain("WHERE stream = ?");
    expect(read?.sql).toContain("ORDER BY sequence ASC LIMIT ?");
    expect(read?.params).toEqual([stream, 2]);
  });

  it("rejects invalid stored D1 event JSON rows", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [event]);

    corruptEventRow(d1, "evt1", { payload_json: "[]" });
    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });

    corruptEventRow(d1, "evt1", { metadata_json: "{" });
    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });
  });

  it("rejects pre-cutover workflow payloads and reads current workflow payloads", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [event]);

    corruptEventRow(d1, "evt1", {
      payload_json: JSON.stringify({
        kind: "WorkflowTransitioned",
        action: "close",
        from: "Open",
        to: "Closed",
        patch: { workflow_state: "Closed" }
      })
    });
    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });

    corruptEventRow(d1, "evt1", {
      payload_json: JSON.stringify({
        kind: "WorkflowTransitioned",
        workflow: "lifecycle",
        stateField: "workflow_state",
        action: "close",
        from: "Open",
        to: "Closed",
        patch: { workflow_state: "Closed" }
      })
    });
    await expect(store.readStream(stream)).resolves.toMatchObject([{
      payload: {
        kind: "WorkflowTransitioned",
        workflow: "lifecycle",
        stateField: "workflow_state",
        patch: { workflow_state: "Closed" }
      }
    }]);
  });

  it("rejects stored D1 event payloads with non-finite JSON numbers", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    await store.append(stream, 0, [event]);
    corruptEventRow(d1, "evt1", { payload_json: '{"kind":"DocumentUpdated","patch":{"count":1e999}}' });

    await expect(store.readStream(stream)).rejects.toMatchObject({
      code: "D1_EVENT_INVALID",
      status: 409
    });
  });

  it("rejects non-JSON D1 event payloads before writing rows", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);

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
    expect(eventCount(d1)).toBe(0);
  });

  it("rejects non-JSON D1 event metadata before writing rows", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);

    await expect(
      store.append(stream, 0, [{ ...event, metadata: { count: Number.POSITIVE_INFINITY } as never }])
    ).rejects.toMatchObject({
      code: "EVENT_INVALID",
      status: 409
    });
    expect(eventCount(d1)).toBe(0);
  });

  it("translates event append constraint races into document conflicts", async () => {
    const d1 = engine();
    const store = new D1EventStore(d1.database);
    // A constraint race, for real: the event id already exists under a
    // different stream, so the version check passes and the insert violates
    // the events table's primary key.
    seedEvent(d1, { ...event, stream: "acme:Note:Other", documentName: "Other" });

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

function engine(options: { readonly failSqlIncludes?: string } = {}): TestD1 {
  return createTestD1({ schema: frameworkSchema(), ...options });
}

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

/**
 * Inserts an event row with the exact column values given, bypassing the
 * store's own append path — the seed for the constraint-race tests, which need
 * a conflicting row that no valid append would produce.
 */
function seedEvent(d1: TestD1, event: NewDomainEvent): void {
  d1.query(
    `INSERT INTO cf_frappe_events
       (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.id,
    event.tenantId,
    event.stream,
    1,
    event.type,
    event.doctype,
    event.documentName,
    event.actorId,
    event.occurredAt,
    JSON.stringify(event.payload),
    JSON.stringify(event.metadata)
  );
}

/**
 * Rewrites stored JSON columns after an append, for rows real D1 could hold
 * but the adapter never writes — corrupt bytes that the serde layer must
 * reject where the reads happen, in the table itself.
 */
function corruptEventRow(
  d1: TestD1,
  id: string,
  columns: { readonly payload_json?: string; readonly metadata_json?: string }
): void {
  const assignments: string[] = [];
  const params: string[] = [];
  if (columns.payload_json !== undefined) {
    assignments.push("payload_json = ?");
    params.push(columns.payload_json);
  }
  if (columns.metadata_json !== undefined) {
    assignments.push("metadata_json = ?");
    params.push(columns.metadata_json);
  }
  d1.query(`UPDATE cf_frappe_events SET ${assignments.join(", ")} WHERE id = ?`, ...params, id);
}

function documentRow(d1: TestD1, doctype: string, name: string): Record<string, unknown> | undefined {
  const [row] = d1.query(
    "SELECT * FROM cf_frappe_documents WHERE tenant_id = ? AND doctype = ? AND name = ?",
    "acme",
    doctype,
    name
  );
  return row;
}

function documentCount(d1: TestD1): number {
  const [row] = d1.query("SELECT COUNT(*) AS n FROM cf_frappe_documents");
  return Number(row?.n);
}

function automationRunRow(d1: TestD1, runId: string): Record<string, unknown> | undefined {
  const [row] = d1.query(
    "SELECT * FROM cf_frappe_automation_runs WHERE tenant_id = ? AND run_id = ?",
    "acme",
    runId
  );
  return row;
}

function eventCount(d1: TestD1): number {
  const [row] = d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events");
  return Number(row?.n);
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
      ruleId: "mirror",
      ruleName: "Mirror",
      actionId: "update",
      action: { kind: "updateDocument", target: { doctype: "Note", name: "One" }, patch: { title: "Two" } },
      retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
      causationId: "evt-source",
      correlationId: "evt-source",
      automationDepth: 1,
      automationPath: ["mirror:update"]
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
      ruleId: "mirror",
      ruleName: "Mirror",
      actionId: "update",
      action: { kind: "updateDocument", target: { doctype: "Note", name: "One" }, patch: { title: "Two" } },
      retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
      causationId: "evt-source",
      correlationId: "evt-source",
      automationDepth: 1,
      automationPath: ["mirror:update"],
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
