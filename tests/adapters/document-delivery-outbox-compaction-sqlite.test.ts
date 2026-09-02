import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
  D1EventStore,
  DocumentDeliveryOutboxService,
  InMemoryDocumentStore,
  deterministicIds,
  documentDeliveryOutboxStream,
  fixedClock
} from "../../src";
import type { AuditDocumentEventQuery, DomainEvent } from "../../src";

const MIGRATIONS_DIRECTORY = new URL("../../migrations/", import.meta.url);
const now = "2026-01-01T00:00:00.000Z";

/**
 * The delivery outbox against a real SQLite engine loaded from every shipped
 * migration, driving the real `D1EventStore` through a thin `D1Database` facade.
 *
 * The in-memory tests decide whether compaction is *correct*; this decides
 * whether it is correct against real SQL. Issue #42 is the reason: the
 * hand-written `FakeD1Database` interpreters elsewhere parse SQL by substring
 * and return `[]` for shapes they do not recognise, so a new query shape — the
 * newest-first checkpoint lookup here — can "pass" against a fake that never
 * executed it.
 */
function sqliteEventStore(): { readonly events: D1EventStore; readonly close: () => void } {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIRECTORY).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS_DIRECTORY), "utf8"));
  }
  return { events: new D1EventStore(asD1Database(db)), close: () => db.close() };
}

describe("delivery outbox compaction on a real SQLite engine", () => {
  it("delivers round after round and resumes from the newest checkpoint", async () => {
    const { events, close } = sqliteEventStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(Array.from({ length: 200 }, (_unused, index) => `evt_${String(index)}`))
    });

    for (let round = 1; round <= 8; round += 1) {
      await outbox.enqueueFromDomainEvent({
        event: domainEvent(`evt_round_${String(round)}`),
        targets: ["email"]
      });
      const [claimed] = await outbox.claimPending({ tenantId: "acme", claimId: `claim-${String(round)}`, now });
      await expect(
        outbox.markDelivered({ tenantId: "acme", outboxId: claimed!.id, claimId: `claim-${String(round)}` })
      ).resolves.toMatchObject({ id: `evt_round_${String(round)}:email`, status: "delivered" });
    }

    // Real `id TEXT PRIMARY KEY` and real `UNIQUE(stream, sequence)`: a derived
    // checkpoint id that repeated, or a checkpoint written at a sequence already
    // taken, would surface here as a conflict rather than as a duplicate row.
    const stream = await events.readStream(documentDeliveryOutboxStream("acme"));
    const checkpoints = stream.filter(
      (event) => event.payload.kind === "DocumentDeliveryOutboxCheckpointed"
    );
    expect(checkpoints).toHaveLength(8);
    expect(new Set(checkpoints.map((event) => event.id)).size).toBe(8);
    await expect(outbox.list("acme")).resolves.toEqual([]);
    await expect(outbox.record("acme", "evt_round_1:email")).resolves.toMatchObject({ status: "delivered" });
    close();
  });

  it("agrees with the in-memory adapter on newest-first document reads", async () => {
    // `order` is a port option implemented twice — once as SQL, once as a
    // comparator. A differential assertion is what keeps them from drifting;
    // the outbox reads exactly one row through it and a silently-ascending
    // adapter would hand back the *oldest* checkpoint, compacting nothing while
    // every test still passed.
    const { events: sqlite, close } = sqliteEventStore();
    const memory = new InMemoryDocumentStore();
    const stream = documentDeliveryOutboxStream("acme");
    const seeded = Array.from({ length: 6 }, (_unused, index) => checkpointEvent(index + 1));
    await sqlite.append(stream, 0, seeded);
    await memory.append(stream, 0, seeded);
    const query: AuditDocumentEventQuery = {
      tenantId: "acme",
      doctype: "__DocumentDeliveryOutbox",
      documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
      stream
    };

    for (const options of [
      { order: "desc" as const, limit: 1 },
      { order: "desc" as const },
      { order: "asc" as const, limit: 1 },
      {}
    ]) {
      const fromSqlite = await sqlite.readDocumentEvents({ ...query, ...options });
      const fromMemory = await memory.readDocumentEvents({ ...query, ...options });
      expect(fromSqlite.map(sequenceOf)).toEqual(fromMemory.map(sequenceOf));
    }

    // And the direction is actually reversed, not merely agreed upon.
    const newest = await sqlite.readDocumentEvents({ ...query, order: "desc", limit: 1 });
    expect(newest.map(sequenceOf)).toEqual([6]);
    close();
  });
});

function sequenceOf(event: DomainEvent): number {
  return event.sequence;
}

function checkpointEvent(index: number) {
  return {
    id: `evt_checkpoint_${String(index)}`,
    tenantId: "acme",
    stream: documentDeliveryOutboxStream("acme"),
    type: "DocumentDeliveryOutboxCheckpointed",
    doctype: "__DocumentDeliveryOutbox",
    documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
    actorId: "system",
    occurredAt: now,
    payload: {
      kind: "DocumentDeliveryOutboxCheckpointed" as const,
      upToSequence: index - 1,
      carryOver: []
    },
    metadata: {}
  };
}

function domainEvent(id: string): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Note:One",
    sequence: 1,
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner@example.com",
    occurredAt: now,
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };
}

type SqlParam = string | number | bigint | null;

function asD1Database(db: DatabaseSync): D1Database {
  const statement = (sql: string, params: readonly SqlParam[]) => ({
    bind: (...next: readonly unknown[]) => statement(sql, toSqlParams(next)),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).all(...params)[0] ?? null,
    run: async () => {
      db.prepare(sql).run(...params);
      return { success: true };
    }
  });
  return {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: readonly { all(): Promise<unknown> }[]) =>
      Promise.all(statements.map((entry) => entry.all()))
  } as unknown as D1Database;
}

function toSqlParams(params: readonly unknown[]): readonly SqlParam[] {
  return params.map((param) => {
    if (param === null || param === undefined) {
      return null;
    }
    if (typeof param === "boolean") {
      return param ? 1 : 0;
    }
    if (typeof param === "number" || typeof param === "bigint" || typeof param === "string") {
      return param;
    }
    return JSON.stringify(param);
  });
}
