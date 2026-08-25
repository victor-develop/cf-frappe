import { describe, expect, it } from "vitest";
import { documentStream, InMemoryDocumentStore, InMemoryEventStore } from "../../src";
import type { NewDomainEvent } from "../../src";
import { eventStreamQuery } from "../../src/adapters/d1/read-stream-query.js";

/**
 * `minSequence` lets a fold resume from a snapshot instead of replaying the
 * whole stream, and is the read-side half of the snapshot work. The D1 and
 * in-memory stores have to agree on it or folds behave differently per
 * adapter.
 */

const stream = documentStream("acme", "Note", "One");

function newEvent(id: string, body: string): NewDomainEvent {
  return {
    id,
    tenantId: "acme",
    stream,
    type: "DocumentUpdated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentUpdated", patch: { body } },
    metadata: {}
  };
}

const seeded = [newEvent("evt1", "a"), newEvent("evt2", "b"), newEvent("evt3", "c"), newEvent("evt4", "d")];

describe("read stream minSequence", () => {
  describe("D1 query planning", () => {
    it("omits the lower bound when minSequence is absent", () => {
      const query = eventStreamQuery({});
      expect(query.sql).not.toContain("sequence >=");
      expect(query.params).toEqual([]);
    });

    it("emits an inclusive lower bound", () => {
      const query = eventStreamQuery({ minSequence: 7 });
      expect(query.sql).toContain("sequence >= ?");
      expect(query.params).toEqual([7]);
    });

    it("keeps parameter order aligned with clause order when bounded on both sides", () => {
      const query = eventStreamQuery({ minSequence: 7, maxSequence: 9 });
      expect(query.sql).toContain("sequence >= ? AND sequence <= ?");
      expect(query.params).toEqual([7, 9]);
    });

    it("keeps parameter order when combined with payload kinds and a limit", () => {
      const query = eventStreamQuery({
        minSequence: 2,
        maxSequence: 8,
        payloadKinds: ["DocumentUpdated"],
        limit: 5
      });
      expect(query.params).toEqual([2, 8, "DocumentUpdated", 5]);
      expect(query.sql).toContain("ORDER BY sequence ASC LIMIT ?");
      expect(query.reverseResults).toBe(false);
    });

    it("preserves recent-page ordering when a lower bound is absent", () => {
      const query = eventStreamQuery({ maxSequence: 8, limit: 5 });
      expect(query.sql).toContain("ORDER BY sequence DESC LIMIT ?");
      expect(query.reverseResults).toBe(true);
    });
  });

  for (const [label, create] of [
    ["InMemoryEventStore", () => new InMemoryEventStore()],
    ["InMemoryDocumentStore", () => new InMemoryDocumentStore()]
  ] as const) {
    describe(label, () => {
      async function seed() {
        const store = create();
        await store.append(stream, 0, seeded);
        return store;
      }

      it("returns only the tail at or after minSequence", async () => {
        const store = await seed();
        const events = await store.readStream(stream, { minSequence: 3 });
        expect(events.map((event) => event.sequence)).toEqual([3, 4]);
      });

      it("is inclusive of the boundary sequence", async () => {
        const store = await seed();
        const events = await store.readStream(stream, { minSequence: 4 });
        expect(events.map((event) => event.sequence)).toEqual([4]);
      });

      it("returns nothing when the snapshot already covers the stream", async () => {
        const store = await seed();
        expect(await store.readStream(stream, { minSequence: 5 })).toEqual([]);
      });

      it("combines with maxSequence", async () => {
        const store = await seed();
        const events = await store.readStream(stream, { minSequence: 2, maxSequence: 3 });
        expect(events.map((event) => event.sequence)).toEqual([2, 3]);
      });

      it("returns the first forward page when combined with limit", async () => {
        const store = await seed();
        const events = await store.readStream(stream, { minSequence: 2, limit: 2 });
        expect(events.map((event) => event.sequence)).toEqual([2, 3]);
      });

      it("supports continuation pages and the full forward filter combination", async () => {
        const store = await seed();
        const firstPage = await store.readStream(stream, {
          minSequence: 2,
          maxSequence: 4,
          payloadKinds: ["DocumentUpdated"],
          limit: 2
        });
        const nextPage = await store.readStream(stream, {
          minSequence: 4,
          maxSequence: 4,
          payloadKinds: ["DocumentUpdated"],
          limit: 2
        });

        expect(firstPage.map((event) => event.sequence)).toEqual([2, 3]);
        expect(nextPage.map((event) => event.sequence)).toEqual([4]);
      });

      it("reads the whole stream when minSequence is absent", async () => {
        const store = await seed();
        const events = await store.readStream(stream);
        expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
      });
    });
  }
});
