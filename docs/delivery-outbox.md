# Document Delivery Outbox

How the outbox stays bounded as delivery history grows, and what that costs.

## The problem

The outbox is one event stream per tenant, `<tenant>:__DocumentDeliveryOutbox:deliveries`, and its state is folded on **every** outbox operation — enqueue, claim, fail, deliver. Delivered records used to stay in that folded state, so the working set grew with every delivery the tenant had ever made, and each record carries its `payload`: the full source event plus the document snapshot.

That is a slow leak with no ceiling, and a Worker isolate has 128 MB. Issue #28.

### What this bounds, and what it does not

**Be precise about which cost moved**, because only one of the two did.

| | Before | After |
| --- | --- | --- |
| Working-set size, and the heap its payloads hold | grows with delivery history | bounded by in-flight work |
| Events read and folded per operation | grows with delivery history | **unchanged** |

`state()` still calls `readStream` on the whole outbox stream and folds all of it; dropping delivered records from the resulting Map does not make the read shorter. Measured with a counting store, one enqueue + claim + deliver per round, nothing left in flight at the end of each:

| Round | Outbox events read that round |
| --- | --- |
| 10 | 84 |
| 20 | 174 |
| 30 | 264 |
| 40 | 354 |

Linear, and identical to before this change. What did halve those figures was the earlier fold-forward commit, which stopped re-reading the stream after an append.

So the per-operation read is still O(delivery history). Fixing that needs a starting point for an incremental read that survives an isolate — a `SnapshotStore` (issue #17), or a compaction checkpoint appended to the stream itself. Neither is here, and `ReadStreamOptions.minSequence` exists but is unused by the outbox. **Issue #28 is only half closed by this change.**

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

## Not done

`list` is bounded by in-flight work, which is the right bound for a working set — but a tenant with a permanently failing target accumulates failed records in it, and those never leave. That backlog is visible (`status: "failed"`), so it is an operational signal rather than a silent leak, but nothing currently prunes or caps it.
