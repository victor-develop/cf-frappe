# Document Delivery Outbox

How the outbox stays bounded as delivery history grows, and what that costs.

## The problem

The outbox is one event stream per tenant, `<tenant>:__DocumentDeliveryOutbox:deliveries`, and its state is folded on **every** outbox operation — enqueue, claim, fail, deliver. Delivered records used to stay in that folded state, so the working set grew with every delivery the tenant had ever made, and each record carries its `payload`: the full source event plus the document snapshot.

That is a slow leak with no ceiling, and a Worker isolate has 128 MB. Issue #28.

### What this bounds, and what it does not

**Be precise about which cost moved**, because the two halves moved in two separate changes.

| | Originally | After #54 | After compaction checkpoints |
| --- | --- | --- | --- |
| Working-set size, and the heap its payloads hold | grows with delivery history | bounded by in-flight work | bounded by in-flight work |
| Events read and folded per operation | grows with delivery history | **unchanged** | bounded |

#54 dropped delivered records from the folded Map, which bounded the heap. It did not make the read shorter: `state()` still called `readStream` on the whole stream and folded all of it. Measured with a counting store, one enqueue + claim + deliver per round, nothing left in flight at the end of each:

| Round | Events read that round, before | After compaction | With one permanently failing record pinned in flight |
| --- | --- | --- | --- |
| 10 | 87 | 24 | 33 |
| 20 | 177 | 24 | 33 |
| 30 | 267 | 24 | 33 |
| 40 | 357 | 24 | 33 |

Linear before, flat after. `tests/application/document-delivery-outbox-service.test.ts` asserts the equality between rounds *and* those absolute figures — a mutation that reintroduced the full read and happened to be flat for some other reason would still have to match a number.

The trade is query count and stream length, and both got worse:

| | Before | After |
| --- | --- | --- |
| Reads per enqueue + claim + deliver round | 5, returning 87…357 events | 11, returning 24 events |
| Events appended per round | 3 | 4 (+33%) |

Eleven round trips for four events is the right shape on D1, where a query returning 357 rows costs far more than an extra indexed lookup returning one — but it is more round trips, not fewer.

## The checkpoint

After a delivery, the same commit carries a `DocumentDeliveryOutboxCheckpointed` event:

```ts
{ kind: "DocumentDeliveryOutboxCheckpointed", upToSequence: number, carryOver: readonly string[] }
```

It says: *everything in this stream at or below `upToSequence` is terminal, except the records named in `carryOver`.* `state()` finds the newest one, rehydrates each carried id through the existing per-record read, and folds the stream from `upToSequence + 1` using `ReadStreamOptions.minSequence`.

Four things in that are load-bearing, and each was settled by breaking it and watching a test fail.

**`upToSequence` is `state.version` — the head *before* the commit — and `carryOver` is every id the working set still holds at that version.** Both come straight out of the state the delivery was planned against, so the claim the checkpoint makes is true by construction rather than by arithmetic: `state.records` *is* the in-flight set at `state.version`, and a reader that rehydrates those ids and folds from `state.version + 1` reconstructs exactly that state. Nothing depends on guessing which sequence the delivered event will land on.

**The checkpoint is committed *before* the delivered event, not after.** It therefore lands at `upToSequence + 1`, so a reader resuming at `upToSequence + 1` starts *on* the checkpoint and the delivery that follows it is inside the tail. Put it second and the delivery sits at `upToSequence + 1`, outside a read that begins at the checkpoint — and the record it terminates comes back out of `carryOver` as though it were still in flight. That mutation fails five tests.

**The lower bound is `upToSequence + 1`, and the checkpoint kind is in `DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS`.** Both halves matter, and they fail differently. An exclusive bound loses the delivery. Omitting the kind hides the checkpoint from the fold that computes `state.version` — and `state.version` is the optimistic-concurrency expectation, so a version below the true head means every append for that tenant fails with `Expected stream '…' at version 0, found N`, on all five retries, permanently. The service's own commits never leave a checkpoint at the stream head, so that is not reachable through them today; nothing enforces that, so a test writes one by hand.

**The checkpoint's id is derived — `evt_outbox_checkpoint_<tenant>_<upToSequence>` — not drawn from the id generator.** Every outbox test hands `deterministicIds` an exactly-sized list, so consuming an id here would exhaust roughly fifteen fixtures across three files, and the failure would be a thrown `No deterministic id left` somewhere unrelated-looking. Uniqueness comes from the CAS instead: at most one commit can succeed at a given `state.version`, so no two checkpoints in a stream can share an `upToSequence`. That is also why checkpoints make strict progress without tracking the previous one.

### A checkpoint cannot fail a delivery

It rides in the delivery's own `events` array, so there is one CAS. A conflict re-runs the plan callback against fresh state and recomputes the checkpoint; there is no second append to fail on its own, and no stale `upToSequence` to commit. On the *final* retry the checkpoint is dropped and the delivery commits alone, which covers the reasons bundling does not — such as a derived id colliding with a row already in the events table. A checkpoint is an optimisation; it must never be why a delivery fails.

### Why the checkpoint carries ids

Issue #28's own wording was a bare `upToSequence`, set to just below the oldest in-flight record. That is defeated by a single permanently failing target. `claimableDocumentDeliveryOutboxRecords` sorts by `enqueuedAt` ascending, so a poison record is re-claimed first on every drain and stays the oldest in-flight record indefinitely — and a checkpoint that had to wait for it never advances past its enqueue sequence. Measured that way, reads go straight back to linear: 96 / 186 / 276 / 366 events per round at rounds 10 / 20 / 30 / 40, the same slope as no fix at all. The pinned case is the likely case, not the corner.

Carrying the ids costs one indexed read each and holds the read flat at 33 events per round with a record stuck in `failed` on a far-future `retryAt`.

`retryAt` is doing work in that sentence. A record that is genuinely retried — the real 30 s to 30 min backoff, so it is re-claimed and re-failed while healthy deliveries keep moving the checkpoint — grows the read again, because `carriedOverRecords` rehydrates it from its own full history every time. Measured at 8 events per round: 114 at round 10, 1634 at round 200, of which 1614 are that rehydration while the tail read stays flat at 16. So the flat number describes a stuck record, not a busy one.

**Only `markDelivered` writes a checkpoint.** A tenant whose target is entirely broken never gets one, and its reads stay as unbounded as before — measured at 39 events per round rising to 1199 as retries reach 300. Compaction advances on success, and nothing else advances it.

### The lookup, and the case with no checkpoint

Finding the newest checkpoint runs on every outbox operation, so it has to be cheap in the case where there is **no** checkpoint too — which is the state every already-deployed stream is in until its first successful delivery, and the state a tenant above the carry-over limit stays in.

The checkpoint is written under `documentName = "__checkpoint"`, a sentinel no outbox id can take (ids are always `${eventId}:${target}` and so always contain a colon). That is what makes `idx_cf_frappe_events_document_name` — migration `0007`, already shipped — serve the lookup directly. Measured on 50,000 events in one outbox stream (`node:sqlite`, every migration applied, `EXPLAIN QUERY PLAN` with parameters bound, un-analyzed):

| Lookup | Plan | Checkpoints present | No checkpoint at all |
| --- | --- | --- | --- |
| `document_name = '__checkpoint'`, newest first — as shipped | `document_name (tenant_id=? AND doctype=? AND document_name=?)` | 2.0 µs | 0.6 µs |
| `type = 'DocumentDeliveryOutboxCheckpointed'`, newest first | `stream_sequence (stream=?)` | 2.7 µs | 6.0 ms |
| `json_extract(payload_json,'$.kind')`, newest first | `stream_sequence (stream=?)` | 9.5 µs | 13.8 ms |
| the full read `state()` used to do, for scale | `stream_sequence (stream=?)` | 66.8 ms | 64.8 ms |

The two middle rows stop at the first row of a backwards scan when a checkpoint sits near the tail, and scan the entire stream when none is there — an extra full scan per operation, on top of the full fold that also still happens, i.e. **worse than before this change** for a stream that has never compacted. The sentinel row is an empty index range instead, which is why its worst case is the cheapest number in the table.

**A fifth index was considered and rejected.** `(stream, type, sequence)` plans the `type` lookup as `SEARCH … USING INDEX (stream=? AND type=?)` at 3.2 µs whether or not a checkpoint exists — but it costs 17% on the append hot path (50k inserts in one transaction, median of 7: 157 ms baseline versus 183 ms, with non-overlapping run ranges), and it is unnecessary once the sentinel puts the lookup on an index that is already there.

**Read the µs column as an order of magnitude, not a figure.** It is `node:sqlite` returning a single row through this harness, and an independent re-measurement on another machine got 10.2 µs and 7.7 µs for the shipped row — 5x and 13x these — while reproducing the millisecond column closely (6.4 ms and 13.1 ms against 6.0 and 13.8). The load-bearing comparison is the one that survives both: **the shipped lookup is microseconds where the alternatives are milliseconds when the stream has no checkpoint yet**, which is the state every already-deployed stream starts in. The ordering *between* the microsecond variants did not hold across rigs and nothing depends on it.

Newest-first is a new `order` option on `AuditDocumentEventQuery`, implemented once as SQL and once as a comparator. `ORDER BY sequence DESC` comes off `0007` without a temporary B-tree, so it costs the same 2.0 µs. Reading ascending instead is not a plan regression — it just returns the *oldest* checkpoint and compacts nothing, which is why `tests/adapters/document-delivery-outbox-compaction-sqlite.test.ts` asserts the direction differentially against the in-memory adapter rather than only asserting a plan.

## Two reads, not one

The fix splits the read in two, by what each caller actually needs:

| Read | Folds | Answers |
| --- | --- | --- |
| `list(tenantId)` | the tenant's outbox stream | what is **in flight** — pending, claimed, failed |
| `record(tenantId, outboxId)` | one record's own events, by index | what happened to **this** record, delivered included |

`foldDocumentDeliveryOutbox` drops a record from the working set as it is delivered, so the set — and the payloads it retains — is bounded by in-flight work rather than by history. `foldDocumentDeliveryOutboxRecord` folds a single record's events and keeps terminal state, so nothing is lost; it moved, it did not disappear. That fold takes the record's id as a required argument, because outbox records share one stream and a fold that trusted whatever it was handed would apply one record's delivery to another.

Both live in `document-delivery-outbox-events.ts`, both have resumable `…From` variants, and both are covered by the fold associativity registry.

## What had to move with it

Dropping delivered records from the working set breaks anything that was reading history out of it. Three places were:

**Deduplication.** `enqueueFromDomainEvent` is called from an after-commit hook, so it can run twice with the same source event id — an interrupted Worker, an at-least-once queue. It used to check the folded state for the record id. That check has to outlive the record's stay in the working set, so it now reads the events instead. Without this, re-delivering an already-delivered source event would enqueue it a second time.

**Idempotent delivery.** A consumer handed the same message twice calls `markDelivered` twice. The second call finds nothing in the working set, so it consults `record()` first and returns the existing delivered record. A `notFound` there would be retried forever by the very consumer that already succeeded. Note that the second call's claim id is not checked: a redelivery need not know which claim won, and the stale-claim conflict must not fire on an already-terminal record.

**The return value of `markDelivered`.** The record leaves the working set in the same commit that delivers it, so the post-append fold cannot return it. It is read back from its own events.

A genuinely unknown record still fails: `record()` returns `null` and `markDelivered` raises `DOCUMENT_NOT_FOUND`.

## The index this depends on

Per-record reads are only bounded if SQLite can find one record's events without scanning the stream they share. That needs `idx_cf_frappe_events_document_name`, migration `0007`:

```sql
CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_document_name
  ON cf_frappe_events(tenant_id, doctype, document_name, sequence);
```

**The trailing `sequence` is load-bearing, and which column that is was settled by measurement rather than by reading the shape.** Drop it and the read silently degrades: SQLite prefers `idx_cf_frappe_events_stream_sequence`, because that index satisfies `ORDER BY sequence ASC`, and then scans the entire stream. Nothing looks wrong when that happens — the index exists, the query is correct, the results are right, and the read is still O(tenant delivery history). Only the query plan says so.

Measured on 50,000 events in one outbox stream (`node:sqlite`, in-memory, warm, 3000 iterations):

| Index | Plan | Per query |
| --- | --- | --- |
| none | `stream_sequence (stream=?)` | 3349 µs |
| `(tenant_id, doctype, document_name)` | `stream_sequence (stream=?)` — index not used | 3460 µs |
| `(…, sequence)`, as shipped | `document_name (tenant_id=? AND doctype=? AND document_name=?)` | 2.1 µs |

Note what the second row means: a three-column index performs the same as **no index at all**, because it is not chosen.

Two qualifications on that, both of which matter:

**It is a no-statistics result.** After `ANALYZE` the three-column index *is* chosen, at 2.4 µs with a temporary B-tree for the ordering — so the gap closes almost entirely. The un-analyzed plan is the one to design for, because no migration runs `ANALYZE` (see `docs/projection-indexes.md`), but "never chosen" would be too strong a claim.

**`stream` is deliberately not in the key.** It reads like it belongs, being a fourth equality column, and an earlier draft of this index had it. Measurement says it buys nothing: same plan, same 2.1 µs, while costing 23% more index storage (2124 vs 1644 KiB at 50k rows) and a slower append. Equality columns past the point where the ordering is satisfied are dead weight here.

### Write cost

This is a fourth index on `cf_frappe_events`, which is the append hot path. 50k inserts, `node:sqlite`, median of 5:

| | Baseline | With 0007 |
| --- | --- | --- |
| Single transaction | 141.0 ms | 163.9 ms (+16%) |
| Autocommit | 240.0 ms | 279.1 ms (+16%) |

It does not displace the plan for the hot read `WHERE stream = ?`, which keeps using `stream_sequence`.

`tests/adapters/d1-event-lookup-plans.test.ts` asserts the plan against a real engine loaded with the shipped migration files, and that assertion has been checked by mutation: reverting the index to three columns fails it.

## The stream-qualified query

`AuditEventStore.readDocumentEvents` grew an optional `stream`:

- **Omitted** — reads `documentStream(tenantId, doctype, documentName)`, the document's own stream. This is the security-relevant default, and it is why `audit-service.test.ts` can rely on an off-stream `DocumentDeleted` being ignored: a document's authoritative history is only ever in its own stream.
- **Given** — matches `(tenantId, doctype, documentName)` **within that one stream**. The outbox needs this because its records share one stream per tenant.

The stream stays a required input in both cases, so widening this query cannot widen the guard above it.

## The stream-qualified query, and `order`

`AuditEventStore.readDocumentEvents` also grew an `order` option, defaulting to `"asc"`. It exists for exactly one caller: the checkpoint lookup needs the *last* event under a `documentName` that accumulates one per delivery, and reading them all is the cost the lookup exists to avoid — 12,500 rows on a 50k-event outbox stream. It changes ordering only, never which rows match, so it cannot widen the `stream` guard above.

## Not done

**A permanently failing target still pins the working set, and above a threshold it now also stops compaction.** Failed records never leave the working set. That backlog is visible (`status: "failed"`) so it is an operational signal rather than a silent leak, but nothing prunes or caps it. Compaction carries at most **25** in-flight ids (`DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_CARRY_OVER_LIMIT`, the default claim limit); above that no checkpoint is written and that tenant's reads go back to folding the whole stream — the pre-#28 cost. That is deliberate: the alternatives are a checkpoint payload that grows with the backlog, or one indexed read per carried id on every fold, and 25 is roughly the point where "bounded" stops being true either way, so the honest answer is to stop compacting rather than hide the cost in a wide event. It is not sticky — the next delivery planned against 25 or fewer in-flight records compacts again.

**A permanently retried record's own history is not bounded either.** Every retry appends a `Claimed` and a `Failed` for the same outbox id, so `record(tenantId, outboxId)` — used by deduplication, by `markDelivered`'s idempotency path, and by carry-over rehydration — grows with retry count, roughly two events per attempt. With the 30 s → 30 min backoff in `document-delivery-outbox-consumer.ts` that is order 10³ events after a month. Indexed and small, but "constant" is the wrong word for it.

**A wrong checkpoint is not self-healing, and nothing detects one.** Checkpoint correctness is inductive: each one is computed from a working set folded from the previous one. A single over-advanced checkpoint would drop records forever and the next would compound it — the events are all still in the stream, but nothing reads them again. The design makes that hard rather than detectable: `upToSequence` and `carryOver` are taken from the same folded state in the same expression, so there is no arithmetic to get wrong and no condition to mis-evaluate. But there is no operator escape hatch to force a full re-fold, and no runtime assertion that a checkpoint is consistent with the records the resumed state ends up holding. If one is ever suspected, the repair is manual.

**Fresh `cf-frappe init` projects have no `idx_cf_frappe_events_document_name`.** Pre-existing, and this change leans on it harder. `src/cli/templates.ts` writes core migrations `0001`–`0006` plus two DocType index files; core `0007` only arrives when the user runs `cf-frappe migrate generate`. Meanwhile the scaffold hardcodes `documentDeliveryOutbox: true`. So a starter project runs the deduplication read, the idempotency read, the carry-over rehydration **and the checkpoint lookup** against a plan that falls back to `stream_sequence (stream=?)` — the 3349 µs column in the index table above rather than the 2.1 µs one. Any claim that per-operation reads are bounded is false in a fresh starter until `0007` is applied.
