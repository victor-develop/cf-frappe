# Separate Projection Database

How to move projections out of the event database into a D1 database of their own, what that costs, and how to switch back. Issue #13, phase T1 of the projection roadmap (#5).

**This is off by default, and should stay off until its trigger is reached:** the primary database is approaching 5 GB, or read load is measurably slowing writes. Archiving cold events (#18) comes first. With the switch off, nothing on this page runs and nothing a deployment sees changes.

## What changes

In the default layout a commit writes its events *and* its projection rows in one D1 batch. A document is listable the moment the write returns, and every list, report and dashboard reads the same single-writer database the writes go to.

With the switch on:

| | Single database (default) | Split |
| --- | --- | --- |
| Events, optimistic concurrency, naming series, unique values | `DB` | `DB` — unchanged |
| `cf_frappe_documents`, `cf_frappe_automation_runs` | `DB`, written in the commit | projection database, written from the outbox |
| What the commit batch carries besides events | projection rows | one outbox record on the `projections` channel |
| A document read by name | `DB` | projection database, checked against the stream head on `DB` |
| Lists, reports, dashboards, search, link options | `DB` | projection database — **eventually consistent** |

The cost the issue names is real: **a list can be behind the write that preceded it.** Desk creating a document and jumping to the list may not show it yet; a test that writes and immediately lists will see the old list. Everything below is about keeping that window small, making it visible, and letting the callers that care close it.

## Which reads must be strong

| Read | Consistency | How |
| --- | --- | --- |
| One document by name: form load, `getDocument*`, print, workflow actions, automation targets | **strong** | `ConsistentProjectionStore.get` uses the projection row only when its version is at the document stream's head on `DB` (one indexed `MAX(sequence)`); otherwise it folds the document from `DB`'s events |
| Naming series, unique values, expected-version checks, every write's own read | **strong** | never read projections — `DocumentService` folds the event stream on `DB` in every layout |
| Lists, link options, search, reports, dashboards, kanban, calendar, CSV export, automation-run claim candidates | **eventual** | the projection database as it stands; a read-your-writes token makes the read wait for the caller's own writes first |

The middle row is what makes the split safe at all: nothing that decides a write reads a projection, so a lagging projection can make a read stale but can never make a write wrong. `tests/application/projection-split.test.ts` pins it — naming series and a unique conflict are decided correctly with the projection database completely empty. The table also lives in code, as `PROJECTION_READ_CONSISTENCY` in `src/application/projection-read-consistency.ts`.

Automation-run claim candidates being eventual only delays a claim: the claim itself is a compare-and-swap on the run's own stream.

## How a write reaches the projection database

1. **The handoff, in the commit.** `D1DocumentStore` is constructed with a `ProjectionHandoff` (`src/ports/document-store.ts`). Instead of upserting rows, the batch appends one `DocumentDeliveryOutboxEnqueued` event — target `projection`, carrying every row the commit produced (the document, its naming counter, its unique reservations) — to the tenant's `projections` outbox stream. Same batch, so a write and its outbox record cannot come apart: not on a crashed Worker, not on an evicted Durable Object. That is the guarantee an after-commit hook (how notifications reach the outbox) cannot give.
2. **Appended at the head, not by compare-and-swap.** Every write in a tenant hands off into the same stream. A CAS on it would serialize every writer in the tenant behind one version, so the record takes `MAX(sequence) + 1` inside the batch instead (`insertEventAtHeadStatement`). Head appends cannot conflict with each other, and nothing else ever appends to this stream — the consumer only reads it. `UNIQUE(stream, sequence)` still stands behind it.
3. **Applied eagerly.** Right after the commit lands, the coordinator applies the same rows to the projection database (`eagerApply`, on by default). That is one extra D1 write on the write path, and it is why a document is normally listable before the write returns. A failure here is logged (`cf-frappe.projection.eager-apply-failed`) and never fails the write.
4. **Drained by cursor.** Head-append sequences are serial and gap-free, so "every record up to sequence N is applied" is the consumer's whole state. `ProjectionDeliveryConsumer` keeps it on a stream of its own, `<tenant>:__ProjectionDelivery:cursor`, that only consumers append to. A round reads the records past the cursor (up to `limit`, 25 by default), applies the newest row per document in one `saveNewest` batch, and advances the cursor with one `ProjectionDeliveryCursorAdvanced` event. Rows are written with `saveNewest`, which keeps whichever row has the higher version — so a round applied twice, a delivery that lands after a newer eager apply, and a concurrent backfill all leave the newest row in place. The automation-run claim index has no version of its own and is rewritten only when the document row holds exactly that version.
5. **Writes never contend with the drain.** The consumer compare-and-swaps only its cursor stream, which no writer touches, so it makes progress however busy the tenant is. (An earlier design claimed and completed records on the channel itself; under sustained writes every head append moved the version the claim was checking, and the drain starved exactly when it had the most to do.) Two drains racing for the same range both apply it, harmlessly; one advances the cursor, and the other gets a conflict and stops.
6. **Failure.** A round whose apply throws does not advance: the next drain reads the same records again, the job's retry backs off, and the lag alert fires if it goes on. A record that can never apply — it carries no valid snapshot — is read past rather than blocking every later write: it is named in the cursor event's `skipped` list and logged as `cf-frappe.projection.delivery-skipped`. A backfill repairs whatever it would have written.

Projection deliveries travel on their own channel — their own stream per tenant — rather than the notification outbox's, which still claims and completes records with compaction (see [Document Delivery Outbox](delivery-outbox.md)).

## Read-your-writes

With `readYourWrites` configured, every successful write under `/api/resource/*` that returns documents carries a token:

```
X-CF-Frappe-Read-After: <token>
```

Send it back on any `GET /api/*` that must see that write. The read waits — up to `timeoutMs`, 2 s by default — until the projection database shows every document in the token at the version written, then runs, and says how it went. Each check is one query for every document in the token at once; the pauses between checks back off from `pollMs` (50 ms) to `maxPollMs` (500 ms), and a wait runs at most `maxChecks` (10) checks. With the defaults a wait that times out costs 8 D1 queries, well inside the per-invocation query limit even on Workers Free — a wait that blew that limit would turn the one case it exists for, a lagging projection, into an error instead of a `stale` answer.

```
X-CF-Frappe-Consistency: fresh | stale | eventual
```

- `fresh`: the projection showed the write before the read ran.
- `stale`: the wait timed out and the read ran anyway against the projection as it stood. A list has no primary to fall back to once its rows have moved, so the honest choices are to wait and to say so, and this does both. By-name reads never need a token; they are strong already.
- `eventual`: the token belongs to another actor or tenant, or has expired (`ttlSeconds`, 300 by default). Ignored, not refused.

A forged or malformed token is a `400`.

The token is HMAC-signed and bound to the tenant and the actor who wrote. That is not ceremony: waiting on a version is an oracle, and an unsigned token naming any document would tell its bearer whether a document they cannot read exists and how far it has been edited. Signed, a token can only name writes its bearer made. The secret comes from the environment — `wrangler secret put READ_AFTER_SECRET` — never from source.

Desk does not forward tokens yet. Desk form loads are strong; a Desk list right after a create relies on the eager apply.

## Lag

`ProjectionDeliveryConsumer.lag(tenantId)` reports the cursor, the channel head, the records in flight between them, and the age of the oldest — three point reads however far behind the consumer is. `checkLag` compares it with the thresholds (`maxAgeSeconds`, 120 by default; `maxInFlight`, 1 000) and raises an alert when one is breached. The Cloudflare wiring's default alert is one structured log line, which Workers Logs records and a log-based alert can match on:

```json
{"event":"cf-frappe.projection.lagging","tenantId":"acme","status":"lagging","breaches":["age"],"ageSeconds":3600,"inFlight":1,...}
```

Pass `onLagAlert` to route it elsewhere. The drain job (`cf-frappe.projection-delivery.drain`) checks lag after every drain — including one that threw, which is when the alert matters most — so the cron that keeps the projection database fed is also what notices it falling behind.

`onReadFallback` is told every time a by-name read found its projection row behind the stream head and folded `DB` instead. That is read load landing back on the primary; wire it to a metric if you want to watch it. It is not logged by default.

## Turning it on

1. Create the projection database and apply **the same migrations directory** to it. Only `cf_frappe_documents` and `cf_frappe_automation_runs` are used there; the other tables stay empty, which is cheaper than a second schema to keep in step. Generated projection-index migrations belong there too — that is where lists run.

   ```jsonc
   "d1_databases": [
     { "binding": "DB", "database_name": "app", "database_id": "…", "migrations_dir": "migrations" },
     { "binding": "PROJECTIONS_DB", "database_name": "app-projections", "database_id": "…", "migrations_dir": "migrations" }
   ]
   ```

2. Define the option once and pass **the same object** to both the Worker and the coordinator. The coordinator decides where writes put their rows and the Worker decides where reads look; one without the other leaves reads looking at a table nobody writes.

   ```ts
   import {
     createAggregateCoordinatorClass,
     createCloudFrappeWorker,
     type CloudFrappeProjectionDatabaseOptions
   } from "cf-frappe/cloudflare";
   import { createProjectionDeliveryDrainJob } from "cf-frappe";

   const projectionDatabase: CloudFrappeProjectionDatabaseOptions<Env> = {
     database: (env) => env.PROJECTIONS_DB,
     readYourWrites: { secret: (env) => env.READ_AFTER_SECRET }
   };

   export const AggregateCoordinator = createAggregateCoordinatorClass<Env>({ registry, projectionDatabase });
   export default createCloudFrappeWorker<Env>({
     registry,
     actor,
     projectionDatabase,
     jobs: {
       registry: createJobRegistry({ jobs: [createProjectionDeliveryDrainJob()] }),
       queue: (env) => new CloudflareJobQueue(env.JOBS),
       schedules: [{ cron: "* * * * *", jobName: "cf-frappe.projection-delivery.drain", tenantId: "acme" }]
     }
   });
   ```

   Schedule the drain job per tenant, with the matching cron trigger in `wrangler.jsonc`. With `eagerApply` on, the drain is the safety net, so once a minute is plenty; with it off, the drain interval *is* the list lag.

   **Deploy the switch atomically.** The coordinator decides where rows go and the Worker decides where reads look. During a gradual deployment an old Worker reading `DB`'s table, next to a new coordinator writing through the handoff, serves stale lists and stale by-name reads (the old read path has no head check). Use a single non-gradual deployment for the switch in either direction, then run the backfill.

3. **Backfill, switch, backfill again.** The projection database starts empty. `services.projectionBackfill` (a `ProjectionBackfillService`) folds a doctype's streams on `DB` into whichever table reads come from in the current layout:

   ```ts
   for (const doctype of [...registry.list().map((d) => d.name), ...PROJECTED_FRAMEWORK_DOCTYPES]) {
     await services.projectionBackfill.run({ tenantId, doctype });
   }
   ```

   Run it with `projectionBackfill` pointed at the projection database before switching (construct `ProjectionBackfillService` with `target: new D1ProjectionStore(env.PROJECTIONS_DB)`), deploy the switch, then run it again through `services.projectionBackfill`. Writes that landed between the first pass and the switch went to `DB`'s own table; the second pass picks them up. Both passes are safe against live traffic because `saveNewest` never replaces a row with an older one. `advance` does one batch and returns a cursor, for drivers that want to pace it.

4. Run `analyzeD1Statistics` against the projection database as well — the planner statistics (#7) matter where the lists run.

## Turning it off

Remove `projectionDatabase` from both, deploy, then backfill. With the switch off, `services.projectionBackfill` targets `DB`'s own projection table, which stopped being written while the split was on:

```ts
for (const doctype of [...]) await services.projectionBackfill.run({ tenantId, doctype });
```

Until the backfill finishes, documents written during the split are missing or stale in lists; reads by name are not affected, since a missing row is folded from events. Writes resume inline immediately and nothing more is handed off. Records still past the cursor on the `projections` channel are harmless — nothing reads them once the drain job is gone — and they remain in the event history like every delivered one. Switching on again later carries on from the same cursor; applying those old records then is a no-op, since `saveNewest` never replaces a newer row.

`tests/application/projection-split.test.ts` runs both directions on the real SQLite engine: on — backfill, a write that straddles the switch, split writes, second backfill — and off, where the primary's table ends up row-for-row equal to what the projection database held.

## What it costs

- **Lists are eventually consistent.** See above; this is the cost the issue says not to pay early.
- **The primary still grows.** Each write appends one channel record carrying its rows — the snapshot is stored a second time — and each drain round appends one small cursor event. Those are events and are never deleted; cold-event archival (#18) is what moves them out. The split takes the projection *table* and its indexes off the primary, not the write volume.
- **Cold-event archival (#18) must keep two heads.** The channel is appended at `MAX(sequence) + 1` of the rows present, and the cursor is read from the newest cursor event. Archiving the head row of either stream would reuse sequences on the channel and rewind the cursor. Archival may move older rows of both, but never the newest.
- **Writes do one more D1 write** with `eagerApply` on: the projection database batch after the commit.
- **By-name reads do one more indexed query** on `DB`: the stream head check.
- **A drain round is four queries** whatever the backlog: one keyed read of the next records past the cursor, one projection batch, and the cursor append (a version check and an insert); plus one cursor read per drain. Every D1 batch counts as one query against the per-invocation limit (1 000 on Workers Paid, 50 on Free — [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)), so the default of 10 rounds is about 41 queries — inside Free's limit too. A backlog drains at up to `limit × maxRounds` records per call (250 by default); raise the drain frequency or `maxRounds` if lag alerts fire.
- **Read-your-writes reads cost a bounded number of queries.** A read carrying a token for a write the projection already shows costs one query; one that has to wait costs at most `maxChecks`.
- **The backfill pages by key.** Each `advance` lists the next `batchSize + 1` streams after its cursor (`stream > ? ORDER BY stream LIMIT ?`), so it never holds the doctype's whole stream list in memory.

## Where things are

| | |
| --- | --- |
| `src/ports/document-store.ts` | `ProjectionHandoff`, `DocumentStoreProjectionOptions` |
| `src/ports/projection-store.ts` | `MonotonicProjectionWriter` (`saveNewest`), `ProjectionVersionReader` (`versions`) |
| `src/adapters/d1/event-writer.ts` | `insertEventAtHeadStatement` |
| `src/application/projection-delivery.ts` | `ProjectionOutboxHandoff`, `ProjectionDeliveryConsumer`, lag, the drain job |
| `src/application/projection-delivery-events.ts` | the cursor event, `ProjectionDeliveryCursorAdvanced` |
| `src/application/projection-read-consistency.ts` | `ConsistentProjectionStore`, `ProjectionCatchUp`, the consistency table |
| `src/application/projection-backfill.ts` | `ProjectionBackfillService`, `PROJECTED_FRAMEWORK_DOCTYPES` |
| `src/adapters/http/read-your-writes.ts` | token minting and checking, the headers |
| `src/cloudflare/projection-database.ts` | `CloudFrappeProjectionDatabaseOptions` and the wiring |
