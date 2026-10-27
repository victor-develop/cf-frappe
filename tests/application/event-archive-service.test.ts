import { describe, expect, it } from "vitest";
import {
  D1ArchivedEvents,
  D1DocumentStore,
  D1EventArchive,
  D1EventStore,
  D1ProjectionStore,
  D1SnapshotStore,
  DEFAULT_EVENT_ARCHIVE_CUT_POLICIES,
  DOCUMENT_FOLD_NAME,
  DOCUMENT_FOLD_VERSION,
  DocumentDeliveryOutboxService,
  DocumentHistoryService,
  DocumentService,
  EventArchiveService,
  InMemoryColdEventStorage,
  InMemorySnapshotStore,
  QueryService,
  UserNotificationService,
  deliveryOutboxCutPolicy,
  documentDeliveryOutboxStream,
  documentFoldCutPolicy,
  documentStream,
  fixedClock,
  foldDocument,
  namingSeriesStream,
  parseStreamName,
  roleCatalogStream,
  userNotificationsCutPolicy,
  userNotificationsStream
} from "../../src";
import type {
  Clock,
  ColdEventReadMetrics,
  DocumentSnapshot,
  DomainEvent,
  EventArchiveCutPolicy,
  IdGenerator,
  StreamName
} from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";
import { createTestRegistry, data, manager, owner } from "../helpers";

/**
 * The archive service (issue #18) end to end on the real D1 engine: what it
 * decides to move, that the snapshot it moves under really covers the move, and
 * that every command and read that reaches into archived history still gets the
 * answer it got before.
 */

const TENANT = "acme";

function tickingClock(base = "2026-02-01T00:00:00.000Z"): Clock {
  let ticks = 0;
  return { now: () => new Date(Date.parse(base) + ticks++ * 1000).toISOString() };
}

function sequentialIds(): IdGenerator {
  let value = 0;
  return { next: (prefix = "") => `${prefix}${String(++value).padStart(5, "0")}` };
}

interface RigOptions {
  readonly keepHotEvents?: number;
  readonly minSegmentEvents?: number;
  readonly maxSegmentEvents?: number;
  readonly policies?: readonly EventArchiveCutPolicy[];
  /** The snapshot store the document service resumes from; none by default. */
  readonly documentSnapshots?: "none" | "fallback";
}

function rig(options: RigOptions = {}) {
  const d1 = createTestD1({ schema: frameworkSchema() });
  const storage = new InMemoryColdEventStorage();
  const metrics: ColdEventReadMetrics[] = [];
  const archived = new D1ArchivedEvents(d1.database, { storage, observer: (entry) => metrics.push(entry) });
  const events = new D1EventStore(d1.database, { archive: archived });
  const store = new D1DocumentStore(d1.database, { archive: archived });
  const projections = new D1ProjectionStore(d1.database);
  const durableSnapshots = new D1SnapshotStore(d1.database, { clock: fixedClock("2026-02-01T00:00:00.000Z") });
  const clock = tickingClock();
  const ids = sequentialIds();
  const registry = createTestRegistry();
  const documentService = (snapshots: "none" | "fallback") =>
    new DocumentService({
      registry,
      store,
      clock,
      ids,
      ...(snapshots === "fallback" ? { snapshots: new InMemorySnapshotStore({ fallback: durableSnapshots }) } : {})
    });
  const documents = documentService(options.documentSnapshots ?? "none");
  const queries = new QueryService({ registry, projections });
  const history = new DocumentHistoryService({ events, queries });
  const archive = new D1EventArchive(d1.database, { storage, clock: fixedClock("2026-02-02T00:00:00.000Z") });
  const service = new EventArchiveService({
    events,
    archive,
    snapshots: durableSnapshots,
    keepHotEvents: options.keepHotEvents ?? 0,
    minSegmentEvents: options.minSegmentEvents ?? 1,
    ...(options.maxSegmentEvents === undefined ? {} : { maxSegmentEvents: options.maxSegmentEvents }),
    ...(options.policies === undefined ? {} : { policies: options.policies })
  });
  return { d1, storage, metrics, events, store, projections, durableSnapshots, documents, documentService, history, archive, service, clock, ids };
}

type Rig = ReturnType<typeof rig>;

async function noteWithHistory(target: Rig, title: string, updates: number): Promise<DocumentSnapshot> {
  let snapshot = await target.documents.create({ actor: owner, doctype: "Note", data: data({ title, body: "v0" }) });
  for (let index = 1; index <= updates; index += 1) {
    snapshot = await target.documents.update({
      actor: owner,
      doctype: "Note",
      name: title,
      patch: { body: `v${index}`, count: index },
      expectedVersion: snapshot.version
    });
  }
  return snapshot;
}

function hotSequences(target: Rig, stream: StreamName): readonly number[] {
  return target.d1
    .query("SELECT sequence FROM cf_frappe_events WHERE stream = ? ORDER BY sequence", stream)
    .map((row) => Number(row.sequence));
}

describe("EventArchiveService", () => {
  it("records the document fold snapshot first, and archives only what it covers", async () => {
    const target = rig({ keepHotEvents: 3 });
    const latest = await noteWithHistory(target, "Quarterly review", 11);
    const stream = documentStream(TENANT, "Note", "Quarterly review");

    const result = await target.service.archiveStream(stream);

    expect(result).toEqual({ stream, status: "archived", archivedThrough: 9, segments: 1, events: 9 });
    const snapshot = await target.durableSnapshots.read<DocumentSnapshot>({
      stream,
      foldName: DOCUMENT_FOLD_NAME,
      foldVersion: DOCUMENT_FOLD_VERSION
    });
    // The snapshot is at the head, it is the document, and every archived
    // event is at or below it.
    expect(snapshot).toMatchObject({ uptoSequence: 12, state: latest });
    expect(Math.max(...(await target.archive.segments(stream)).map((segment) => segment.seqEnd))).toBeLessThanOrEqual(
      snapshot!.uptoSequence
    );
    expect(hotSequences(target, stream)).toEqual([10, 11, 12]);
    target.d1.close();
  });

  it("explains every stream it leaves alone", async () => {
    const target = rig({ minSegmentEvents: 5 });
    await noteWithHistory(target, "Small note", 1);
    const series = namingSeriesStream(TENANT, "Note", "N-.####");
    await target.events.append(series, 0, [
      {
        id: "series-1",
        tenantId: TENANT,
        stream: series,
        type: "NamingSeriesAdvanced",
        doctype: "__NamingSeries",
        documentName: "Note:N-.####",
        actorId: owner.id,
        occurredAt: "2026-02-01T00:00:00.000Z",
        payload: { kind: "DocumentUpdated", patch: { current: 1 } },
        metadata: {}
      }
    ]);

    await expect(target.service.archiveStream(series)).resolves.toMatchObject({ status: "skipped", reason: "protected" });
    await expect(target.service.archiveStream("garbage")).resolves.toMatchObject({ status: "skipped", reason: "protected" });
    await expect(target.service.archiveStream(roleCatalogStream(TENANT))).resolves.toMatchObject({
      status: "skipped",
      reason: "no-policy"
    });
    await expect(target.service.archiveStream(documentDeliveryOutboxStream(TENANT))).resolves.toMatchObject({
      status: "skipped",
      reason: "not-covered"
    });
    await expect(target.service.archiveStream(documentStream(TENANT, "Note", "Small note"))).resolves.toMatchObject({
      status: "skipped",
      reason: "below-minimum"
    });
    expect(target.d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 0 }]);
    target.d1.close();
  });

  it("never archives a protected stream, whatever a policy claims", async () => {
    // A policy that would cut anything at its head: the protection does not
    // depend on policies being written carefully.
    const everything: EventArchiveCutPolicy = { name: "everything", appliesTo: () => true, cutoff: async (context) => context.head };
    const target = rig({ policies: [everything] });
    const series = namingSeriesStream(TENANT, "Note", "N-.####");
    await target.events.append(series, 0, [
      {
        id: "series-1",
        tenantId: TENANT,
        stream: series,
        type: "NamingSeriesAdvanced",
        doctype: "__NamingSeries",
        documentName: "Note:N-.####",
        actorId: owner.id,
        occurredAt: "2026-02-01T00:00:00.000Z",
        payload: { kind: "DocumentUpdated", patch: { current: 1 } },
        metadata: {}
      }
    ]);

    const pass = await target.service.archivePass();

    expect(pass.results).toEqual([{ stream: series, status: "skipped", reason: "protected", archivedThrough: 0 }]);
    expect(hotSequences(target, series)).toEqual([1]);
    target.d1.close();
  });

  it("pages an archive pass with a cursor", async () => {
    const target = rig();
    for (const title of ["Note A", "Note B", "Note C"]) {
      await noteWithHistory(target, title, 2);
    }

    const first = await target.service.archivePass({ limit: 2 });
    const second = await target.service.archivePass({ after: first.next!, limit: 2 });

    expect(first.results.map((result) => result.status)).toEqual(["archived", "archived"]);
    expect(first.next).toBe(documentStream(TENANT, "Note", "Note B"));
    expect(second.results).toEqual([
      expect.objectContaining({ stream: documentStream(TENANT, "Note", "Note C"), status: "archived" })
    ]);
    expect(second.next).toBeUndefined();
    target.d1.close();
  });

  it("restores everything with a restore pass, after which a store without the archive reads it", async () => {
    const target = rig();
    await noteWithHistory(target, "Note A", 4);
    await noteWithHistory(target, "Note B", 4);
    await target.service.archivePass();
    expect(target.d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 0 }]);

    const restored = await target.service.restorePass();

    expect(restored.results).toEqual([
      { stream: documentStream(TENANT, "Note", "Note A"), segments: 1, events: 5 },
      { stream: documentStream(TENANT, "Note", "Note B"), segments: 1, events: 5 }
    ]);
    const plain = new D1EventStore(target.d1.database);
    expect((await plain.readStream(documentStream(TENANT, "Note", "Note A"))).length).toBe(5);
    target.d1.close();
  });

  describe("commands and reads on archived history", () => {
    /**
     * The same command history driven twice — once with nothing archived, once
     * with an archive pass between every step — must produce identical command
     * results, projections, timelines and streams. This is the issue's
     * "callers cannot tell" requirement as a differential test, and it covers
     * `cancel` and `amend`, which still fold whole streams.
     */
    async function drive(archiveBetweenSteps: boolean) {
      const target = rig();
      const results: unknown[] = [];
      const step = async (run: () => Promise<unknown>) => {
        results.push(await run());
        if (archiveBetweenSteps) {
          await target.service.archivePass();
        }
      };
      const name = "Quarterly review";
      let version = 0;
      const track = async (run: () => Promise<DocumentSnapshot>) =>
        step(async () => {
          const snapshot = await run();
          version = snapshot.version;
          return snapshot;
        });
      await track(() => target.documents.create({ actor: owner, doctype: "Note", data: data({ title: name, body: "draft" }) }));
      for (let index = 1; index <= 4; index += 1) {
        await track(() =>
          target.documents.update({ actor: owner, doctype: "Note", name, patch: { body: `pass ${index}` }, expectedVersion: version })
        );
      }
      await track(() => target.documents.assign({ actor: owner, doctype: "Note", name, assignee: manager.id, expectedVersion: version }));
      await track(() => target.documents.tag({ actor: owner, doctype: "Note", name, tag: "urgent", expectedVersion: version }));
      await track(() => target.documents.comment({ actor: owner, doctype: "Note", name, text: "ready", expectedVersion: version }));
      await track(() => target.documents.submit({ actor: owner, doctype: "Note", name, expectedVersion: version }));
      await track(() => target.documents.cancel({ actor: owner, doctype: "Note", name, expectedVersion: version }));
      await step(() =>
        target.documents.amend({
          actor: owner,
          doctype: "Note",
          name,
          newName: `${name} Rev 1`,
          data: { title: `${name} Rev 1`, body: "amended" },
          expectedVersion: version
        })
      );
      const timeline = await target.history.getTimeline(owner, "Note", name);
      const amendedTimeline = await target.history.getTimeline(owner, "Note", `${name} Rev 1`);
      const assignments = await target.history.getAssignments(owner, "Note", name);
      const stream = documentStream(TENANT, "Note", name);
      return {
        target,
        outcome: {
          results,
          timeline,
          amendedTimeline,
          assignments,
          projection: await target.projections.get(TENANT, "Note", name),
          stream: await target.events.readStream(stream),
          audit: await target.events.searchEvents({ tenantId: TENANT, documentName: name })
        }
      };
    }

    it("gives timeline, cancel and amend the answers they gave before archiving", async () => {
      const plain = await drive(false);
      const archived = await drive(true);

      expect(archived.outcome).toEqual(plain.outcome);
      // Guard against passing vacuously: the archived run really did move the
      // history out of the hot table, and really did read it back.
      const stream = documentStream(TENANT, "Note", "Quarterly review");
      expect(hotSequences(archived.target, stream)).toEqual([]);
      expect(plain.target.metrics).toEqual([]);
      expect(archived.target.metrics.length).toBeGreaterThan(0);
      plain.target.d1.close();
      archived.target.d1.close();
    });

    it("makes the cost of reaching into the archive measurable", async () => {
      const target = rig();
      await noteWithHistory(target, "Quarterly review", 6);
      await target.service.archivePass();
      target.metrics.length = 0;

      await target.history.getTimeline(owner, "Note", "Quarterly review");
      await target.documents.submit({ actor: owner, doctype: "Note", name: "Quarterly review", expectedVersion: 7 });
      await target.documents.cancel({ actor: owner, doctype: "Note", name: "Quarterly review", expectedVersion: 8 });

      expect(target.metrics.length).toBeGreaterThanOrEqual(3);
      for (const entry of target.metrics) {
        expect(entry).toMatchObject({ operation: "readStream", stream: documentStream(TENANT, "Note", "Quarterly review") });
        expect(entry.segments).toBeGreaterThan(0);
        expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      }
      target.d1.close();
    });

    it("lets a cold coordinator resume from the archived snapshot without touching the archive", async () => {
      // What the aggregate Durable Object does when the archive is on: its
      // in-memory snapshot store falls back to D1 on a miss, so an instance
      // that starts after the history moved reads the hot tail only.
      const target = rig();
      const latest = await noteWithHistory(target, "Quarterly review", 6);
      await target.service.archivePass();
      target.metrics.length = 0;

      const coldInstance = target.documentService("fallback");
      const updated = await coldInstance.update({
        actor: owner,
        doctype: "Note",
        name: "Quarterly review",
        patch: { body: "after archive" },
        expectedVersion: latest.version
      });

      expect(updated).toMatchObject({ version: 8, data: { body: "after archive", count: 6 } });
      expect(target.metrics).toEqual([]);
      expect(foldDocument(await target.events.readStream(documentStream(TENANT, "Note", "Quarterly review")))).toEqual(updated);
      target.d1.close();
    });
  });

  describe("projection replay parity with part of the history archived (#12)", () => {
    it("rebuilds every projection from hot and archived events alike", async () => {
      const target = rig({ keepHotEvents: 2, maxSegmentEvents: 2 });
      await noteWithHistory(target, "Quarterly review", 7);
      await noteWithHistory(target, "Retro notes", 3);
      await noteWithHistory(target, "Fully archived", 2);
      const tagged = await target.documents.tag({ actor: owner, doctype: "Note", name: "Retro notes", tag: "urgent" });
      await target.documents.follow({ actor: manager, doctype: "Note", name: "Retro notes", expectedVersion: tagged.version });
      await target.service.archivePass();
      // One stream entirely cold, with nothing left hot at all.
      await target.archive.archive(documentStream(TENANT, "Note", "Fully archived"), { through: 99 });

      const streams = await target.events.listStreams({ tenantId: TENANT, doctype: "Note" });
      const comparisons = [];
      for (const stream of streams) {
        const events = await target.events.readStream(stream);
        const name = events[0]!.documentName;
        comparisons.push({ name, live: await target.projections.get(TENANT, "Note", name), replayed: foldDocument(events) });
      }

      expect(comparisons.map((comparison) => comparison.name)).toEqual(["Fully archived", "Quarterly review", "Retro notes"]);
      expect(comparisons.map((comparison) => comparison.replayed)).toEqual(comparisons.map((comparison) => comparison.live));
      // Not vacuous: every stream really is partly or wholly cold.
      for (const stream of streams) {
        expect((await target.archive.segments(stream)).length, stream).toBeGreaterThan(0);
      }
      expect(hotSequences(target, documentStream(TENANT, "Note", "Fully archived"))).toEqual([]);
      target.d1.close();
    });
  });

  describe("unbounded streams", () => {
    it("archives a notification inbox under its own fold snapshot, and the inbox still reads whole", async () => {
      const target = rig({ keepHotEvents: 1 });
      const notifications = new UserNotificationService({
        events: target.events,
        snapshots: target.durableSnapshots,
        clock: fixedClock("2026-02-01T00:00:00.000Z"),
        ids: sequentialIds()
      });
      for (let index = 1; index <= 6; index += 1) {
        await notifications.recordFromDomainEvent(assignment(`evt_${String(index)}`));
      }
      const before = await notifications.inbox({ id: "support@example.com", roles: ["User"], tenantId: TENANT });
      const stream = userNotificationsStream(TENANT, "support@example.com");

      const result = await target.service.archiveStream(stream);

      expect(result).toMatchObject({ status: "archived", archivedThrough: 5 });
      expect(hotSequences(target, stream)).toEqual([6]);
      const fresh = new UserNotificationService({ events: target.events, snapshots: target.durableSnapshots });
      await expect(fresh.inbox({ id: "support@example.com", roles: ["User"], tenantId: TENANT })).resolves.toEqual(before);
      // Without its snapshot the inbox folds the archived history and still agrees.
      const unsnapshotted = new UserNotificationService({ events: target.events });
      await expect(unsnapshotted.inbox({ id: "support@example.com", roles: ["User"], tenantId: TENANT })).resolves.toEqual(before);
      target.d1.close();
    });

    it("cuts the delivery outbox at its checkpoint and keeps delivery exactly-once across the cut", async () => {
      const target = rig();
      const outbox = new DocumentDeliveryOutboxService({
        events: target.events,
        clock: fixedClock("2026-02-01T00:00:00.000Z"),
        ids: sequentialIds()
      });
      const deliver = async (round: number) => {
        await outbox.enqueueFromDomainEvent({ event: sourceEvent(`evt_round_${String(round)}`), targets: ["email"] });
        const [claimed] = await outbox.claimPending({ tenantId: TENANT, claimId: `claim-${String(round)}`, now: "2026-02-01T00:00:00.000Z" });
        await outbox.markDelivered({ tenantId: TENANT, outboxId: claimed!.id, claimId: `claim-${String(round)}` });
      };
      for (let round = 1; round <= 4; round += 1) {
        await deliver(round);
      }
      // One record left in flight, so the checkpoint carries it over.
      await outbox.enqueueFromDomainEvent({ event: sourceEvent("evt_pending"), targets: ["email"] });
      await outbox.claimPending({ tenantId: TENANT, claimId: "claim-pending", now: "2026-02-01T00:00:00.000Z" });
      await deliver(5);
      const stream = documentDeliveryOutboxStream(TENANT);
      const listBefore = await outbox.list(TENANT);
      const pendingFirst = (await target.events.readDocumentEvents({
        tenantId: TENANT,
        doctype: "__DocumentDeliveryOutbox",
        documentName: "evt_pending:email",
        stream,
        limit: 1
      }))[0]!.sequence;

      const result = await target.service.archiveStream(stream);

      expect(result).toMatchObject({ status: "archived" });
      const archivedThrough = (result as { archivedThrough: number }).archivedThrough;
      // The cut is below the carried-over record's first event.
      expect(pendingFirst).toBeGreaterThan(2);
      expect(archivedThrough).toBe(pendingFirst - 1);
      target.metrics.length = 0;
      await expect(outbox.list(TENANT)).resolves.toEqual(listBefore);
      // Re-enqueueing a delivered, archived record is still recognised.
      await outbox.enqueueFromDomainEvent({ event: sourceEvent("evt_round_1"), targets: ["email"] });
      await expect(outbox.record(TENANT, "evt_round_1:email")).resolves.toMatchObject({ status: "delivered" });
      expect((await outbox.list(TENANT)).map((record) => record.id)).toEqual(listBefore.map((record) => record.id));
      // The operations that run on every delivery stayed hot; only the lookups
      // of archived records reached the archive.
      expect(target.metrics.length).toBeGreaterThan(0);
      expect(target.metrics.every((entry) => entry.operation === "readDocumentEvents")).toBe(true);
      await deliver(6);
      await expect(outbox.record(TENANT, "evt_pending:email")).resolves.toMatchObject({ status: "claimed" });
      target.d1.close();
    });
  });

  describe("policies", () => {
    it("are on by default for documents, notification inboxes and the delivery outbox only", () => {
      expect(DEFAULT_EVENT_ARCHIVE_CUT_POLICIES).toEqual([documentFoldCutPolicy, userNotificationsCutPolicy, deliveryOutboxCutPolicy]);
      const applies = (stream: StreamName) =>
        DEFAULT_EVENT_ARCHIVE_CUT_POLICIES.filter((policy) => policy.appliesTo(parseStreamName(stream)!)).map((policy) => policy.name);
      expect(applies(documentStream(TENANT, "Return Request", "RMA-1"))).toEqual(["document"]);
      expect(applies(userNotificationsStream(TENANT, "a@b.c"))).toEqual(["userNotifications"]);
      expect(applies(documentDeliveryOutboxStream(TENANT))).toEqual(["documentDeliveryOutbox"]);
      expect(applies(roleCatalogStream(TENANT))).toEqual([]);
      expect(applies(namingSeriesStream(TENANT, "Note", "N"))).toEqual([]);
    });

    it("cut at the lowest answer when several apply", async () => {
      const target = rig({
        policies: [
          { name: "low", appliesTo: () => true, cutoff: async () => 2 },
          { name: "high", appliesTo: () => true, cutoff: async () => 5 }
        ]
      });
      await noteWithHistory(target, "Quarterly review", 6);

      await expect(target.service.archiveStream(documentStream(TENANT, "Note", "Quarterly review"))).resolves.toMatchObject({
        status: "archived",
        archivedThrough: 2
      });
      target.d1.close();
    });

    it("cut only where the snapshot store confirms a snapshot, not where one was written", async () => {
      // A store that accepts a write and keeps nothing — a failed upsert, a
      // dropped connection — must leave the stream uncovered, not archived on
      // the strength of a write that never landed.
      const target = rig();
      await noteWithHistory(target, "Quarterly review", 4);
      const forgetful = { read: async () => null, write: async () => undefined };
      const service = new EventArchiveService({
        events: target.events,
        archive: target.archive,
        snapshots: forgetful,
        keepHotEvents: 0,
        minSegmentEvents: 1
      });

      await expect(service.archiveStream(documentStream(TENANT, "Note", "Quarterly review"))).resolves.toMatchObject({
        status: "skipped",
        reason: "not-covered"
      });
      expect(hotSequences(target, documentStream(TENANT, "Note", "Quarterly review"))).toEqual([1, 2, 3, 4, 5]);
      target.d1.close();
    });

    it("fold only up to the head they read, so a racing append is never claimed by the snapshot", async () => {
      // The snapshot is labelled with the head read at the start. Folding
      // "everything so far" instead would let an append that lands mid-decision
      // into the state while the label says it is not, and resuming from that
      // snapshot would apply it twice.
      const target = rig();
      const latest = await noteWithHistory(target, "Quarterly review", 3);
      const stream = documentStream(TENANT, "Note", "Quarterly review");
      const racing = new D1EventStore(target.d1.database);
      const events = target.events;
      let raced = false;
      const racingEvents = Object.assign(Object.create(Object.getPrototypeOf(events)), events, {
        readStream: async (...args: Parameters<typeof events.readStream>) => {
          if (!raced) {
            raced = true;
            await racing.append(stream, latest.version, [
              {
                id: "racing-update",
                tenantId: TENANT,
                stream,
                type: "NoteUpdated",
                doctype: "Note",
                documentName: "Quarterly review",
                actorId: owner.id,
                occurredAt: "2026-02-03T00:00:00.000Z",
                payload: { kind: "DocumentUpdated", patch: { body: "raced" } },
                metadata: {}
              }
            ]);
          }
          return events.readStream(...args);
        }
      });
      const service = new EventArchiveService({
        events: racingEvents,
        archive: target.archive,
        snapshots: target.durableSnapshots,
        keepHotEvents: 0,
        minSegmentEvents: 1
      });

      await service.archiveStream(stream);

      const snapshot = await target.durableSnapshots.read<DocumentSnapshot>({
        stream,
        foldName: DOCUMENT_FOLD_NAME,
        foldVersion: DOCUMENT_FOLD_VERSION
      });
      expect(raced).toBe(true);
      expect(snapshot).toMatchObject({ uptoSequence: 4, state: latest });
      expect(hotSequences(target, stream)).toEqual([5]);
      target.d1.close();
    });
  });
});

function assignment(id: string): DomainEvent {
  return {
    id,
    tenantId: TENANT,
    stream: documentStream(TENANT, "Note", "My Note"),
    sequence: 2,
    type: "NoteAssigned",
    doctype: "Note",
    documentName: "My Note",
    actorId: owner.id,
    occurredAt: "2026-02-01T00:00:00.000Z",
    payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" },
    metadata: {}
  };
}

function sourceEvent(id: string): DomainEvent {
  return {
    id,
    tenantId: TENANT,
    stream: documentStream(TENANT, "Note", "One"),
    sequence: 1,
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: owner.id,
    occurredAt: "2026-02-01T00:00:00.000Z",
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };
}
