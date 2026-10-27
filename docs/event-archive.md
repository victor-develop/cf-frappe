# Cold Event Archive

How old events move from D1 to R2 once a snapshot covers them, what still reads them, and how to switch it on and off. Issue #18, part of #5.

## Why

A D1 database is capped at 10 GB and the cap cannot be raised. The event table only grows. There are two ways to stop that being a wall:

| | Headroom | Complexity | Reversible |
| --- | --- | --- | --- |
| **Archive (this)** | a constant factor, set by the ratio of cold to hot history | one adapter layer | yes — restore puts events back |
| Shard per tenant (#14) | linear in tenants | permanent: cross-tenant queries, tenant moves, provisioning | no |

Archiving goes first because it may make sharding unnecessary for years.

**It is off by default and nothing archives on its own.** The trigger in #5 is a database approaching 5 GB.

## The rule: moved, never deleted

Snapshots are computed with today's fold logic. When a `foldVersion` is bumped every snapshot of that fold is void and its streams have to be folded from sequence 1 again — and #11 (rebuild), #12 (replay parity) and the audit trail all need the full history. So:

- An event leaves `cf_frappe_events` only in the same D1 transaction that records where it went, and only after the R2 copy has been read back and its SHA-256 checked.
- `ColdEventStorage` — the port R2 sits behind — has no delete method. Restoring a stream leaves its objects in R2.
- A segment that is indexed but missing or altered in R2 is a read **error**, never a shorter history.

## Where a stream may be cut

The hot write path resumes from a snapshot and reads only the events after it. So everything at or below a snapshot's `uptoSequence` is never read on the hot path, and that is the safe cut. Each kind of stream gets a **cut policy** (`EventArchiveCutPolicy`) that says where its cut is; a stream with no policy is never archived, because without a snapshot there is nowhere to resume from but sequence 1.

| Policy | Streams | Cut |
| --- | --- | --- |
| `documentFoldCutPolicy` | every application document | Records the `foldDocument` snapshot at the stream's head in `cf_frappe_fold_snapshots`, reads it back, and cuts there. |
| `userNotificationsCutPolicy` | `__UserNotifications` inboxes | The same, for the notification fold — the snapshot `UserNotificationService` already resumes from. |
| `deliveryOutboxCutPolicy` | the tenant's delivery outbox | The newest compaction checkpoint's `upToSequence`, lowered to just below the first event of any record it carried over as still in flight. |

When several policies apply the cut is the lowest of them. `keepHotEvents` (default 50) is then left hot at the end of the stream so a document's timeline opens without touching R2, and nothing is moved unless at least `minSegmentEvents` (default 100) events would go.

The snapshot is folded over events `≤ head` exactly, with `head` read once at the start. A snapshot that included an append landing mid-decision would apply that event twice when resumed.

### Streams that never move

`namingSeriesStream` and `uniqueValueStream` are read to decide a write — the next document name, whether a value is taken. They are listed in `ARCHIVE_PROTECTED_STREAM_DOCTYPES` (derived from the stream builders) and refused by `D1EventArchive.archive`, the lowest level that can delete a hot row. A stream name the framework cannot parse is refused too. No cut policy can override this.

## What still reads archived events

Every `EventStore`, `DocumentStore` and `AuditEventStore` read goes through `D1ArchivedEvents` when the archive is on: hot rows and the overlapping archive index rows are read in one D1 batch (one round trip, one consistent state), and any segments needed are fetched from R2 and merged by sequence. Callers cannot tell. The interfaces did not change.

| Reader | Reaches R2 when | Expected cost |
| --- | --- | --- |
| A plain update | almost never: the Durable Object resumes from the snapshot the archiver recorded (its in-memory snapshot store falls back to D1 on a miss) | none |
| Timeline / audit history | the user scrolls past `keepHotEvents` | one R2 read per segment |
| `cancel`, `amend`, `merge`, assign, tag, follow | always — they still fold the whole stream | one R2 read per segment, then cached in the isolate |
| Historic version folds (`maxSequence`) | the version is archived | as above |
| Audit search (`searchEvents`) | archived events fall in the window | one R2 read per candidate segment |
| #11 rebuild, #12 replay parity | always | minutes for a large tenant |

Archived segments are immutable, so `D1ArchivedEvents` keeps up to `cacheEvents` (default 10,000) parsed rows per isolate. Pass `onColdRead` to see every read that reached R2 — the operation, the stream, how many segments, how many came from the cache, and how long it took. That is the number to watch after turning archiving on.

## `currentVersion` after archiving

Optimistic concurrency compares `expectedVersion` with the stream's version. Once a stream's hot tail is empty, `MAX(sequence)` of the hot table is 0, and the next append would write sequence 1 again. The version is therefore `MAX(hot MAX(sequence), archived MAX(seq_end))`, read in one statement.

This is read **even with the archive off.** It is one primary-key seek into a table that is empty unless the archive has run, and it is what keeps a misconfigured deployment from corrupting a stream.

## Storage layout

```
R2:  events/<tenant>/<doctype>/<sha256(stream)>/<seqStart>-<seqEnd>.ndjson
D1:  cf_frappe_event_archive_segments   one row per segment: range, tenant, doctype, time span, key, digest
     cf_frappe_event_archive_documents  (stream, document_name, seq_start) for every name in a segment
```

Objects are laid out by stream, not by time, because the unit of re-reading is a stream. Each line is a `cf_frappe_events` row exactly as stored, so a restore is byte-identical.

The index lives in D1, not in an R2 index object as first sketched in #18, because it has to be written in the **same transaction** as the delete of the hot rows; an R2 object cannot join a D1 batch. Every object also names its stream and sequences, so the bucket alone describes what it holds.

`cf_frappe_event_archive_documents` exists for the delivery outbox, which keeps every record of a tenant in one stream and looks each one up by name on every enqueue (to stay exactly-once). Without it, proving a record absent would mean reading every archived segment of the outbox.

## Switching it on

1. Apply migration `0009_cf_frappe_event_archive` (it is created for every deployment and stays empty while the archive is off).
2. Add an R2 bucket binding, e.g. `EVENT_ARCHIVE`, used for nothing else.
3. Pass **the same options** to the Worker and the aggregate Durable Object:

```ts
import {
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEventArchiveOptions
} from "cf-frappe/cloudflare";

const eventArchive: CloudFrappeEventArchiveOptions<Env> = {
  bucket: (env) => env.EVENT_ARCHIVE,
  onColdRead: (metrics) => console.log("cold read", metrics)
};

export class AggregateCoordinator extends createAggregateCoordinatorClass<Env>({ registry, eventArchive }) {}
export default createCloudFrappeWorker<Env>({ registry, actor, eventArchive });
```

4. Drive archiving from a scheduled job. The runtime services carry `eventArchive` when the option is set, and they are a job's `resources` by default:

```ts
const jobs = createJobRegistry<CloudFrappeRuntimeServices>({
  jobs: [{
    name: "archive-cold-events",
    // One bounded pass per run; the cursor comes back as the next run's payload
    // if you want to resume rather than rescan.
    handler: async ({ resources, payload }) => {
      const pass = await resources.eventArchive!.archivePass({
        ...(typeof payload.after === "string" ? { after: payload.after } : {}),
        limit: 50
      });
      return { archived: pass.results.filter((result) => result.status === "archived").length, next: pass.next ?? null };
    }
  }]
});

createCloudFrappeWorker<Env>({
  registry,
  actor,
  eventArchive,
  jobs: {
    registry: jobs,
    queue: (env) => new CloudflareJobQueue(env.JOBS),
    cronTriggers: ["0 3 * * *"],
    schedules: [{ id: "archive-cold-events", cron: "0 3 * * *", jobName: "archive-cold-events" }]
  }
});
```

Each pass archives up to `limit` streams and returns a cursor. A failure on one stream is reported in its result and the pass moves on; every failure leaves that stream's hot events in place.

## Switching it off

Run `restorePass()` until it returns no cursor, then remove the option from both places.

A store without the archive refuses a stream whose oldest events are missing (`EVENT_ARCHIVE_REQUIRED`) rather than folding half of it. It cannot detect every case — a read filtered by payload kind, or a stream whose every event is archived, comes back empty rather than failing — but the version check above still sees the archive, so no write can reuse a sequence. Configure both places, or neither.

## Limits

- A segment is filed under one tenant and one doctype; a stream that mixes them is refused (`EVENT_ARCHIVE_INVALID`). Every stream the framework writes satisfies this.
- Restoring a segment is one D1 batch of one insert per event, so `maxSegmentEvents` is capped at 5,000 (default 500).
- Every R2 read is a subrequest. A rebuild or an audit search that spans thousands of archived segments in one invocation can reach the Workers subrequest limit; drive rebuilds in batches (`ProjectionRebuildService.advance` already is) and keep audit windows bounded.
- `cancel`, `amend` and the collaboration commands still fold whole streams, so on an archived document they read R2 (then the isolate cache). Snapshotting the assignment, tag and follower folds, as #18 suggests, would remove that; it is a latency improvement, not a correctness one, and is not done here.
