import {
  ConsistentProjectionStore,
  createRegistry,
  D1DocumentStore,
  D1EventStore,
  D1ProjectionStore,
  defineDocType,
  DocumentDeliveryOutboxService,
  DocumentService,
  documentDeliveryOutboxStream,
  documentStream,
  fixedClock,
  PROJECTED_FRAMEWORK_DOCTYPES,
  PROJECTION_OUTBOX_CHANNEL,
  ProjectionBackfillService,
  ProjectionDeliveryConsumer,
  ProjectionOutboxHandoff,
  QueryService,
  type Actor,
  type DocumentSnapshot,
  type IdGenerator,
  type MonotonicProjectionWriter
} from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";

/**
 * Issue #13 end to end, on the real SQLite engine behind the D1 facade: a
 * primary database for events, a second one for projections, and the delivery
 * outbox between them.
 */

const NOW = "2026-03-01T00:00:00.000Z";
const LATER = "2026-03-01T01:00:00.000Z";

const Ticket = defineDocType({
  name: "Ticket",
  naming: { kind: "series", pattern: "TICK-####" },
  fields: [
    { name: "subject", type: "text", required: true },
    { name: "code", type: "text", unique: true },
    { name: "status", type: "select", options: ["Open", "Closed"], defaultValue: "Open" }
  ],
  permissions: [{ roles: ["Agent"], actions: ["read", "create", "update", "submit", "cancel", "delete"] }]
});

const agent: Actor = { id: "agent@example.com", roles: ["Agent"], tenantId: "acme" };

// Shared across instances: several tests open a second service over the same
// primary, and event ids are a primary key there.
let nextId = 0;
function sequentialIds(prefix = "id"): IdGenerator {
  return { next: (head = "") => `${head}${prefix}${String((nextId += 1)).padStart(6, "0")}` };
}

interface Layout {
  readonly primary: TestD1;
  readonly projectionDb: TestD1;
  readonly documents: DocumentService;
  readonly consumer: ProjectionDeliveryConsumer;
  readonly reads: ConsistentProjectionStore;
  readonly projections: D1ProjectionStore;
  readonly queries: QueryService;
  readonly outbox: DocumentDeliveryOutboxService;
  readonly events: D1EventStore;
  close(): void;
}

function split(options: {
  readonly eager?: boolean;
  readonly projections?: (store: D1ProjectionStore) => MonotonicProjectionWriter;
  readonly primary?: TestD1;
  readonly projectionDb?: TestD1;
  readonly clock?: string;
  readonly onFallback?: () => void;
  readonly onLagAlert?: (alert: unknown) => void;
  readonly lag?: { readonly maxAgeSeconds?: number; readonly maxInFlight?: number };
  readonly onEagerApplyError?: (error: unknown) => void;
} = {}): Layout {
  const registry = createRegistry({ doctypes: [Ticket] });
  const primary = options.primary ?? createTestD1({ schema: frameworkSchema() });
  const projectionDb = options.projectionDb ?? createTestD1({ schema: frameworkSchema() });
  const projections = new D1ProjectionStore(projectionDb.database);
  const events = new D1EventStore(primary.database);
  const store = new D1DocumentStore(primary.database, {
    projectionHandoff: new ProjectionOutboxHandoff({
      ...(options.eager ? { eager: projections } : {}),
      ...(options.onEagerApplyError ? { onEagerApplyError: options.onEagerApplyError } : {})
    })
  });
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(options.clock ?? NOW),
    ids: sequentialIds()
  });
  const outbox = new DocumentDeliveryOutboxService({
    events,
    channel: PROJECTION_OUTBOX_CHANNEL,
    claimLeaseSeconds: 60,
    clock: fixedClock(options.clock ?? NOW),
    ids: sequentialIds("o")
  });
  const consumer = new ProjectionDeliveryConsumer({
    outbox,
    projections: options.projections?.(projections) ?? projections,
    clock: fixedClock(options.clock ?? NOW),
    ...(options.lag ? { lag: options.lag } : {}),
    ...(options.onLagAlert ? { onLagAlert: options.onLagAlert } : {})
  });
  const reads = new ConsistentProjectionStore({
    projections,
    events,
    ...(options.onFallback ? { onFallback: options.onFallback } : {})
  });
  return {
    primary,
    projectionDb,
    documents,
    consumer,
    reads,
    projections,
    events,
    outbox,
    queries: new QueryService({ registry, projections: reads }),
    close() {
      primary.close();
      projectionDb.close();
    }
  };
}

function single(primary: TestD1 = createTestD1({ schema: frameworkSchema() })) {
  const registry = createRegistry({ doctypes: [Ticket] });
  const documents = new DocumentService({
    registry,
    store: new D1DocumentStore(primary.database),
    clock: fixedClock(NOW),
    ids: sequentialIds()
  });
  return { primary, documents, queries: new QueryService({ registry, projections: new D1ProjectionStore(primary.database) }) };
}

function documentRows(d1: TestD1): readonly Record<string, unknown>[] {
  return d1.query(
    "SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at FROM cf_frappe_documents ORDER BY tenant_id, doctype, name"
  );
}

function projectionOutboxEvents(d1: TestD1): readonly Record<string, unknown>[] {
  return d1.query(
    "SELECT sequence, type, document_name, payload_json FROM cf_frappe_events WHERE stream = ? ORDER BY sequence",
    documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL)
  );
}

/** One of every commit shape: series naming, a unique reservation, its release, update, submit, delete. */
async function exercise(documents: DocumentService): Promise<void> {
  const first = await documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer", code: "A-1" } });
  const second = await documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Screen", code: "B-2" } });
  await documents.update({ actor: agent, doctype: "Ticket", name: first.name, patch: { code: "A-2", status: "Closed" } });
  await documents.submit({ actor: agent, doctype: "Ticket", name: first.name });
  await documents.delete({ actor: agent, doctype: "Ticket", name: second.name });
  await documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Keyboard", code: "B-2" } });
}

describe("projections in a separate D1 (issue #13)", () => {
  it("hands a commit's rows to the projection outbox in the same batch, and writes none to the primary", async () => {
    const layout = split();
    const created = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer", code: "A-1" } });

    expect(created.name).toBe("TICK-0001");
    expect(documentRows(layout.primary)).toEqual([]);
    expect(documentRows(layout.projectionDb)).toEqual([]);
    const handoff = projectionOutboxEvents(layout.primary);
    expect(handoff).toHaveLength(1);
    expect(handoff[0]).toMatchObject({ sequence: 1, type: "DocumentDeliveryOutboxEnqueued" });
    const payload = JSON.parse(String(handoff[0]!.payload_json)) as {
      readonly target: string;
      readonly payload: { readonly snapshots: readonly DocumentSnapshot[] };
    };
    expect(payload.target).toBe("projection");
    // The document, its naming counter and its unique reservation travel as one.
    expect(payload.payload.snapshots.map((snapshot) => snapshot.doctype)).toEqual([
      "Ticket",
      "__NamingSeries",
      "__UniqueValues"
    ]);
    // The notification outbox's stream is untouched: a separate channel.
    expect(layout.primary.query(
      "SELECT COUNT(*) AS n FROM cf_frappe_events WHERE stream = ?",
      documentDeliveryOutboxStream("acme")
    )).toEqual([{ n: 0 }]);
    layout.close();
  });

  it("rolls the events back with the handoff when the handoff cannot be written", async () => {
    const primary = createTestD1({ schema: frameworkSchema(), failSqlIncludes: "COALESCE(MAX(sequence), 0) + 1" });
    const layout = split({ primary });

    await expect(
      layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } })
    ).rejects.toThrow(/planned statement failed/);

    expect(primary.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 0 }]);
    layout.close();
  });

  it("appends at the head of the projection channel, so commits never conflict with each other there", async () => {
    const layout = split();
    for (let index = 0; index < 5; index += 1) {
      await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: `T${index}` } });
    }
    expect(projectionOutboxEvents(layout.primary).map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5]);
    layout.close();
  });

  it("drains the outbox into the projection database, which lists then read from", async () => {
    const layout = split();
    await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });
    await expect(layout.queries.listDocuments(agent, "Ticket")).resolves.toMatchObject({ total: 0 });

    const drained = await layout.consumer.drain({ tenantId: "acme" });

    expect(drained).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    expect(documentRows(layout.primary)).toEqual([]);
    await expect(layout.queries.listDocuments(agent, "Ticket")).resolves.toMatchObject({
      total: 1,
      data: [{ name: "TICK-0001", data: { subject: "Printer" } }]
    });
    await expect(layout.consumer.lag("acme")).resolves.toMatchObject({ inFlight: 0, ageSeconds: 0 });
    // Delivered in one completion: one Delivered event per record, no per-record folds.
    expect(projectionOutboxEvents(layout.primary).map((row) => row.type)).toEqual([
      "DocumentDeliveryOutboxEnqueued",
      "DocumentDeliveryOutboxClaimed",
      "DocumentDeliveryOutboxCheckpointed",
      "DocumentDeliveryOutboxDelivered"
    ]);
    layout.close();
  });

  it("delivers exactly the rows a single-database commit writes, for every commit shape", async () => {
    const reference = single();
    await exercise(reference.documents);
    const layout = split();
    await exercise(layout.documents);

    await layout.consumer.drain({ tenantId: "acme" });

    expect(documentRows(reference.primary).length).toBeGreaterThan(6);
    expect(documentRows(layout.projectionDb)).toEqual(documentRows(reference.primary));
    reference.primary.close();
    layout.close();
  });

  it("backfills the projection database to the same rows, from events alone", async () => {
    const reference = single();
    await exercise(reference.documents);
    const layout = split();
    await exercise(layout.documents);
    const backfill = new ProjectionBackfillService({
      events: layout.events,
      streams: layout.events,
      target: layout.projections
    });

    for (const doctype of ["Ticket", ...PROJECTED_FRAMEWORK_DOCTYPES]) {
      await backfill.run({ tenantId: "acme", doctype, batchSize: 2 });
    }

    expect(documentRows(layout.projectionDb)).toEqual(documentRows(reference.primary));
    layout.close();
    reference.primary.close();
  });

  it("keeps the newest row whatever order deliveries and backfills land in", async () => {
    const layout = split();
    const created = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "v1" } });
    await layout.documents.update({ actor: agent, doctype: "Ticket", name: created.name, patch: { subject: "v2" } });
    const latest = (await layout.reads.get("acme", "Ticket", created.name))!;

    await layout.projections.saveNewest([latest]);
    await layout.projections.saveNewest([created]);
    // The drain redelivers both records, oldest first, after the newest landed.
    await layout.consumer.drain({ tenantId: "acme" });

    await expect(layout.projections.get("acme", "Ticket", created.name)).resolves.toMatchObject({
      version: latest.version,
      data: { subject: "v2" }
    });
    layout.close();
  });

  it("does not regress the automation-run claim index with an older run snapshot", async () => {
    const projectionDb = createTestD1({ schema: frameworkSchema() });
    const projections = new D1ProjectionStore(projectionDb.database);
    const run = (version: number, status: string): DocumentSnapshot => ({
      tenantId: "acme",
      doctype: "__AutomationRuns",
      name: "run-1",
      version,
      docstatus: "draft",
      data: { status, enqueuedAt: NOW },
      createdAt: NOW,
      updatedAt: version === 1 ? NOW : LATER
    });

    await projections.saveNewest([run(2, "delivered")]);
    await projections.saveNewest([run(1, "pending")]);

    expect(projectionDb.query("SELECT status FROM cf_frappe_automation_runs")).toEqual([{ status: "delivered" }]);
    await expect(projections.listAutomationRunClaimCandidates({ tenantId: "acme", now: LATER, limit: 10 }))
      .resolves.toEqual([]);
    projectionDb.close();
  });

  it("applies eagerly after the commit, so the write is listable before any drain", async () => {
    const layout = split({ eager: true });
    await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });

    expect(documentRows(layout.projectionDb).map((row) => row.doctype)).toEqual(["Ticket", "__NamingSeries"]);
    // The record is still the guarantee, and draining it changes nothing.
    await expect(layout.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 1 });
    expect(documentRows(layout.projectionDb)).toHaveLength(2);
    layout.close();
  });

  it("never fails a write because the eager apply failed, and still delivers through the outbox", async () => {
    const projectionDb = createTestD1({ schema: frameworkSchema(), failSqlIncludes: "INSERT INTO cf_frappe_documents" });
    const errors: unknown[] = [];
    const layout = split({ eager: true, projectionDb, onEagerApplyError: (error) => errors.push(error) });

    const created = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });

    expect(created.name).toBe("TICK-0001");
    expect(errors).toHaveLength(1);
    expect(projectionOutboxEvents(layout.primary)).toHaveLength(1);
    layout.close();
  });

  it("fails a claim whose apply throws, then delivers it on the retry", async () => {
    let failures = 1;
    const primary = createTestD1({ schema: frameworkSchema() });
    const projectionDb = createTestD1({ schema: frameworkSchema() });
    const flaky = (store: D1ProjectionStore): MonotonicProjectionWriter => ({
      async saveNewest(snapshots) {
        if (failures > 0) {
          failures -= 1;
          throw new Error("projection database unavailable");
        }
        await store.saveNewest(snapshots);
      }
    });
    const first = split({ primary, projectionDb, projections: flaky });
    await first.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });

    await expect(first.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 0, failed: 1 });
    await expect(first.consumer.lag("acme")).resolves.toMatchObject({ inFlight: 1, failed: 1, maxAttempts: 1 });
    // Not due yet: the retry waits out its backoff.
    await expect(first.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ claimed: 0 });

    const later = split({ primary, projectionDb, projections: flaky, clock: LATER });
    await expect(later.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 1 });
    expect(documentRows(projectionDb).map((row) => row.name)).toContain("TICK-0001");
    first.close();
  });

  it("claims a record again once a dead consumer's lease runs out", async () => {
    const primary = createTestD1({ schema: frameworkSchema() });
    const projectionDb = createTestD1({ schema: frameworkSchema() });
    const layout = split({ primary, projectionDb });
    await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });
    // A consumer claims and dies before applying.
    await layout.outbox.claimPending({ tenantId: "acme", now: NOW });
    await expect(layout.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ claimed: 0 });

    const later = split({ primary, projectionDb, clock: LATER });
    await expect(later.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    layout.close();
  });

  it("retries a claim that loses its compare-and-swap to a commit's head append", async () => {
    let injected = false;
    const primary = createTestD1({
      schema: frameworkSchema(),
      beforeSql(sql) {
        // A commit appends at the head between the claim's read of the outbox
        // and its version check. (Injected at the check, not at the insert: the
        // insert runs inside the batch's transaction, whose rollback would take
        // the injected row with it.)
        if (!injected && sql.includes("AS version")) {
          const stream = documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL);
          const head = primary.query("SELECT payload_json FROM cf_frappe_events WHERE stream = ? AND sequence = 1", stream);
          if (head.length === 1) {
            injected = true;
            const payload = JSON.parse(String(head[0]!.payload_json)) as Record<string, unknown>;
            primary.query(
              `INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
               VALUES ('evt_racer', 'acme', ?, 2, 'DocumentDeliveryOutboxEnqueued', '__DocumentDeliveryOutbox', 'racer:projection', 'x', ?, ?, '{}')`,
              stream,
              NOW,
              JSON.stringify({ ...payload, outboxId: "racer:projection", sourceEventId: "racer" })
            );
          }
        }
      }
    });
    const layout = split({ primary });
    await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });
    injected = false;

    await expect(layout.consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ claimed: 2, delivered: 2 });
    expect(injected).toBe(true);
    layout.close();
  });

  describe("read consistency", () => {
    it("reads a document by name strongly: a lagging row falls back to the primary's events", async () => {
      const fallbacks: unknown[] = [];
      const layout = split({ onFallback: () => fallbacks.push(1) });
      const created = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "v1" } });
      await layout.consumer.drain({ tenantId: "acme" });
      await layout.documents.update({ actor: agent, doctype: "Ticket", name: created.name, patch: { subject: "v2" } });

      // The projection still says v1; the form load must not.
      await expect(layout.projections.get("acme", "Ticket", created.name)).resolves.toMatchObject({ data: { subject: "v1" } });
      await expect(layout.queries.getDocument(agent, "Ticket", created.name)).resolves.toMatchObject({
        data: { subject: "v2" }
      });
      expect(fallbacks).toHaveLength(1);

      await layout.consumer.drain({ tenantId: "acme" });
      await expect(layout.queries.getDocument(agent, "Ticket", created.name)).resolves.toMatchObject({
        data: { subject: "v2" }
      });
      // Caught up: served from the projection database without a fallback.
      expect(fallbacks).toHaveLength(1);
      layout.close();
    });

    it("finds a document the projection has never seen, and reports none for one that does not exist", async () => {
      const layout = split();
      const created = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });

      await expect(layout.reads.get("acme", "Ticket", created.name)).resolves.toMatchObject({ version: 1 });
      await expect(layout.reads.get("acme", "Ticket", "TICK-9999")).resolves.toBeNull();
      layout.close();
    });

    it("folds an automation run with its own fold, not the document fold", async () => {
      const primary = createTestD1({ schema: frameworkSchema() });
      const events = new D1EventStore(primary.database);
      await events.append(documentStream("acme", "__AutomationRuns", "run-1"), 0, [{
        id: "evt-run-1",
        tenantId: "acme",
        stream: documentStream("acme", "__AutomationRuns", "run-1"),
        type: "AutomationRunEnqueued",
        doctype: "__AutomationRuns",
        documentName: "run-1",
        actorId: "system",
        occurredAt: NOW,
        payload: {
          kind: "AutomationRunEnqueued",
          runId: "run-1",
          sourceEventId: "evt-source",
          sourceEventType: "TicketCreated",
          sourcePayloadKind: "DocumentCreated",
          sourceDoctype: "Ticket",
          sourceDocumentName: "TICK-0001",
          sourceActorId: agent.id,
          action: { kind: "updateDocument", target: { doctype: "Ticket", name: "TICK-0001" }, patch: { status: "Closed" } }
        },
        metadata: {}
      } as never]);
      const layout = split({ primary });

      await expect(layout.reads.get("acme", "__AutomationRuns", "run-1")).resolves.toMatchObject({
        doctype: "__AutomationRuns",
        name: "run-1",
        data: { status: "pending" }
      });
      layout.close();
    });

    it("decides naming series and unique values from events, with the projection database empty", async () => {
      const layout = split();
      const first = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "A", code: "X" } });
      const second = await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "B" } });

      expect([first.name, second.name]).toEqual(["TICK-0001", "TICK-0002"]);
      await expect(
        layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "C", code: "X" } })
      ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
      expect(documentRows(layout.projectionDb)).toEqual([]);
      layout.close();
    });
  });

  describe("lag", () => {
    it("is ok while the channel keeps up, and alerts once a record is older than the threshold", async () => {
      const primary = createTestD1({ schema: frameworkSchema() });
      const alerts: unknown[] = [];
      const atWrite = split({ primary, lag: { maxAgeSeconds: 60 }, onLagAlert: (alert) => alerts.push(alert) });
      await atWrite.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Printer" } });

      await expect(atWrite.consumer.checkLag("acme")).resolves.toMatchObject({ status: "ok", inFlight: 1, ageSeconds: 0 });
      expect(alerts).toEqual([]);

      const hourLater = split({ primary, clock: LATER, lag: { maxAgeSeconds: 60 }, onLagAlert: (alert) => alerts.push(alert) });
      const report = await hourLater.consumer.checkLag("acme");
      expect(report).toMatchObject({
        status: "lagging",
        breaches: ["age"],
        ageSeconds: 3600,
        oldestEnqueuedAt: NOW,
        thresholds: { maxAgeSeconds: 60 }
      });
      expect(alerts).toEqual([report]);
      atWrite.close();
    });

    it("alerts on the number of records in flight, whatever their age", async () => {
      const alerts: unknown[] = [];
      const layout = split({ lag: { maxInFlight: 2 }, onLagAlert: (alert) => alerts.push(alert) });
      for (const subject of ["A", "B", "C"]) {
        await layout.documents.create({ actor: agent, doctype: "Ticket", data: { subject } });
      }

      await expect(layout.consumer.checkLag("acme")).resolves.toMatchObject({ status: "lagging", breaches: ["in-flight"] });
      await layout.consumer.drain({ tenantId: "acme" });
      await expect(layout.consumer.checkLag("acme")).resolves.toMatchObject({ status: "ok", inFlight: 0 });
      expect(alerts).toHaveLength(1);
      layout.close();
    });
  });

  describe("switching layouts", () => {
    it("turns on without losing a write: backfill, switch, backfill again", async () => {
      const primary = createTestD1({ schema: frameworkSchema() });
      const before = single(primary);
      await before.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Old" } });
      const projectionDb = createTestD1({ schema: frameworkSchema() });
      const projections = new D1ProjectionStore(projectionDb.database);
      const events = new D1EventStore(primary.database);
      const backfill = new ProjectionBackfillService({ events, streams: events, target: projections });
      const backfillAll = async () => {
        for (const doctype of ["Ticket", ...PROJECTED_FRAMEWORK_DOCTYPES]) {
          await backfill.run({ tenantId: "acme", doctype });
        }
      };

      await backfillAll();
      // A write lands in the single layout after the first pass...
      await before.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "Straddler" } });
      // ...then the switch, and writes in the split layout.
      const after = split({ primary, projectionDb });
      await after.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "New" } });
      await after.consumer.drain({ tenantId: "acme" });
      await backfillAll();

      await expect(after.queries.listDocuments(agent, "Ticket", { orderBy: "name", order: "asc" })).resolves.toMatchObject({
        total: 3,
        data: [{ data: { subject: "Old" } }, { data: { subject: "Straddler" } }, { data: { subject: "New" } }]
      });
      after.close();
    });

    it("turns back off: the primary's own table is backfilled to what the projection database held", async () => {
      const layout = split();
      await exercise(layout.documents);
      await layout.consumer.drain({ tenantId: "acme" });
      expect(documentRows(layout.primary)).toEqual([]);

      const handedOff = projectionOutboxEvents(layout.primary).length;
      const back = single(layout.primary);
      const events = new D1EventStore(layout.primary.database);
      const backfill = new ProjectionBackfillService({
        events,
        streams: events,
        target: new D1ProjectionStore(layout.primary.database)
      });
      for (const doctype of ["Ticket", ...PROJECTED_FRAMEWORK_DOCTYPES]) {
        await backfill.run({ tenantId: "acme", doctype });
      }

      expect(documentRows(layout.primary)).toEqual(documentRows(layout.projectionDb));
      // And the single layout carries on writing inline from there.
      const created = await back.documents.create({ actor: agent, doctype: "Ticket", data: { subject: "After" } });
      await expect(back.queries.getDocument(agent, "Ticket", created.name)).resolves.toMatchObject({
        data: { subject: "After" }
      });
      // Inline again: nothing more is handed off.
      expect(projectionOutboxEvents(layout.primary)).toHaveLength(handedOff);
      layout.close();
    });
  });
});
