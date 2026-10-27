import { describe, expect, it } from "vitest";
import {
  D1ArchivedEvents,
  D1DocumentStore,
  D1EventArchive,
  D1EventStore,
  InMemoryColdEventStorage,
  documentStream,
  fixedClock,
  namingSeriesStream,
  uniqueValueStream
} from "../../src";
import type {
  ColdEventPutOptions,
  ColdEventReadMetrics,
  ColdEventStorage,
  DocumentEventPayload,
  NewDomainEvent,
  ReadStreamOptions,
  StreamName
} from "../../src";
import { createTestD1, frameworkSchema, type TestD1Options } from "../d1-engine.js";

/**
 * The D1 event archive (issue #18) on the real SQLite engine.
 *
 * The archive is the only code in the framework that deletes rows from
 * `cf_frappe_events`, so most of what is here is about the deletion: that it
 * happens only after a verified cold copy exists, only in the same transaction
 * that indexes it, and never for a protected stream — and that every read a
 * caller can make returns exactly what it returned before the move.
 */

const TENANT = "acme";
const NOW = "2026-03-01T00:00:00.000Z";

function harness(options: { readonly storage?: ColdEventStorage; readonly d1?: TestD1Options } = {}) {
  const d1 = createTestD1({ ...options.d1, schema: frameworkSchema() });
  const storage = options.storage ?? new InMemoryColdEventStorage();
  const metrics: ColdEventReadMetrics[] = [];
  const archived = new D1ArchivedEvents(d1.database, { storage, observer: (entry) => metrics.push(entry) });
  return {
    d1,
    storage,
    metrics,
    archived,
    hot: new D1EventStore(d1.database),
    events: new D1EventStore(d1.database, { archive: archived }),
    documents: new D1DocumentStore(d1.database, { archive: archived }),
    archive: new D1EventArchive(d1.database, { storage, clock: fixedClock(NOW) })
  };
}

function event(
  stream: StreamName,
  index: number,
  overrides: Partial<NewDomainEvent> & { readonly kind?: DocumentEventPayload["kind"] } = {}
): NewDomainEvent {
  const kind = overrides.kind ?? (index === 1 ? "DocumentCreated" : index % 3 === 0 ? "DocumentCommentAdded" : "DocumentUpdated");
  const payload =
    kind === "DocumentCreated"
      ? { kind, data: { title: `v${index}` } }
      : kind === "DocumentCommentAdded"
        ? { kind, commentId: `c${index}`, text: `comment ${index}` }
        : { kind, patch: { title: `v${index}` } };
  return {
    id: `${stream}#${index}`,
    tenantId: TENANT,
    stream,
    type: kind,
    doctype: "Note",
    documentName: "One",
    actorId: index % 2 === 0 ? "owner" : "manager",
    occurredAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000).toISOString(),
    payload,
    metadata: { index },
    ...overrides
  } as NewDomainEvent;
}

async function seed(store: D1EventStore, stream: StreamName, count: number, from = 1): Promise<void> {
  for (let index = from; index < from + count; index += 1) {
    await store.append(stream, index - 1, [event(stream, index)]);
  }
}

const NOTE = documentStream(TENANT, "Note", "One");

/** Every shape of read the ports allow, over a stream of `length` events. */
function readGrid(length: number): readonly ReadStreamOptions[] {
  const grid: ReadStreamOptions[] = [{}];
  for (let bound = 0; bound <= length + 1; bound += 1) {
    grid.push({ minSequence: bound }, { maxSequence: bound });
    for (const limit of [1, 3, length]) {
      grid.push({ minSequence: bound, limit }, { maxSequence: bound, limit });
    }
    grid.push({ minSequence: bound, maxSequence: bound + 4 });
  }
  for (const limit of [0, 1, 2, 5, length, length + 3]) {
    grid.push({ limit });
  }
  for (const payloadKinds of [[], ["DocumentCommentAdded"], ["DocumentUpdated", "DocumentCreated"]] as const) {
    grid.push({ payloadKinds }, { payloadKinds, limit: 2 }, { payloadKinds, minSequence: 4, limit: 3 }, { payloadKinds, maxSequence: 7 });
  }
  return grid;
}

describe("D1EventArchive", () => {
  it("moves a prefix to cold storage and removes it from the hot table", async () => {
    const { d1, hot, archive, storage } = harness();
    await seed(hot, NOTE, 12);

    const moved = await archive.archive(NOTE, { through: 8, maxSegmentEvents: 3 });

    expect(moved.archivedThrough).toBe(8);
    expect(moved.segments.map((segment) => [segment.seqStart, segment.seqEnd])).toEqual([[1, 3], [4, 6], [7, 8]]);
    expect(d1.query("SELECT sequence FROM cf_frappe_events ORDER BY sequence").map((row) => row.sequence)).toEqual([
      9, 10, 11, 12
    ]);
    expect(d1.query("SELECT stream, seq_start, seq_end, tenant_id, doctype, event_count FROM cf_frappe_event_archive_segments ORDER BY seq_start")).toEqual([
      { stream: NOTE, seq_start: 1, seq_end: 3, tenant_id: TENANT, doctype: "Note", event_count: 3 },
      { stream: NOTE, seq_start: 4, seq_end: 6, tenant_id: TENANT, doctype: "Note", event_count: 3 },
      { stream: NOTE, seq_start: 7, seq_end: 8, tenant_id: TENANT, doctype: "Note", event_count: 2 }
    ]);
    // Laid out by stream, not by time, with sortable sequence ranges.
    expect([...(storage as InMemoryColdEventStorage).objects.keys()]).toEqual([
      expect.stringMatching(/^events\/acme\/Note\/[0-9a-f]{64}\/000000000001-000000000003\.ndjson$/),
      expect.stringMatching(/^events\/acme\/Note\/[0-9a-f]{64}\/000000000004-000000000006\.ndjson$/),
      expect.stringMatching(/^events\/acme\/Note\/[0-9a-f]{64}\/000000000007-000000000008\.ndjson$/)
    ]);
    d1.close();
  });

  it("archives incrementally from where the previous run stopped", async () => {
    const { d1, hot, archive } = harness();
    await seed(hot, NOTE, 10);
    await archive.archive(NOTE, { through: 4 });

    const second = await archive.archive(NOTE, { through: 9 });

    expect(second.segments.map((segment) => [segment.seqStart, segment.seqEnd])).toEqual([[5, 9]]);
    expect((await archive.segments(NOTE)).map((segment) => segment.seqEnd)).toEqual([4, 9]);
    d1.close();
  });

  it("never moves past the stream head or below the minimum", async () => {
    const { d1, hot, archive } = harness();
    await seed(hot, NOTE, 5);

    expect((await archive.archive(NOTE, { through: 5, minEvents: 6 })).segments).toEqual([]);
    const moved = await archive.archive(NOTE, { through: 99 });
    expect(moved.archivedThrough).toBe(5);
    expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 0 }]);
    d1.close();
  });

  describe("currentVersion", () => {
    it("stays correct when the hot tail is empty", async () => {
      // The issue's first design question: without a high-water mark the
      // version falls back to 0 once every event has moved, and the next append
      // would reuse sequence 1.
      const { d1, hot, events, documents, archive } = harness();
      await seed(hot, NOTE, 6);
      await archive.archive(NOTE, { through: 6 });
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events WHERE stream = ?", NOTE)).toEqual([{ n: 0 }]);

      await expect(events.currentVersion(NOTE)).resolves.toBe(6);
      await expect(documents.currentVersion(NOTE)).resolves.toBe(6);
      // Even a store with no archive configured reads the high-water mark.
      await expect(hot.currentVersion(NOTE)).resolves.toBe(6);
      d1.close();
    });

    it("rejects an append at the pre-archive version and accepts one at the true head", async () => {
      const { d1, hot, events, archive } = harness();
      await seed(hot, NOTE, 6);
      await archive.archive(NOTE, { through: 6 });

      await expect(events.append(NOTE, 0, [event(NOTE, 99)])).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
      const [saved] = await events.append(NOTE, 6, [event(NOTE, 7)]);
      expect(saved!.sequence).toBe(7);
      expect((await events.readStream(NOTE)).map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      d1.close();
    });

    it("guards document commits the same way", async () => {
      const { d1, hot, documents, archive } = harness();
      await seed(hot, NOTE, 3);
      await archive.archive(NOTE, { through: 3 });
      const project = () => ({
        tenantId: TENANT,
        doctype: "Note",
        name: "One",
        version: 4,
        docstatus: "draft" as const,
        data: {},
        createdAt: NOW,
        updatedAt: NOW
      });

      await expect(documents.commit(NOTE, 2, [event(NOTE, 4)], project)).rejects.toMatchObject({
        code: "DOCUMENT_CONFLICT"
      });
      const commit = await documents.commit(NOTE, 3, [event(NOTE, 4)], project);
      expect(commit.events[0]!.sequence).toBe(4);
      d1.close();
    });
  });

  describe("protected streams", () => {
    const protectedStreams = [
      namingSeriesStream(TENANT, "Return Request", "RMA-.YYYY.-"),
      uniqueValueStream(TENANT, "Customer", "customer_id", "s:CUST-1"),
      "not-a-framework-stream"
    ];

    for (const stream of protectedStreams) {
      it(`refuses to archive ${stream}`, async () => {
        const { d1, hot, archive } = harness();
        await seed(hot, stream, 3);

        await expect(archive.archive(stream, { through: 3 })).rejects.toMatchObject({
          code: "EVENT_ARCHIVE_STREAM_PROTECTED"
        });
        expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 3 }]);
        expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 0 }]);
        d1.close();
      });
    }
  });

  describe("reads across the hot/cold boundary", () => {
    it("returns exactly what every read returned before the move", async () => {
      const { d1, hot, events, archive } = harness();
      await seed(hot, NOTE, 14);
      const grid = readGrid(14);
      const before = await Promise.all(grid.map((options) => hot.readStream(NOTE, options)));

      // A partial archive, a second one, and a full one: the boundary sits at
      // 5, then 11, then past the end.
      for (const through of [5, 11, 14]) {
        await archive.archive(NOTE, { through, maxSegmentEvents: 4 });
        for (const [index, options] of grid.entries()) {
          expect(await events.readStream(NOTE, options), `${JSON.stringify(options)} through ${through}`).toEqual(
            before[index]
          );
        }
      }
      d1.close();
    });

    it("answers document-event reads in both orders, with and without an explicit stream", async () => {
      const { d1, hot, events, archive } = harness();
      const outbox = documentStream(TENANT, "__DocumentDeliveryOutbox", "deliveries");
      for (let index = 1; index <= 12; index += 1) {
        await hot.append(outbox, index - 1, [
          event(outbox, index, {
            doctype: "__DocumentDeliveryOutbox",
            documentName: index % 4 === 0 ? "__checkpoint" : `record-${index % 3}`
          })
        ]);
      }
      await seed(hot, NOTE, 9);
      const queries = [
        ...["record-0", "record-1", "record-2", "__checkpoint", "absent"].flatMap((documentName) => [
          { tenantId: TENANT, doctype: "__DocumentDeliveryOutbox", documentName, stream: outbox },
          { tenantId: TENANT, doctype: "__DocumentDeliveryOutbox", documentName, stream: outbox, limit: 1 },
          { tenantId: TENANT, doctype: "__DocumentDeliveryOutbox", documentName, stream: outbox, order: "desc" as const, limit: 1 },
          { tenantId: TENANT, doctype: "__DocumentDeliveryOutbox", documentName, stream: outbox, order: "desc" as const }
        ]),
        { tenantId: TENANT, doctype: "Note", documentName: "One" },
        { tenantId: TENANT, doctype: "Note", documentName: "One", limit: 2 },
        { tenantId: TENANT, doctype: "Note", documentName: "One", order: "desc" as const, limit: 3 },
        { tenantId: TENANT, doctype: "Note", documentName: "One", order: "desc" as const }
      ];
      const before = await Promise.all(queries.map((query) => hot.readDocumentEvents(query)));

      await archive.archive(outbox, { through: 9, maxSegmentEvents: 4 });
      await archive.archive(NOTE, { through: 9 });

      for (const [index, query] of queries.entries()) {
        expect(await events.readDocumentEvents(query), JSON.stringify(query)).toEqual(before[index]);
      }
      // The per-name index is what keeps a lookup of a record that was never
      // archived from reading every segment of a shared stream.
      expect(
        d1.query("SELECT document_name FROM cf_frappe_event_archive_documents WHERE stream = ? AND seq_start = 1 ORDER BY document_name", outbox)
      ).toEqual([
        { document_name: "__checkpoint" },
        { document_name: "record-0" },
        { document_name: "record-1" },
        { document_name: "record-2" }
      ]);
      d1.close();
    });

    it("answers the audit search with archived events merged in audit order", async () => {
      const { d1, hot, events, archive } = harness();
      const other = documentStream(TENANT, "Task", "T-1");
      await seed(hot, NOTE, 10);
      for (let index = 1; index <= 6; index += 1) {
        await hot.append(other, index - 1, [event(other, index, { doctype: "Task", documentName: "T-1" })]);
      }
      // Archived in full, yet newer than every hot event: an audit page that the
      // hot rows alone appear to fill must still reach into the archive for it.
      const late = documentStream(TENANT, "Task", "T-late");
      for (let index = 1; index <= 2; index += 1) {
        await hot.append(late, index - 1, [
          event(late, index, { doctype: "Task", documentName: "T-late", occurredAt: `2026-06-0${index}T00:00:00.000Z` })
        ]);
      }
      const queries = [
        { tenantId: TENANT },
        { tenantId: TENANT, limit: 3 },
        { tenantId: TENANT, limit: 1 },
        { tenantId: TENANT, limit: 12 },
        { tenantId: TENANT, doctype: "Task" },
        { tenantId: TENANT, documentName: "One", limit: 4 },
        { tenantId: TENANT, actorId: "owner" },
        { tenantId: TENANT, payloadKinds: ["DocumentCommentAdded" as const] },
        { tenantId: TENANT, since: "2026-01-01T00:03:00.000Z", until: "2026-01-01T00:07:00.000Z" },
        { tenantId: "other-tenant" }
      ];
      const before = await Promise.all(queries.map((query) => hot.searchEvents(query)));

      await archive.archive(NOTE, { through: 7, maxSegmentEvents: 3 });
      await archive.archive(other, { through: 6 });
      await archive.archive(late, { through: 2 });

      for (const [index, query] of queries.entries()) {
        expect(await events.searchEvents(query), JSON.stringify(query)).toEqual(before[index]);
      }
      d1.close();
    });

    it("lists a stream whose every event is archived", async () => {
      // A rebuild enumerates streams before folding them; one with no hot row
      // left would otherwise drop its document from the rebuild entirely.
      const { d1, hot, events, archive } = harness();
      const second = documentStream(TENANT, "Note", "Two");
      await seed(hot, NOTE, 3);
      await seed(hot, second, 2);
      await archive.archive(NOTE, { through: 3 });

      await expect(hot.listStreams({ tenantId: TENANT, doctype: "Note" })).resolves.toEqual([second]);
      await expect(events.listStreams({ tenantId: TENANT, doctype: "Note" })).resolves.toEqual([NOTE, second]);
      d1.close();
    });

    it("refuses, rather than truncates, a read through a store with no archive configured", async () => {
      // The state a deployment reaches if the archive is switched off — or left
      // off in one of the two places it is configured — after streams moved.
      const { d1, hot, archive } = harness();
      await seed(hot, NOTE, 6);
      await archive.archive(NOTE, { through: 4 });

      for (const options of [{}, { maxSequence: 5 }, { minSequence: 2 }, { limit: 4 }]) {
        await expect(hot.readStream(NOTE, options), JSON.stringify(options)).rejects.toMatchObject({
          code: "EVENT_ARCHIVE_REQUIRED"
        });
      }
      // Reads that only need the hot tail still work.
      expect((await hot.readStream(NOTE, { minSequence: 5 })).map((entry) => entry.sequence)).toEqual([5, 6]);
      expect((await hot.readStream(NOTE, { limit: 2 })).map((entry) => entry.sequence)).toEqual([5, 6]);
      d1.close();
    });

    it("reports what a cold read cost, and serves a repeat from the cache", async () => {
      const { d1, hot, events, archive, metrics } = harness();
      await seed(hot, NOTE, 8);
      await archive.archive(NOTE, { through: 6, maxSegmentEvents: 3 });

      await events.readStream(NOTE);
      await events.readStream(NOTE);
      await events.readStream(NOTE, { minSequence: 7 });

      expect(metrics).toEqual([
        expect.objectContaining({ operation: "readStream", stream: NOTE, segments: 2, cachedSegments: 0, archivedEvents: 6 }),
        expect.objectContaining({ operation: "readStream", stream: NOTE, segments: 2, cachedSegments: 2, archivedEvents: 6 })
      ]);
      expect(metrics.every((entry) => entry.durationMs >= 0)).toBe(true);
      d1.close();
    });
  });

  describe("never deletes an event", () => {
    it("leaves the hot rows when the cold write fails", async () => {
      const failing: ColdEventStorage = {
        put: async () => {
          throw new Error("R2 unavailable");
        },
        get: async () => null
      };
      const { d1, hot, archive } = harness({ storage: failing });
      await seed(hot, NOTE, 4);

      await expect(archive.archive(NOTE, { through: 4 })).rejects.toThrow("R2 unavailable");
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 4 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 0 }]);
      d1.close();
    });

    it("leaves the hot rows when the read-back does not match what was written", async () => {
      const inner = new InMemoryColdEventStorage();
      const corrupting: ColdEventStorage = {
        put: (key: string, body: string, options: ColdEventPutOptions) => inner.put(key, body, options),
        get: async (key: string) => (await inner.get(key))?.replace("v2", "v9") ?? null
      };
      const { d1, hot, archive } = harness({ storage: corrupting });
      await seed(hot, NOTE, 4);

      await expect(archive.archive(NOTE, { through: 4 })).rejects.toMatchObject({ code: "EVENT_ARCHIVE_INTEGRITY" });
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 4 }]);
      d1.close();
    });

    it("leaves the hot rows when the read-back is missing", async () => {
      const lossy: ColdEventStorage = { put: async () => undefined, get: async () => null };
      const { d1, hot, archive } = harness({ storage: lossy });
      await seed(hot, NOTE, 4);

      await expect(archive.archive(NOTE, { through: 4 })).rejects.toMatchObject({ code: "EVENT_ARCHIVE_INTEGRITY" });
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 4 }]);
      d1.close();
    });

    it("rolls the index back with the delete when the batch fails", async () => {
      const { d1, hot, archive } = harness({ d1: { failSqlIncludes: "DELETE FROM cf_frappe_events" } });
      await seed(hot, NOTE, 4);

      await expect(archive.archive(NOTE, { through: 4 })).rejects.toThrow("planned statement failed");
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 4 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 0 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_documents")).toEqual([{ n: 0 }]);
      d1.close();
    });

    it("deletes nothing when another archiver moved the range first", async () => {
      // A concurrent archiver commits the same range between this one's read
      // and its batch. The insert's guard sees the prefix no longer ends where
      // it did, inserts nothing, and the delete — guarded on this exact index
      // row — removes nothing.
      let raced = false;
      const { d1, hot, archive } = harness({
        d1: {
          beforeSql: (sql) => {
            if (!raced && sql.startsWith("INSERT INTO cf_frappe_event_archive_segments")) {
              raced = true;
              d1.query(
                "INSERT INTO cf_frappe_event_archive_segments VALUES (?, 1, 2, ?, 'Note', ?, ?, 2, 'elsewhere', 'other', 1, ?)",
                NOTE,
                TENANT,
                NOW,
                NOW,
                NOW
              );
            }
          }
        }
      });
      await seed(hot, NOTE, 4);

      await expect(archive.archive(NOTE, { through: 4 })).rejects.toMatchObject({ code: "EVENT_ARCHIVE_CONFLICT" });
      expect(raced).toBe(true);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 4 }]);
      d1.close();
    });

    it("deletes nothing when a hot row disappeared before the batch", async () => {
      let raced = false;
      const { d1, hot, archive } = harness({
        d1: {
          beforeSql: (sql) => {
            if (!raced && sql.startsWith("INSERT INTO cf_frappe_event_archive_segments")) {
              raced = true;
              d1.query("UPDATE cf_frappe_events SET sequence = 40 WHERE stream = ? AND sequence = 2", NOTE);
            }
          }
        }
      });
      await seed(hot, NOTE, 4);

      await expect(archive.archive(NOTE, { through: 4 })).rejects.toMatchObject({ code: "EVENT_ARCHIVE_CONFLICT" });
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 4 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 0 }]);
      d1.close();
    });

    it("refuses a read whose segment is altered or missing instead of returning a shorter history", async () => {
      const { d1, hot, events, archive, storage } = harness();
      await seed(hot, NOTE, 6);
      await archive.archive(NOTE, { through: 4 });
      const objects = (storage as InMemoryColdEventStorage).objects;
      const [key, stored] = [...objects.entries()][0]!;

      objects.set(key, { ...stored, body: stored.body.replace("v2", "v7") });
      await expect(events.readStream(NOTE)).rejects.toMatchObject({ code: "EVENT_ARCHIVE_INTEGRITY" });
      objects.delete(key);
      await expect(events.readStream(NOTE)).rejects.toMatchObject({ code: "EVENT_ARCHIVE_INTEGRITY" });
      d1.close();
    });
  });

  describe("restore", () => {
    it("puts every event back byte for byte and keeps the cold objects", async () => {
      const { d1, hot, events, archive, storage } = harness();
      await seed(hot, NOTE, 10);
      const original = d1.query("SELECT * FROM cf_frappe_events ORDER BY sequence");
      await archive.archive(NOTE, { through: 8, maxSegmentEvents: 3 });

      const restored = await archive.restore(NOTE);

      expect(restored).toEqual({ stream: NOTE, segments: 3, events: 8 });
      expect(d1.query("SELECT * FROM cf_frappe_events ORDER BY sequence")).toEqual(original);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 0 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_documents")).toEqual([{ n: 0 }]);
      expect((storage as InMemoryColdEventStorage).objects.size).toBe(3);
      // The plain store reads it again, and archiving it a second time works.
      expect((await hot.readStream(NOTE)).length).toBe(10);
      await archive.archive(NOTE, { through: 10 });
      expect((await events.readStream(NOTE)).length).toBe(10);
      d1.close();
    });

    it("keeps a segment archived when its events are somehow hot already", async () => {
      const { d1, hot, archive } = harness();
      await seed(hot, NOTE, 4);
      await archive.archive(NOTE, { through: 4 });
      d1.query(
        "INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json) VALUES ('dup', ?, ?, 2, 'DocumentUpdated', 'Note', 'One', 'x', ?, '{\"kind\":\"DocumentUpdated\",\"patch\":{}}')",
        TENANT,
        NOTE,
        NOW
      );

      await expect(archive.restore(NOTE)).rejects.toMatchObject({ code: "EVENT_ARCHIVE_CONFLICT" });
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 1 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 1 }]);
      d1.close();
    });

    it("refuses to restore from an object that no longer matches its index row", async () => {
      const { d1, hot, archive, storage } = harness();
      await seed(hot, NOTE, 4);
      await archive.archive(NOTE, { through: 4 });
      const objects = (storage as InMemoryColdEventStorage).objects;
      const [key, stored] = [...objects.entries()][0]!;
      objects.set(key, { ...stored, body: stored.body.replace("v2", "v8") });

      await expect(archive.restore(NOTE)).rejects.toMatchObject({ code: "EVENT_ARCHIVE_INTEGRITY" });
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_event_archive_segments")).toEqual([{ n: 1 }]);
      expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 0 }]);
      d1.close();
    });
  });

  describe("candidates", () => {
    it("pages streams by name with their hot counts, protected ones included for the cursor", async () => {
      const { d1, hot, archive } = harness();
      const series = namingSeriesStream(TENANT, "Note", "N-.####");
      const second = documentStream(TENANT, "Note", "Two");
      await seed(hot, NOTE, 5);
      await seed(hot, series, 5);
      await seed(hot, second, 2);

      expect(await archive.candidates({ limit: 10, minHotEvents: 3 })).toEqual([
        { stream: NOTE, hotEvents: 5 },
        { stream: series, hotEvents: 5 }
      ]);
      // Byte order, as SQLite compares: `Note:Two` sorts before `__NamingSeries`.
      expect(await archive.candidates({ after: NOTE, limit: 10, minHotEvents: 1 })).toEqual([
        { stream: second, hotEvents: 2 },
        { stream: series, hotEvents: 5 }
      ]);
      await archive.archive(NOTE, { through: 5 });
      expect(await archive.archivedStreams({ limit: 10 })).toEqual([NOTE]);
      d1.close();
    });
  });
});

describe("archived segment object keys", () => {
  it("refuse stream parts that could steer a key", async () => {
    const { eventSegmentObjectKey } = await import("../../src");
    await expect(eventSegmentObjectKey(documentStream(TENANT, "Note", "a/b..c"), 1, 2)).resolves.toMatch(/^events\/acme\/Note\//);
    for (const stream of ["../x:Note:One", "acme:..:One", "acme:a/b:One", "acme::One"]) {
      await expect(eventSegmentObjectKey(stream, 1, 2), stream).rejects.toMatchObject({ code: "EVENT_ARCHIVE_INVALID" });
    }
  });
});
