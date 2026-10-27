import { describe, expect, it } from "vitest";
import { documentStream } from "../../src";
import { sha256Hex } from "../../src/adapters/d1/event-archive-format.js";
import type { DocumentSnapshot } from "../../src";
import {
  R2ColdEventStorage,
  createAggregateCoordinatorClass,
  createCloudFrappeEventArchiveRuntime,
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace,
  type CloudFrappeEventArchiveOptions
} from "../../src/cloudflare";
import type { ColdEventReadMetrics } from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";
import { createTestRegistry, data, owner } from "../helpers";

/**
 * The event archive's Cloudflare wiring (issue #18): the R2 adapter, and the
 * one switch that turns the archive on for both the Worker and the aggregate
 * Durable Object. Off by default, and with it off nothing changes.
 */

interface Env {
  readonly DB: D1Database;
  readonly ARCHIVE: R2Bucket;
}

describe("R2ColdEventStorage", () => {
  it("hands R2 the digest to verify, an NDJSON content type and the metadata", async () => {
    const bucket = new FakeR2Bucket();
    const storage = new R2ColdEventStorage(bucket as unknown as R2Bucket);
    const body = '{"id":"e1"}\n';

    await storage.put("events/acme/Note/abc/1-1.ndjson", body, { sha256: await sha256Hex(body), metadata: { stream: "acme:Note:One" } });

    expect(bucket.puts).toEqual([
      {
        key: "events/acme/Note/abc/1-1.ndjson",
        options: {
          sha256: await sha256Hex(body),
          httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
          customMetadata: { stream: "acme:Note:One" }
        }
      }
    ]);
    await expect(storage.get("events/acme/Note/abc/1-1.ndjson")).resolves.toBe(body);
    await expect(storage.get("missing")).resolves.toBeNull();
  });

  it("fails the write when R2 rejects the digest", async () => {
    const storage = new R2ColdEventStorage(new FakeR2Bucket() as unknown as R2Bucket);

    await expect(storage.put("k", "body", { sha256: "0".repeat(64), metadata: {} })).rejects.toThrow(/sha256/);
  });

  it("fails the write when R2 declines to store it", async () => {
    const bucket = new FakeR2Bucket();
    bucket.decline = true;

    await expect(new R2ColdEventStorage(bucket as unknown as R2Bucket).put("k", "body", { sha256: await sha256Hex("body"), metadata: {} })).rejects.toMatchObject({
      code: "EVENT_ARCHIVE_INTEGRITY"
    });
  });
});

describe("the eventArchive option", () => {
  function deployment(eventArchive?: CloudFrappeEventArchiveOptions<Env>) {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const env: Env = { DB: d1.database, ARCHIVE: new FakeR2Bucket() as unknown as R2Bucket };
    const registry = createTestRegistry();
    const options = {
      registry,
      documentDeliveryOutbox: false,
      notifications: false,
      assignmentRuleActor: false as const,
      ...(eventArchive === undefined ? {} : { eventArchive })
    };
    const Coordinator = createAggregateCoordinatorClass<Env>(options);
    // A fresh instance per call, like a Durable Object that was evicted
    // between commands: whatever it knows has to come from D1 or R2.
    const coordinator = () => new Coordinator({} as DurableObjectState, env);
    const namespace = {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => coordinator()
    } as unknown as RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
    const worker = createCloudFrappeWorker<Env & { readonly AGGREGATES: typeof namespace }>({
      registry,
      actor: () => owner,
      ...(eventArchive === undefined ? {} : { eventArchive })
    });
    const workerEnv = { ...env, AGGREGATES: namespace };
    const timeline = async (name: string) =>
      worker.fetch!(
        new Request(`http://localhost/api/resource/Note/${encodeURIComponent(name)}/timeline`) as never,
        workerEnv,
        { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
      );
    return { d1, env, coordinator, timeline };
  }

  async function noteWithHistory(
    coordinator: () => { transact(command: never): Promise<unknown> },
    updates: number
  ): Promise<DocumentSnapshot> {
    let snapshot = (await coordinator().transact({
      kind: "create",
      actor: owner,
      doctype: "Note",
      data: data({ title: "Archived note", body: "v0" })
    } as never)) as DocumentSnapshot;
    for (let index = 1; index <= updates; index += 1) {
      snapshot = (await coordinator().transact({
        kind: "update",
        actor: owner,
        doctype: "Note",
        name: "Archived note",
        patch: { body: `v${index}` },
        expectedVersion: snapshot.version
      } as never)) as DocumentSnapshot;
    }
    return snapshot;
  }

  function hotEvents(d1: TestD1): number {
    return Number(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events WHERE stream = ?", documentStream("acme", "Note", "Archived note"))[0]!.n);
  }

  it("serves commands and the timeline over archived history when it is set", async () => {
    const coldReads: ColdEventReadMetrics[] = [];
    const eventArchive: CloudFrappeEventArchiveOptions<Env> = {
      bucket: (env) => env.ARCHIVE,
      keepHotEvents: 2,
      minSegmentEvents: 1,
      onColdRead: (metrics) => coldReads.push(metrics)
    };
    const { d1, env, coordinator, timeline } = deployment(eventArchive);
    const latest = await noteWithHistory(coordinator, 8);
    const before = await (await timeline("Archived note")).json();

    const pass = await createCloudFrappeEventArchiveRuntime(env, eventArchive).service.archivePass();

    expect(pass.results).toEqual([expect.objectContaining({ status: "archived", archivedThrough: 7 })]);
    expect(hotEvents(d1)).toBe(2);
    expect((env.ARCHIVE as unknown as FakeR2Bucket).objects.size).toBe(1);
    // An evicted coordinator resumes from the snapshot the archive recorded and
    // never reads R2 for a plain update.
    coldReads.length = 0;
    const updated = (await coordinator().transact({
      kind: "update",
      actor: owner,
      doctype: "Note",
      name: "Archived note",
      patch: { body: "after archive" },
      expectedVersion: latest.version
    } as never)) as DocumentSnapshot;
    expect(updated.version).toBe(latest.version + 1);
    expect(coldReads).toEqual([]);
    // The Worker's own stores read the archived history for the timeline.
    const response = await timeline("Archived note");
    expect(response.status).toBe(200);
    const after = (await response.json()) as { data: { entries: unknown[] } };
    expect(after.data.entries.slice(0, -1)).toEqual((before as { data: { entries: unknown[] } }).data.entries);
    expect(coldReads.length).toBeGreaterThan(0);
    d1.close();
  });

  it("is off by default, and an unconfigured deployment refuses archived history instead of misreading it", async () => {
    // The misconfiguration the README warns about: streams were archived, then
    // a coordinator was deployed without `eventArchive`.
    const options = { bucket: (env: Env) => env.ARCHIVE, keepHotEvents: 1, minSegmentEvents: 1 };
    const archived = deployment(options);
    const latest = await noteWithHistory(archived.coordinator, 3);
    await createCloudFrappeEventArchiveRuntime(archived.env, options).service.archivePass();
    expect(hotEvents(archived.d1)).toBe(1);
    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry: createTestRegistry(),
      documentDeliveryOutbox: false,
      notifications: false,
      assignmentRuleActor: false
    });
    const plain = new Coordinator({} as DurableObjectState, archived.env);
    const update = { kind: "update", actor: owner, doctype: "Note", name: "Archived note", patch: { body: "x" } } as const;

    // A fold that would have started from half a history fails instead.
    await expect(plain.transact({ ...update, expectedVersion: latest.version })).rejects.toMatchObject({
      code: "EVENT_ARCHIVE_REQUIRED"
    });

    // With the hot tail gone too there is nothing for that check to see, and the
    // document reads as absent — but the version check still includes the
    // archive, so re-creating it under the same name conflicts rather than
    // writing a second sequence 1.
    await createCloudFrappeEventArchiveRuntime(archived.env, { ...options, keepHotEvents: 0 }).service.archivePass();
    expect(hotEvents(archived.d1)).toBe(0);
    await expect(
      plain.transact({ kind: "create", actor: owner, doctype: "Note", data: data({ title: "Archived note" }) })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    expect(archived.d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")).toEqual([{ n: 0 }]);
    archived.d1.close();
  });

  it("leaves a deployment without it reading and writing exactly as before", async () => {
    const { d1, coordinator, timeline } = deployment();
    await noteWithHistory(coordinator, 2);

    expect((await timeline("Archived note")).status).toBe(200);
    expect(d1.executed.some((sql) => sql.includes("cf_frappe_event_archive_segments") && !sql.startsWith("SELECT MAX("))).toBe(false);
    d1.close();
  });
});

/** Enough of `R2Bucket` for the archive, including R2's digest check on `put`. */
class FakeR2Bucket {
  readonly objects = new Map<string, string>();
  readonly puts: { key: string; options: unknown }[] = [];
  decline = false;

  async put(key: string, value: string, options: { readonly sha256?: string }) {
    if (options.sha256 !== undefined && options.sha256 !== (await sha256Hex(value))) {
      throw new Error("put: The sha256 checksum you specified did not match what we received.");
    }
    this.puts.push({ key, options });
    if (this.decline) {
      return null;
    }
    this.objects.set(key, value);
    return { key };
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }
}
