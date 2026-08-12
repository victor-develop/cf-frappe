import { describe, expect, it } from "vitest";
import { foldDocument } from "../../src";
import type { DocumentSnapshot } from "../../src";
import { createServices, data, manager, owner } from "../helpers";

/**
 * Event sourcing's promise here is that the event stream is the only truth and
 * the projection is a disposable cache. Existing tests do fold events from
 * scratch (tests/core/events.test.ts, tests/core/fold-associativity.test.ts),
 * but always from hand-written events - none folds a stream that a service
 * actually produced and reconciles it against the stored projection. That is
 * the gap this closes, and it is the guard the snapshot work (#17) and cold
 * archival (#18) lean on: a snapshot is only safe to ignore if a from-zero
 * replay agrees with what the write path stored.
 *
 * Enumeration starts from the EVENT side (`listStreams`), not from the
 * projection, so a document whose projection row was never written shows up as
 * a difference instead of silently dropping out of the comparison. The reverse
 * direction is covered too: projection rows with no events are reported.
 *
 * Two limits worth knowing before relying on this:
 *
 *  - It runs against the in-memory store, where one object is both event store
 *    and projection store. The D1 path (`documentUpsertStatement`, the
 *    `data_json` round trip) and the second projection table
 *    `cf_frappe_automation_runs` are NOT covered.
 *  - The write path derives current state with `foldDocument` too
 *    (`document-service.ts` -> `requireExistingEventStream`), so a bug in a
 *    fold branch that both sides share stays invisible here. What this does
 *    catch is state that reached the projection without passing through an
 *    event, and rows that are missing on either side.
 */

const TENANT = "acme";

function ids(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `evt${index + 1}`);
}

interface ReplayComparison {
  readonly doctype: string;
  readonly name: string;
  readonly live: DocumentSnapshot | null;
  readonly replayed: DocumentSnapshot | null;
}

/**
 * Rebuilds every projection for a doctype from its event stream and pairs each
 * rebuilt snapshot with the stored one. Deliberately minimal - #11
 * productionises the rebuild (resume, rate limiting, progress); here it only
 * has to be correct and to enumerate from the event side.
 */
async function replayComparisons(
  services: ReturnType<typeof createServices>,
  doctype: string
): Promise<readonly ReplayComparison[]> {
  const { store } = services;
  const comparisons: ReplayComparison[] = [];
  const seen = new Set<string>();

  for (const stream of await store.listStreams({ tenantId: TENANT, doctype })) {
    const events = await store.readStream(stream);
    // Events carry `documentName`, so the stream name never has to be parsed.
    const name = events[0]?.documentName;
    if (name === undefined) {
      continue;
    }
    seen.add(name);
    comparisons.push({
      doctype,
      name,
      live: await store.get(TENANT, doctype, name),
      replayed: foldDocument(events)
    });
  }

  // Reverse direction: a projection row the event side does not know about.
  const page = await store.list({ tenantId: TENANT, doctype, limit: 1000 });
  expect(page.total).toBe(page.data.length);
  for (const live of page.data) {
    if (seen.has(live.name)) {
      continue;
    }
    comparisons.push({ doctype, name: live.name, live, replayed: null });
  }

  return comparisons.sort((left, right) => left.name.localeCompare(right.name));
}

describe("projection replay parity", () => {
  async function seedRichHistory() {
    const services = createServices(ids(200));
    const { documents } = services;

    const first = await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Quarterly review", body: "draft", priority: "Medium" })
    });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: first.name,
      patch: { body: "second pass", count: 3 },
      expectedVersion: first.version
    });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: first.name,
      patch: { priority: "High" }
    });
    await documents.comment({
      actor: manager,
      doctype: "Note",
      name: first.name,
      text: "needs a body before it ships"
    });
    await documents.assign({ actor: owner, doctype: "Note", name: first.name, assignee: manager.id });
    await documents.tag({ actor: owner, doctype: "Note", name: first.name, tag: "urgent" });
    await documents.follow({ actor: manager, doctype: "Note", name: first.name });
    await documents.untag({ actor: owner, doctype: "Note", name: first.name, tag: "urgent" });
    await documents.unassign({ actor: owner, doctype: "Note", name: first.name, assignee: manager.id });

    const second = await documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Retro notes", body: "kickoff" })
    });
    await documents.update({
      actor: manager,
      doctype: "Note",
      name: second.name,
      patch: { count: 1 },
      unset: ["body"]
    });

    await documents.duplicate({
      actor: manager,
      doctype: "Note",
      name: second.name,
      data: { title: "Retro notes copy" }
    });

    return services;
  }

  function comparisonFor(
    comparisons: readonly ReplayComparison[],
    name: string
  ): ReplayComparison {
    const comparison = comparisons.find((candidate) => candidate.name === name);
    expect(comparison, `no comparison for '${name}'`).toBeDefined();
    return comparison!;
  }

  it("rebuilds every Note projection from its event stream alone", async () => {
    const services = await seedRichHistory();
    const comparisons = await replayComparisons(services, "Note");

    // Guards against passing vacuously: the flow above must have produced
    // several documents with a non-trivial history each.
    expect(comparisons.length).toBeGreaterThanOrEqual(3);

    // Compared as whole arrays so a mismatch prints the field-level diff.
    expect(comparisons.map((comparison) => comparison.replayed)).toEqual(
      comparisons.map((comparison) => comparison.live)
    );
  });

  it("covers a non-trivial history per document", async () => {
    const services = await seedRichHistory();
    const streams = await services.store.listStreams({ tenantId: TENANT, doctype: "Note" });
    const lengths = await Promise.all(
      streams.map(async (stream) => (await services.store.readStream(stream)).length)
    );
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(5);
  });

  it("detects a projection value that never came from an event", async () => {
    const services = await seedRichHistory();
    const target = (await services.store.list({ tenantId: TENANT, doctype: "Note", limit: 1000 })).data.find(
      (snapshot) => snapshot.name === "Quarterly review"
    )!;

    await services.store.save({ ...target, data: { ...target.data, body: "written straight to the projection" } });

    const comparisons = await replayComparisons(services, "Note");
    const drifted = comparisonFor(comparisons, target.name);
    expect(drifted.replayed).not.toEqual(drifted.live);
    expect(drifted.live?.data.body).toBe("written straight to the projection");
    expect(drifted.replayed?.data.body).toBe("second pass");

    // Every other document still agrees, so the check is not simply failing everywhere.
    const others = comparisons.filter((comparison) => comparison.name !== target.name);
    expect(others.map((comparison) => comparison.replayed)).toEqual(others.map((comparison) => comparison.live));
  });

  it("detects a projection row that was never written", async () => {
    const services = await seedRichHistory();
    // The in-memory store has no way to drop a single projection row, so the
    // read is stubbed instead. This is the case enumerating from the projection
    // side cannot see at all - the row is simply absent from `list()` - which is
    // why `replayComparisons` starts from `listStreams`. Keep this control if
    // that enumeration is ever changed.
    const storedSnapshot = services.store.get.bind(services.store);
    (services.store as { get: unknown }).get = async (tenantId: string, doctype: string, name: string) =>
      name === "Quarterly review" ? null : storedSnapshot(tenantId, doctype, name);

    const comparisons = await replayComparisons(services, "Note");
    const missing = comparisonFor(comparisons, "Quarterly review");
    expect(missing.live).toBeNull();
    expect(missing.replayed).not.toBeNull();
    expect(comparisons.map((comparison) => comparison.replayed)).not.toEqual(
      comparisons.map((comparison) => comparison.live)
    );
  });

  it("detects a projection row with no events behind it", async () => {
    const services = await seedRichHistory();
    const target = (await services.store.list({ tenantId: TENANT, doctype: "Note", limit: 1000 })).data[0]!;

    await services.store.save({ ...target, name: "Row without a stream" });

    const comparisons = await replayComparisons(services, "Note");
    const ghost = comparisonFor(comparisons, "Row without a stream");
    expect(ghost.replayed).toBeNull();
    expect(ghost.live).not.toBeNull();
  });
});
