import {
  InMemoryDocumentStore,
  InMemoryProjectionStore,
  RoutedProjectionStore,
  withProjectionFollowers
} from "../../src";
import type {
  DocumentSnapshot,
  NewDomainEvent,
  ProjectionFollowerFailure,
  ProjectionTarget
} from "../../src";
import type { ProjectionStore } from "../../src/ports/projection-store.js";

describe("RoutedProjectionStore", () => {
  it("fans writes out to every live target", async () => {
    const active = new InMemoryProjectionStore();
    const building = new InMemoryProjectionStore();
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", active), target("v2", "building", building)]
    });

    await router.save(snapshot("TASK-1"));

    await expect(active.get("acme", "Task", "TASK-1")).resolves.toMatchObject({ name: "TASK-1" });
    await expect(building.get("acme", "Task", "TASK-1")).resolves.toMatchObject({ name: "TASK-1" });
    expect(router.targetNames()).toEqual(["v1", "v2"]);
  });

  it("reads from the active target by default and switches without restarting", async () => {
    const active = new InMemoryProjectionStore();
    const candidate = new InMemoryProjectionStore();
    // Deliberately divergent contents, so the assertion proves which one answered.
    await active.save(snapshot("TASK-1", { title: "from v1" }));
    await candidate.save(snapshot("TASK-1", { title: "from v2" }));
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", active), target("v2", "caught-up", candidate)]
    });

    expect(router.readingFrom()).toBe("v1");
    await expect(router.get("acme", "Task", "TASK-1")).resolves.toMatchObject({
      data: { title: "from v1" }
    });

    router.readFrom("v2");

    expect(router.readingFrom()).toBe("v2");
    await expect(router.get("acme", "Task", "TASK-1")).resolves.toMatchObject({
      data: { title: "from v2" }
    });
    const listed = await router.list({ tenantId: "acme", doctype: "Task" });
    expect(listed.data[0]?.data).toEqual({ title: "from v2" });
  });

  it("reports follower failures without failing the write", async () => {
    const active = new InMemoryProjectionStore();
    const failures: ProjectionFollowerFailure[] = [];
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", active), target("v2", "building", failingStore("disk full"))],
      onFollowerFailure: (failure) => failures.push(failure)
    });

    await expect(router.save(snapshot("TASK-1"))).resolves.toBeUndefined();

    await expect(active.get("acme", "Task", "TASK-1")).resolves.toMatchObject({ name: "TASK-1" });
    expect(failures).toEqual([
      { target: "v2", tenantId: "acme", doctype: "Task", name: "TASK-1", reason: "disk full" }
    ]);
  });

  it("propagates a failure on the active target", async () => {
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", failingStore("primary down"))]
    });

    await expect(router.save(snapshot("TASK-1"))).rejects.toThrow("primary down");
  });

  it("does not write to or read from a retired target", async () => {
    const active = new InMemoryProjectionStore();
    const retired = new InMemoryProjectionStore();
    const router = new RoutedProjectionStore({
      targets: [target("v1", "retired", retired), target("v2", "active", active)]
    });

    await router.save(snapshot("TASK-1"));

    await expect(retired.get("acme", "Task", "TASK-1")).resolves.toBeNull();
    expect(() => router.readFrom("v1")).toThrow("retired");
  });

  it("requires exactly one active target", () => {
    const store = new InMemoryProjectionStore();
    expect(() => new RoutedProjectionStore({ targets: [] })).toThrow("At least one projection target");
    expect(
      () => new RoutedProjectionStore({ targets: [target("v1", "building", store)] })
    ).toThrow("found 0");
    expect(
      () =>
        new RoutedProjectionStore({
          targets: [target("v1", "active", store), target("v2", "active", store)]
        })
    ).toThrow("found 2");
    expect(
      () =>
        new RoutedProjectionStore({
          targets: [target("v1", "active", store), target("v1", "building", store)]
        })
    ).toThrow("mounted more than once");
  });

  it("rejects switching reads to an unmounted target", () => {
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", new InMemoryProjectionStore())]
    });

    expect(() => router.readFrom("v9")).toThrow("Unknown projection target 'v9'");
  });
});

describe("withProjectionFollowers", () => {
  it("feeds followers from the commit path, including auxiliary snapshots", async () => {
    const active = new InMemoryProjectionStore();
    const building = new InMemoryProjectionStore();
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", active), target("v2", "building", building)]
    });
    const store = withProjectionFollowers(new InMemoryDocumentStore(), router);

    const auxiliary = snapshot("NAMING-SERIES", { current: 1 });
    await store.commitBatch(
      [{ stream: "acme/Task/TASK-1", expectedVersion: 0, events: [newEvent()] }],
      () => ({ snapshot: snapshot("TASK-1"), auxiliarySnapshots: [auxiliary] })
    );

    // Naming counters and unique reservations are projection rows too; a follower
    // missing them is not a usable projection.
    await expect(building.get("acme", "Task", "TASK-1")).resolves.toMatchObject({ name: "TASK-1" });
    await expect(building.get("acme", "Task", "NAMING-SERIES")).resolves.toMatchObject({
      name: "NAMING-SERIES"
    });
  });

  it("keeps a follower failure out of the commit result", async () => {
    const failures: ProjectionFollowerFailure[] = [];
    const router = new RoutedProjectionStore({
      targets: [
        target("v1", "active", new InMemoryProjectionStore()),
        target("v2", "building", failingStore("follower down"))
      ],
      onFollowerFailure: (failure) => failures.push(failure)
    });
    const store = withProjectionFollowers(new InMemoryDocumentStore(), router);

    const commit = await store.commit("acme/Task/TASK-1", 0, [newEvent()], () => snapshot("TASK-1"));

    expect(commit.snapshot.name).toBe("TASK-1");
    expect(failures.map((failure) => failure.target)).toEqual(["v2"]);
  });

  it("does not touch followers when the commit itself fails", async () => {
    const failures: ProjectionFollowerFailure[] = [];
    const building = new InMemoryProjectionStore();
    const router = new RoutedProjectionStore({
      targets: [target("v1", "active", new InMemoryProjectionStore()), target("v2", "building", building)],
      onFollowerFailure: (failure) => failures.push(failure)
    });
    const inner = new InMemoryDocumentStore();
    const store = withProjectionFollowers(inner, router);
    await store.commit("acme/Task/TASK-1", 0, [newEvent("evt1")], () => snapshot("TASK-1"));

    // Stale expected version: the commit must be rejected before any follower runs.
    await expect(
      store.commit("acme/Task/TASK-1", 0, [newEvent("evt2")], () => snapshot("TASK-1"))
    ).rejects.toThrow();

    expect(failures).toEqual([]);
    await expect(building.get("acme", "Task", "TASK-1")).resolves.toMatchObject({ version: 1 });
  });
});

function target(name: string, state: ProjectionTarget["state"], store: ProjectionStore): ProjectionTarget {
  return { name, state, store };
}

function failingStore(reason: string): ProjectionStore {
  return {
    get: async () => null,
    list: async () => ({ data: [], limit: 50, offset: 0, total: 0 }),
    save: async () => {
      throw new Error(reason);
    }
  };
}

function snapshot(name: string, data: Record<string, unknown> = { title: "t" }): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Task",
    name,
    version: 1,
    docstatus: "draft",
    data: data as DocumentSnapshot["data"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function newEvent(id = "evt1"): NewDomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme/Task/TASK-1",
    type: "DocumentCreated",
    doctype: "Task",
    documentName: "TASK-1",
    actorId: "tester",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentCreated", data: { title: "t" }, docstatus: "draft" },
    metadata: {}
  };
}
