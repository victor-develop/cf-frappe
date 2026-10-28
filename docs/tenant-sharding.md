# Tenant Sharding

How to spread tenants across several D1 databases, move a tenant between them while it keeps working, query across them, and keep their schemas in step. Issue #14, phase T2 of the projection roadmap (#5).

**This is off by default, and should stay off until its trigger is reached:** the first tenant large enough to need a database of its own, or a database approaching D1's 10 GB ceiling. Archiving cold events (#18) and the separate projection database (#13) come first; both are cheaper and both can be undone. Sharding's costs — cross-tenant queries, moves, provisioning — are permanent once you rely on them. With the switch off, nothing on this page runs and nothing a deployment sees changes.

## Why it is an adapter

Every port the framework writes through already names its tenant: `ProjectionStore.get(tenantId, …)`, `list({ tenantId, … })`, a stream name (`<tenant>:<doctype>:<name>`), an audit query. So sharding is a set of stores that look up where a tenant lives and forward the call:

| Port | Routing store | Routes by |
| --- | --- | --- |
| `EventStore`, `EventBatchStore`, `StreamCatalog`, `AuditEventStore` | `TenantRoutedEventStore` | the stream's tenant, or `query.tenantId` |
| `DocumentStore` | `TenantRoutedDocumentStore` | the commit's streams (all one tenant) |
| `ProjectionStore` and its extensions | `TenantRoutedProjectionStore` | `tenantId` / `snapshot.tenantId` |
| `SnapshotStore` | `TenantRoutedSnapshotStore` | the folded stream's tenant |

`DocumentService`, `QueryService` and every other service in `src/application` are constructed with these instead of the D1 stores and are otherwise unchanged. A single atomic write must stay inside one tenant — D1 batches are atomic only within one database — and a batch naming two tenants is refused (`TENANT_SHARD_INVALID`). Nothing in the framework issues one.

## The directory

`cf_frappe_tenant_shards` on `DB` maps tenant → shard. `DB` is always a shard too, called `home` unless you name it otherwise, and it is where every tenant lives until something places it elsewhere.

- **Reads never place a tenant.** A tenant with no entry reads from `home`, and that answer is not cached.
- **The first write places it.** With `newTenants: "home"` (the default) it lands on `home`, so switching sharding on changes nothing for anyone; with `newTenants: "place"` it lands on the accepting shard with the fewest tenants, after that shard's migrations are brought up to the plan — unless the tenant already has events on `home` (it wrote before sharding was on and was never registered), in which case it is registered on `home`: placing it elsewhere would strand its history there, restart its naming series and duplicate its unique values. Two isolates placing the same tenant at once agree on one shard (`INSERT … ON CONFLICT DO NOTHING`, then read back).
- **`__global__`** — framework state such as job schedule definitions — always lives on `home` and never gets an entry. Its streams' rows carry the tenant id of whoever wrote them (a runtime job schedule saved by `acme` is an `acme` row on `__global__:__JobSchedules:definitions`), so the fence trigger and the mover skip `__global__:` streams: a tenant that moved off `home` can still save and delete its schedules there, and a move never carries them along. Do not give a customer tenant the id `__global__`: it would be pinned to `home` and could never move.

Each isolate caches answers for `cacheTtlMs` (5 s). What that cache can get wrong after a move:

- **Writes: nothing.** The source shard is fenced before the move's final copy (below), so a write routed there by a stale cache is refused inside its own transaction; the routing store forgets the cache entry, asks the directory again, and retries on the new shard. A write that is still fenced after `fenceWaitMs` (5 s) fails with `503 TENANT_MOVING`, which is safe to retry.
- **Reads: at most `cacheTtlMs` of staleness.** The source still holds the tenant exactly as it was when the move fenced it — a complete, consistent, slightly old state, never a partial one.

### The fence

`cf_frappe_tenant_fences` and a `BEFORE INSERT` trigger on `cf_frappe_events` exist in every database (migration `0009`). A row in the fence table makes the trigger raise `CF_FRAPPE_TENANT_FENCED` for any event insert of that tenant, which rolls back the whole batch — events, inline projection rows, projection handoff — whichever code path issued it — except on `__global__:` streams, which live on `home` whatever tenant id their rows carry (above). It is a trigger rather than a check in the adapters because a check would read and then write (a race) and would have to be in every writer. Verified on workerd's D1 (`wrangler dev`) and on `node:sqlite`; D1 reports it as `D1_ERROR: CF_FRAPPE_TENANT_FENCED: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`, which `isD1TenantFencedError` recognizes and the D1 stores rethrow as is instead of reporting a version conflict.

With no fence rows — every deployment that never moves a tenant — the trigger costs one primary-key probe of an empty table per event insert. The table and trigger are there whether sharding is on or off, so with the switch off the behaviour is the same as without this feature but the schema is not.

## Turning it on

1. **Create and bind the shards.** A Worker can only query D1 databases bound at deploy time — about 5,000 per Worker ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)) — so shards are created ahead of time with `wrangler d1 create`, not by the Worker. Apply **the same migrations directory** to each, as `DB` gets.

   ```jsonc
   "d1_databases": [
     { "binding": "DB", "database_name": "app", "database_id": "…", "migrations_dir": "migrations" },
     { "binding": "SHARD_EU1", "database_name": "app-eu1", "database_id": "…", "migrations_dir": "migrations" },
     { "binding": "SHARD_EU2", "database_name": "app-eu2", "database_id": "…", "migrations_dir": "migrations" }
   ]
   ```

2. **Define the option once and pass the same object to the Worker and the coordinator.** The coordinator writes and the Worker reads; they must agree where a tenant lives.

   ```ts
   import {
     createAggregateCoordinatorClass,
     createCloudFrappeWorker,
     type CloudFrappeTenantShardingOptions
   } from "cf-frappe/cloudflare";
   import { createTenantMoveAdvanceJob } from "cf-frappe";

   const tenantSharding: CloudFrappeTenantShardingOptions<Env> = {
     // Ids are stored in the directory: never rename one.
     shards: (env) => ({ eu1: env.SHARD_EU1, eu2: env.SHARD_EU2 }),
     newTenants: "place",          // or "home" (default) to keep placing on DB
     accepting: ["eu1", "eu2"]     // which shards take new tenants
   };

   export const AggregateCoordinator = createAggregateCoordinatorClass<Env>({ registry, tenantSharding });
   export default createCloudFrappeWorker<Env>({
     registry,
     actor,
     tenantSharding,
     jobs: {
       registry: createJobRegistry({ jobs: [createTenantMoveAdvanceJob()] }),
       queue: (env) => new CloudflareJobQueue(env.JOBS)
     }
   });
   ```

   Deploy it in one non-gradual deployment, for the same reason as the projection switch: an old Worker next to a new coordinator would disagree on where tenants live.

3. **Register existing tenants** (recommended; do it before switching to `newTenants: "place"`). Tenants that already live on `DB` keep working without an entry — under `"place"` too, because provisioning checks `DB` for the tenant's events before placing it anywhere else and keeps a tenant it finds there on `home` — but cross-tenant listings only see tenants in the directory, and that check costs one index probe on each unregistered tenant's first write. `services.tenantShards.directory.assign(tenantId, "home")` registers one; do it for each tenant you know of.

`services.tenantShards` on the Worker's runtime services carries `directory`, `provisioner`, `migrations`, `mover`, `scatter` and `router`. None of it is exposed over HTTP.

### With the separate projection database

Sharding composes with `projectionDatabase` (#13): each shard then runs the split layout with a projection database of its own. Pass both options to both sides; every shard but `home` names its projection database (`home` uses `projectionDatabase.database(env)`), and a shard without one is refused at startup:

```ts
shards: (env) => ({ eu1: { database: env.SHARD_EU1, projectionDatabase: env.SHARD_EU1_PROJECTIONS } })
```

The projection drain, rollback drain and read-your-writes wait are routed per tenant like everything else.

## Provisioning

`services.tenantShards.provisioner.provision(tenantId, { shardId? })` places a tenant ahead of its first write — at sign-up, or to give a known-large tenant a shard of its own. Without `shardId` it applies the placement policy. With a `shardId` other than `home` it refuses (`409 TENANT_SHARD_INVALID`) a tenant that already has events on `home`: getting that tenant elsewhere is a move. Before a tenant lands on any shard but `home`, that shard is brought up to the migration plan (`planD1Migrations(registry.list())`, or the `migrations` option).

What provisioning cannot do is create a D1 database: see step 1. Adding a shard is: create it, apply migrations, bind it, add it to `shards`, deploy, then add it to `accepting`.

## Moving a tenant

```ts
const move = await services.tenantShards.mover.start("acme", "eu2");
// then let the job advance it (schedule per tenant being moved, like the drain job):
//   { cron: "* * * * *", jobName: "cf-frappe.tenant-move.advance", tenantId: "acme" }
// or drive it yourself:
await services.tenantShards.mover.advance(move.moveId);
```

The tenant keeps reading and writing throughout. Events are the asset and projections are a cache, so a move copies events and rebuilds projections from them:

| Phase | What happens | Reads and writes |
| --- | --- | --- |
| `copying` | every event of the tenant `INSERT OR IGNORE`d into the target, in `(occurred_at, stream, sequence)` order — the `idx_cf_frappe_events_tenant_time` index, no sort | source |
| `building` | the target's projection table rebuilt from the copied events with the #11 backfill, one projected doctype at a time — a second, not-yet-active projection version (#10) | source |
| `catching-up` | passes that re-read the source from the start of the previous pass less `catchUpMarginMs` (5 min), copy what the target lacks, and refold the streams those events touched; repeats until a pass finds at most `cutoverThreshold` (100) missing events | source |
| `cutover` | in **one** call: claim the attempt in the journal, fence the source, run the final pass, compare the tenant's event counts on both sides, flip the directory | writes wait (retrying) for one invocation; reads continue |
| `completed` | the directory points at the target; `epoch` bumped | target |

Why it cannot lose an event: an event committed before a pass started is found by that pass, and an event committed after was stamped no earlier than that start less its commit latency, which the next pass's window covers. The cutover then checks this instead of trusting it. Every target event is a copy of a source event by id, so **equal counts mean equal sets**. If the counts differ — an event committed later than the margin assumed — or the final pass would take more than `maxCutoverPages` (20) pages, the fence comes off and the move goes back to catching up (from the tenant's first event after a count mismatch). The write stall is bounded by one invocation, never a pass over the tenant.

Each step is bounded: `pagesPerAdvance` (5) pages of `pageSize` (100) events, at three queries a page plus the refolds — inside Workers Paid's per-invocation query limit with the job's default 10 steps. On Workers Free, lower both.

Journaled in `cf_frappe_tenant_moves` with a revision compare-and-swap, so two drivers advancing the same move (an overlapping cron tick, a retried message, an operator's `mover.run` next to the job) cannot both apply a step, and a stale driver can never flip the directory. A cutover claims its attempt (a journal write) before it fences, so a second driver holding the same revision stops before it touches anything.

**The fence belongs to one cutover attempt, not to the move.** Every attempt of a move shares its move id, so a fence row keyed only by move could not tell a live attempt from a dead one: a driver whose back-off journaled could lift the fence a newer attempt of the same move was about to flip under, and a write routed to the source by a stale cache in that window would be acknowledged and then left behind. So the fence row also carries the attempt — the journal revision that attempt's claim produced:

- A later attempt takes the row over (`ON CONFLICT … DO UPDATE … WHERE attempt < excluded.attempt`); an earlier one never does, so a stale driver arriving late cannot mistake a live fence for its own.
- Right after fencing, the cutover re-reads the journal; if an abort or a later claim landed in between, it lifts its own attempt's fence and stops.
- Right before the flip, it checks the fence is still its own attempt's, and stops if not.
- A back-off deletes only its own attempt's row, and only after its journal write succeeded and while the directory still points at the source.
- An abort lifts the move's fence whichever attempt holds it: the move is over, and nothing else would.

A driver that loses a race leaves the fence alone, because the move is either completed (the fence must stay) or in another driver's hands.

`mover.abort(moveId, reason)` abandons a move before its cutover lands: the journal records the abort, then the fence comes off and the tenant stays where it was. An abort that loses to a completing cutover fails with a conflict and leaves the source fenced.

**If a tenant is stuck on `503 TENANT_MOVING`.** An invocation that dies between fencing and its journal write leaves the fence on. If the move is still in `cutover`, the next `advance` takes it from there (it either completes or lifts it). If the move is back in `catching-up` — a back-off whose journal write committed but whose lift never ran — the next catch-up pass lifts that dead attempt's fence by itself. If the move was aborted meanwhile, call `mover.abort(moveId, reason)` again: on an aborted move it lifts that move's leftover fence, provided the directory still points at the source. A cutover that keeps failing — a final pass that never fits in one invocation, for a tenant too large or too busy — can be stopped the same way, with `abort`, and retried at a quieter time; the move's `state.cutovers` lists every attempt and its outcome.

A move refuses: a target that is behind the source on migrations (roll them out first), a tenant already moving, the shard the tenant is on, and `__global__`.

### What a move leaves behind

**Nothing is deleted.** The source keeps the tenant's events and projection rows exactly as they were at the fence, and keeps the fence, so no stale cache can ever write there again. That is deliberate: deleting events is the one thing #5 rules out, and a frozen copy costs storage, not correctness. Scatter-gather goes by the directory, so it never double-counts the copy.

It also means moving a tenant **off** a shard stops that shard's growth from that tenant but does not shrink it. The framework does not reclaim that space, and #5's rule against deleting events applies to a frozen copy as much as to anything else: if the space is needed, archive the copy to R2 (#18) — a human decision, made after checking that the target holds every event (the cutover report journaled with the move records both counts).

**After a move, a tenant's audit trail on its new shard does not include its `__global__` rows.** Runtime job schedule definitions it saved stay on `home` (above), and the event log, audit and `searchEvents` route by tenant, so they read the tenant's shard and no longer show those rows. They are still on `home`, readable there by an operator.

**Switching sharding off after the first move needs every tenant moved back to `home` first.** The unsharded stores only read `DB`: for a moved tenant that is the frozen copy, and every write to it hits the fence and fails with a 500. Move each tenant back (and wait for its move to complete), then switch off.

Moving a tenant **back** onto a shard holding its frozen copy works: the copy is a prefix of the tenant's history (events never change, ids are unique), so the move copies on top of it. Its fence is lifted at the start of the move, but only once the move away from it finished more than `staleFenceAgeMs` (10 s, twice the cache lifetime) ago — measured from when the directory flipped, not from when that move's cutover began — so no isolate can still be routing writes there.

## Per-shard migrations

Every shard keeps its own migration journal, so each shard answers "what am I on" for itself:

```ts
await services.tenantShards.migrations.status();
// [{ shardId: "home", applied: [...], pending: [] }, { shardId: "eu2", applied: [...], pending: ["0010_…"] }]
```

Both journals count: `cf_frappe_migrations` (written by `D1MigrationRunner`) and Wrangler's `d1_migrations` (written by `wrangler d1 migrations apply`), so shards migrated either way report correctly. A checksum mismatch against `cf_frappe_migrations` is reported per shard as `error`.

**Rolling upgrade:** `migrations.rollOut({ shards?, maxShards? })` applies the plan one shard at a time, in order, and stops at the first failure — the remaining shards are `not-attempted`. Re-running resumes, since each shard skips what it has applied. During a roll-out shards run different schema versions under the same code, so migrations must be expand/contract:

1. Ship migrations that only add (tables, nullable columns, indexes), and code that works with and without them.
2. Deploy the code. Roll the migrations out shard by shard (`rollOut`, or `wrangler d1 migrations apply` per binding).
3. Only in a later release, after every shard reports `pending: []`, ship anything that removes what the old code needed.

## Cross-tenant queries

`services.tenantShards.scatter` is for the operator console, billing roll-ups and global search — questions across tenants, which are the permanent cost sharding adds. Its limits are the point:

- **A call names its tenants, at most `maxTenants`** (50 by default, 500 at most). There is no "all tenants" call; walk the directory with `scatter.tenants({ after })` and call once per page, so each call's cost is bounded by its page.
- **At most `concurrency` (6) calls in flight** — D1's simultaneous connections per Worker invocation.
- **Each tenant has a deadline** (`perTenantTimeoutMs`, 5 s); a tenant that misses it or whose shard errors is reported in `failures` and the rest still answer.
- **A merged search returns at most `maxResults` (100) rows.**

```ts
const page = await scatter.tenants({ limit: 50 });
const billing = await scatter.countDocuments({ tenants: page.map((t) => t.tenantId), doctype: "Invoice" });
const recent = await scatter.search({ tenants: page.map((t) => t.tenantId), doctype: "Ticket", limit: 20 });
const custom = await scatter.gather({ tenants, run: ({ tenantId, shard }) => shard.events.searchEvents({ tenantId, limit: 10 }) });
```

These read projections directly, **without row-level permissions**. They are system tools; an application building an endpoint on them must put its own authorization in front.

## What it costs

- **One directory read per tenant per isolate per `cacheTtlMs`**, on `DB`. With `newTenants: "home"` the "not registered yet, read from home" answer is cached too; with `"place"` it cannot be (the first write may put the tenant anywhere), so a tenant that has never written costs a directory read on every read until it does.
- **One primary-key probe per event insert** for the fence trigger, on every database the migration reaches — including deployments that never switch sharding on.
- **Cross-tenant questions become one query per tenant**, bounded as above. This is the cost the issue says is permanent.
- **A move** costs reading the tenant's events once in full, re-reading each catch-up window, and a fold per touched stream; plus one write stall of one invocation at the cutover.

## Moving under the split layout

With `projectionDatabase` on, a move rebuilds the target's **projection database**. The target's own `cf_frappe_documents` — which only the rollback drain writes — is not rebuilt, and the rollback cursor came across with the events. So for a tenant moved while the split was on, switching the split off later must use the documented fallback rather than the rollback drain: fold its streams into the primary's table with `ProjectionBackfillService` (see [Separate Projection Database](projection-database.md), "Turning it off").

## What stays on `DB`

The directory, the move journal, the data-patch journal and the job execution log stay on `DB`: they are deployment state, not tenant data, and they grow with operations rather than with writes.

## Where things are

| | |
| --- | --- |
| `src/ports/tenant-shards.ts` | `TenantShardDirectory`, `TenantShardResolver`, `TenantShardAssignment` |
| `src/adapters/sharding/tenant-shard-router.ts` | `TenantShardRouter`, the cache, `writeWithFenceRetry`, `tenantOfStream` |
| `src/adapters/sharding/tenant-routed-stores.ts` | the routing stores |
| `src/adapters/sharding/tenant-scatter-gather.ts` | `TenantScatterGather` and its limits |
| `src/adapters/sharding/tenant-move-job.ts` | `createTenantMoveAdvanceJob` |
| `src/adapters/d1/tenant-shard-directory.ts` | the directory, the move journal, fences |
| `src/adapters/d1/tenant-provisioning.ts` | `D1TenantProvisioner`, `D1ShardMigrations` |
| `src/adapters/d1/tenant-mover.ts` | `D1TenantMover` |
| `src/adapters/d1/schema-planner.ts` | `D1_TENANT_SHARD_SCHEMA_STATEMENTS`, the fence trigger |
| `src/cloudflare/tenant-sharding.ts` | `CloudFrappeTenantShardingOptions` and the wiring |
| `tests/adapters/tenant-sharding.test.ts`, `tests/adapters/tenant-move.test.ts`, `tests/cloudflare/tenant-sharding.test.ts` | routing, fences, provisioning, migrations, scatter-gather, moves under live writes, the Worker end to end |
