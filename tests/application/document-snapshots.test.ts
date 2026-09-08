import { describe, expect, it } from "vitest";
import {
  DocumentService,
  InMemoryDocumentStore,
  InMemorySnapshotStore,
  createRegistry,
  defineDocType,
  deterministicIds,
  fixedClock
} from "../../src";
import type { Actor, DomainEvent, ReadStreamOptions, SnapshotStore, StreamName } from "../../src";

const NOW = "2026-01-01T00:00:00.000Z";
const ACTOR: Actor = { id: "owner@example.com", roles: ["System Manager"], tenantId: "acme" };

const Note = defineDocType({
  name: "Note",
  fields: [
    { name: "title", type: "text" },
    { name: "body", type: "text" },
    // Five separate fields so a skipped event is observable. With every edit
    // touching one field, last-write-wins hides an off-by-one in the resume
    // bound: dropping a middle event leaves the final value unchanged.
    { name: "step1", type: "text" },
    { name: "step2", type: "text" },
    { name: "step3", type: "text" },
    { name: "step4", type: "text" },
    { name: "step5", type: "text" }
  ]
});

class CountingStore extends InMemoryDocumentStore {
  replayed = 0;
  reads = 0;

  override async readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    const events = await super.readStream(stream, options);
    if (stream.includes(":Note:")) {
      this.reads += 1;
      this.replayed += events.length;
    }
    return events;
  }
}

function service(store: InMemoryDocumentStore, snapshots?: SnapshotStore) {
  return new DocumentService({
    registry: createRegistry({ doctypes: [Note] }),
    store,
    clock: fixedClock(NOW),
    ids: deterministicIds(Array.from({ length: 4000 }, (_unused, index) => `evt_${index}`)),
    ...(snapshots === undefined ? {} : { snapshots })
  });
}

/** The same edit history applied through one service, returning what it saw. */
async function editRepeatedly(documents: DocumentService, edits: number) {
  const created = await documents.create({ actor: ACTOR, doctype: "Note", data: { title: "t0", body: "b" } });
  const seen: unknown[] = [];
  for (let edit = 1; edit <= edits; edit += 1) {
    seen.push(await documents.update({ actor: ACTOR, doctype: "Note", name: created.name, patch: { title: `t${edit}` } }));
  }
  return { name: created.name, seen };
}

describe("document fold snapshots", () => {
  it("gives byte-identical results whether or not a snapshot store is present", async () => {
    // The safety rule from issue #17, as a test: a snapshot may always be
    // ignored, and ignoring it must give exactly the same answer. Everything
    // else about the design — optional store, best-effort writes, tolerated
    // staleness — is only sound because this holds.
    const withoutStore = new InMemoryDocumentStore();
    const withStore = new InMemoryDocumentStore();

    const plain = await editRepeatedly(service(withoutStore), 12);
    const cached = await editRepeatedly(service(withStore, new InMemorySnapshotStore()), 12);

    expect(cached.seen).toEqual(plain.seen);
    // And the event streams themselves, so the snapshot did not change what was
    // written either.
    const streamOf = async (store: InMemoryDocumentStore, name: string) =>
      (await store.readStream(`acme:Note:${name}`)).map((event) => ({
        sequence: event.sequence,
        type: event.type,
        payload: event.payload
      }));
    expect(await streamOf(withStore, cached.name)).toEqual(await streamOf(withoutStore, plain.name));
  });

  it("replays a constant number of events per edit instead of the whole history", async () => {
    // The point of the change, asserted as counts rather than as elapsed time.
    // Without a snapshot a plain update reads the stream twice — once to load
    // the document, once at the end of the after-commit hooks — so the cost
    // grows with the document's age: 101 events replayed on the 50th edit, 401
    // on the 200th. With a snapshot both reads resume, and both come back empty.
    const perEdit = async (snapshots?: SnapshotStore) => {
      const store = new CountingStore();
      const documents = service(store, snapshots);
      const created = await documents.create({ actor: ACTOR, doctype: "Note", data: { title: "t0", body: "b" } });
      const marks: number[] = [];
      for (let edit = 1; edit <= 60; edit += 1) {
        const before = store.replayed;
        await documents.update({ actor: ACTOR, doctype: "Note", name: created.name, patch: { title: `t${edit}` } });
        if (edit % 20 === 0) {
          marks.push(store.replayed - before);
        }
      }
      return marks;
    };

    expect(await perEdit()).toEqual([41, 81, 121]);
    expect(await perEdit(new InMemorySnapshotStore())).toEqual([0, 0, 0]);
  });

  it("still answers correctly from a snapshot that has fallen behind", async () => {
    // Staleness is an accepted state, not a bug: writes are best-effort, and a
    // reader resumes from whatever sequence the snapshot claims.
    const store = new InMemoryDocumentStore();
    const snapshots = new InMemorySnapshotStore();
    const documents = service(store, snapshots);
    const created = await documents.create({ actor: ACTOR, doctype: "Note", data: { title: "t0", body: "b" } });
    // Edits applied with the snapshot store detached, so it keeps the old state.
    const detached = service(store);
    for (let edit = 1; edit <= 5; edit += 1) {
      // A distinct field per edit, so every one of them has to survive the
      // resume. Editing the same field would let an off-by-one in the lower
      // bound pass unnoticed.
      await detached.update({
        actor: ACTOR,
        doctype: "Note",
        name: created.name,
        patch: { [`step${edit}`]: `s${edit}` }
      });
    }

    const seen = await documents.update({
      actor: ACTOR,
      doctype: "Note",
      name: created.name,
      patch: { body: "updated" }
    });

    expect(seen.data).toEqual({
      title: "t0",
      body: "updated",
      step1: "s1",
      step2: "s2",
      step3: "s3",
      step4: "s4",
      step5: "s5"
    });
    expect(seen.version).toBe(7);
  });

  it("ignores a snapshot stored under a different fold version", async () => {
    // A fold whose semantics changed must not be handed state from the old
    // shape. The key carries the version so old state is simply not found.
    const store = new InMemoryDocumentStore();
    const snapshots = new InMemorySnapshotStore();
    const documents = service(store, snapshots);
    const created = await documents.create({ actor: ACTOR, doctype: "Note", data: { title: "t0", body: "b" } });
    await documents.update({ actor: ACTOR, doctype: "Note", name: created.name, patch: { title: "t1" } });
    const stream = `acme:Note:${created.name}`;

    const current = await snapshots.read({ stream, foldName: "document", foldVersion: 1 });
    expect(current).not.toBeNull();
    await expect(snapshots.read({ stream, foldName: "document", foldVersion: 2 })).resolves.toBeNull();
    // And a different fold over the same stream does not see it either.
    await expect(snapshots.read({ stream, foldName: "documentTags", foldVersion: 1 })).resolves.toBeNull();
  });

  it("survives a snapshot store that throws on both read and write", async () => {
    // The snapshot is a cache whose contract is that ignoring it changes
    // nothing, so a broken store must degrade to the old behaviour rather than
    // fail a business write.
    const broken: SnapshotStore = {
      read: async () => {
        throw new Error("snapshot read exploded");
      },
      write: async () => {
        throw new Error("snapshot write exploded");
      }
    };
    const store = new InMemoryDocumentStore();

    const cached = await editRepeatedly(service(store, broken), 4);
    const plain = await editRepeatedly(service(new InMemoryDocumentStore()), 4);

    expect(cached.seen).toEqual(plain.seen);
  });

  it("keeps the newest snapshot when an older one arrives late", async () => {
    const snapshots = new InMemorySnapshotStore();
    const key = { stream: "acme:Note:One" as StreamName, foldName: "document", foldVersion: 1 };
    await snapshots.write({ ...key, uptoSequence: 9, state: { title: "new" } });
    await snapshots.write({ ...key, uptoSequence: 4, state: { title: "old" } });

    await expect(snapshots.read(key)).resolves.toMatchObject({ uptoSequence: 9, state: { title: "new" } });
  });

  it("does not hand out state a caller can mutate", async () => {
    // Two readers fold onto the same stored state; if one could mutate it, the
    // snapshot would stop agreeing with the events it claims to summarise.
    const snapshots = new InMemorySnapshotStore();
    const key = { stream: "acme:Note:One" as StreamName, foldName: "document", foldVersion: 1 };
    await snapshots.write({ ...key, uptoSequence: 1, state: { data: { title: "original" } } });

    const first = await snapshots.read<{ data: { title: string } }>(key);
    first!.state.data.title = "mutated";

    await expect(snapshots.read(key)).resolves.toMatchObject({ state: { data: { title: "original" } } });
  });
});
