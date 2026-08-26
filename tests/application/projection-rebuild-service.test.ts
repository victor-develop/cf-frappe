import {
  InMemoryEventStore,
  InMemoryProjectionStore,
  ProjectionRebuildService,
  RoutedProjectionStore,
  fixedClock,
  foldDocument,
  foldProjectionRebuild,
  projectionRebuildStream
} from "../../src";
import type { NewDomainEvent, ProjectionTarget } from "../../src";
import type { IdGenerator } from "../../src/ports/id-generator.js";
import type { ProjectionStore } from "../../src/ports/projection-store.js";
import { now } from "../helpers";

describe("ProjectionRebuildService", () => {
  it("rebuilds a doctype into a non-active target, batch by batch", async () => {
    const context = await scenario({ documents: 5, batchSize: 2 });

    const started = await context.service.start({
      tenantId: "acme",
      doctype: "Task",
      target: "v2",
      batchSize: 2
    });
    expect(started).toMatchObject({ status: "running", totalStreams: 5, rebuilt: 0 });

    // The rebuild target starts empty; the active projection is untouched throughout.
    await expect(context.candidate.list({ tenantId: "acme", doctype: "Task" })).resolves.toMatchObject({
      total: 0
    });

    let more = true;
    const batches: number[] = [];
    while (more) {
      const result = await context.service.advance("acme", started.runId);
      batches.push(result.state.rebuilt);
      more = result.more;
    }

    expect(batches).toEqual([2, 4, 5]);
    const final = await context.service.status("acme", started.runId);
    expect(final).toMatchObject({ status: "completed", rebuilt: 5, failed: 0 });
    await expect(context.candidate.list({ tenantId: "acme", doctype: "Task" })).resolves.toMatchObject({
      total: 5
    });
  });

  it("produces the same rows as the projection written on the live path", async () => {
    const context = await scenario({ documents: 4, batchSize: 10 });
    const started = await context.service.start({ tenantId: "acme", doctype: "Task", target: "v2" });
    await context.service.advance("acme", started.runId);

    const [live, rebuilt] = await Promise.all([
      context.active.list({ tenantId: "acme", doctype: "Task", orderBy: "name", order: "asc" }),
      context.candidate.list({ tenantId: "acme", doctype: "Task", orderBy: "name", order: "asc" })
    ]);

    expect(rebuilt.data).toEqual(live.data);
  });

  it("resumes from the cursor instead of starting over", async () => {
    const context = await scenario({ documents: 5, batchSize: 2 });
    const started = await context.service.start({
      tenantId: "acme",
      doctype: "Task",
      target: "v2",
      batchSize: 2
    });

    await context.service.advance("acme", started.runId);
    const afterFirst = await context.service.status("acme", started.runId);
    expect(afterFirst.cursor).toBe("acme/Task/TASK-002");
    expect(afterFirst.rebuilt).toBe(2);

    // A fresh service instance, as a later Cron invocation would be.
    const resumed = new ProjectionRebuildService(context.serviceOptions);
    const next = await resumed.advance("acme", started.runId);

    expect(next.state.cursor).toBe("acme/Task/TASK-004");
    expect(next.state.rebuilt).toBe(4);
  });

  it("is idempotent when a batch is replayed", async () => {
    const context = await scenario({ documents: 3, batchSize: 10 });
    const started = await context.service.start({ tenantId: "acme", doctype: "Task", target: "v2" });

    await context.service.advance("acme", started.runId);
    // Advancing again finds nothing pending and completes rather than rewriting.
    await context.service.advance("acme", started.runId);

    await expect(context.candidate.list({ tenantId: "acme", doctype: "Task" })).resolves.toMatchObject({
      total: 3
    });
    expect(await context.service.status("acme", started.runId)).toMatchObject({
      status: "completed",
      rebuilt: 3
    });
  });

  it("records a failing stream, advances past it, and keeps going", async () => {
    const context = await scenario({
      documents: 3,
      batchSize: 10,
      candidate: failOnceFor("TASK-002", new InMemoryProjectionStore())
    });
    const started = await context.service.start({ tenantId: "acme", doctype: "Task", target: "v2" });

    await context.service.advance("acme", started.runId);
    const state = await context.service.status("acme", started.runId);

    expect(state.rebuilt).toBe(2);
    expect(state.failed).toBe(1);
    expect(state.recentErrors).toEqual([{ stream: "acme/Task/TASK-002", reason: "write rejected" }]);
    // One bad document must not stall the run.
    expect(state.cursor).toBe("acme/Task/TASK-003");
  });

  it("refuses to rebuild the target that is serving reads", async () => {
    const context = await scenario({ documents: 1, batchSize: 10 });

    await expect(
      context.service.start({ tenantId: "acme", doctype: "Task", target: "v1" })
    ).rejects.toMatchObject({ code: "PROJECTION_REBUILD_TARGET_INVALID" });

    // And it stays refused after the read source moves.
    context.router.readFrom("v2");
    await expect(
      context.service.start({ tenantId: "acme", doctype: "Task", target: "v2" })
    ).rejects.toMatchObject({ code: "PROJECTION_REBUILD_TARGET_INVALID" });
  });

  it("rejects an unknown target and an out-of-range batch size", async () => {
    const context = await scenario({ documents: 1, batchSize: 10 });

    await expect(
      context.service.start({ tenantId: "acme", doctype: "Task", target: "v9" })
    ).rejects.toMatchObject({ code: "PROJECTION_TARGET_NOT_FOUND" });
    for (const batchSize of [0, -1, 1.5, 501]) {
      await expect(
        context.service.start({ tenantId: "acme", doctype: "Task", target: "v2", batchSize })
      ).rejects.toMatchObject({ code: "PROJECTION_REBUILD_BATCH_INVALID" });
    }
  });

  it("stops immediately when aborted", async () => {
    const context = await scenario({ documents: 5, batchSize: 1 });
    const started = await context.service.start({
      tenantId: "acme",
      doctype: "Task",
      target: "v2",
      batchSize: 1
    });
    await context.service.advance("acme", started.runId);

    const aborted = await context.service.abort("acme", started.runId, "wrong fold version");

    expect(aborted).toMatchObject({ status: "aborted", reason: "wrong fold version", rebuilt: 1 });
    const after = await context.service.advance("acme", started.runId);
    expect(after).toMatchObject({ more: false });
    expect(after.state.rebuilt).toBe(1);
    // Aborting twice is a no-op rather than an error.
    await expect(context.service.abort("acme", started.runId, "again")).resolves.toMatchObject({
      reason: "wrong fold version"
    });
  });

  it("reports an unknown run rather than inventing state", async () => {
    const context = await scenario({ documents: 1, batchSize: 10 });

    await expect(context.service.status("acme", "rebuild-nope")).rejects.toMatchObject({
      code: "PROJECTION_REBUILD_NOT_FOUND"
    });
  });

  it("keeps the folded run state bounded as the run grows", async () => {
    const context = await scenario({ documents: 60, batchSize: 1, candidate: alwaysFailing() });
    const started = await context.service.start({
      tenantId: "acme",
      doctype: "Task",
      target: "v2",
      batchSize: 1
    });
    for (let index = 0; index < 40; index += 1) {
      await context.service.advance("acme", started.runId);
    }

    const events = await context.events.readStream(projectionRebuildStream("acme", started.runId));
    const state = foldProjectionRebuild(events);

    // Counts grow; the error detail is a bounded sample so the fold cannot become
    // the unbounded-state problem described in #28.
    expect(state?.failed).toBe(40);
    expect(state?.recentErrors.length).toBe(20);
    // Names are zero-padded so the lexicographic stream order the cursor relies on
    // matches the numeric one; unpadded names would resume in a surprising order.
    expect(state?.recentErrors.at(-1)?.stream).toBe("acme/Task/TASK-040");
  });
});

interface Scenario {
  readonly service: ProjectionRebuildService;
  readonly serviceOptions: ConstructorParameters<typeof ProjectionRebuildService>[0];
  readonly router: RoutedProjectionStore;
  readonly active: InMemoryProjectionStore;
  readonly candidate: ProjectionStore;
  readonly events: InMemoryEventStore;
}

async function scenario(input: {
  readonly documents: number;
  readonly batchSize: number;
  readonly candidate?: ProjectionStore;
}): Promise<Scenario> {
  const events = new InMemoryEventStore();
  const active = new InMemoryProjectionStore();
  const candidate = input.candidate ?? new InMemoryProjectionStore();
  const targets: readonly ProjectionTarget[] = [
    { name: "v1", state: "active", store: active },
    { name: "v2", state: "building", store: candidate }
  ];
  const router = new RoutedProjectionStore({ targets });

  for (let index = 1; index <= input.documents; index += 1) {
    const name = `TASK-${String(index).padStart(3, "0")}`;
    const stream = `acme/Task/${name}`;
    const committed = await events.append(stream, 0, [documentCreated(name, stream, index)]);
    const snapshot = foldDocument(committed);
    if (snapshot !== null) {
      await active.save(snapshot);
    }
  }

  const serviceOptions = {
    events,
    streams: events,
    router,
    targetStore: (name: string) => targets.find((target) => target.name === name)?.store,
    clock: fixedClock(now),
    ids: sequentialIds()
  };
  return { service: new ProjectionRebuildService(serviceOptions), serviceOptions, router, active, candidate, events };
}

function documentCreated(name: string, stream: string, index: number): NewDomainEvent {
  return {
    id: `evt-${name}`,
    tenantId: "acme",
    stream,
    type: "DocumentCreated",
    doctype: "Task",
    documentName: name,
    actorId: "owner",
    occurredAt: now,
    payload: { kind: "DocumentCreated", data: { title: `Task ${index}` }, docstatus: "draft" },
    metadata: {}
  };
}

function sequentialIds(): IdGenerator {
  let counter = 0;
  return {
    next: (prefix = "id") => {
      counter += 1;
      return `${prefix}-${counter}`;
    }
  };
}

function failOnceFor(documentName: string, inner: InMemoryProjectionStore): ProjectionStore {
  let failed = false;
  return {
    get: (tenantId, doctype, name) => inner.get(tenantId, doctype, name),
    list: (query) => inner.list(query),
    save: async (snapshot) => {
      if (!failed && snapshot.name === documentName) {
        failed = true;
        throw new Error("write rejected");
      }
      await inner.save(snapshot);
    }
  };
}

function alwaysFailing(): ProjectionStore {
  return {
    get: async () => null,
    list: async () => ({ data: [], limit: 50, offset: 0, total: 0 }),
    save: async () => {
      throw new Error("write rejected");
    }
  };
}
