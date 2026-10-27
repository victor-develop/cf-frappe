import { badRequest } from "../core/errors.js";
import { foldDocument } from "../core/events.js";
import type { DocTypeName, DocumentSnapshot, DomainEvent, StreamName, TenantId } from "../core/types.js";
import type { EventStore, StreamCatalog } from "../ports/event-store.js";
import type { MonotonicProjectionWriter } from "../ports/projection-store.js";
import { automationRunSnapshot, foldAutomationRun } from "./automation-run-events.js";

export const DEFAULT_PROJECTION_BACKFILL_BATCH_SIZE = 100;
export const MAX_PROJECTION_BACKFILL_BATCH_SIZE = 500;

/**
 * Framework-owned doctypes whose rows live in the projection table alongside
 * application documents: the ones committed through `DocumentStore`, which
 * writes a projection row, rather than appended through `EventStore`, which
 * does not. A backfill that should leave the projection database complete
 * covers these as well as every registered doctype — and only these, since
 * folding an append-only stream into a row would add rows the single-database
 * layout never had.
 */
export const PROJECTED_FRAMEWORK_DOCTYPES: readonly DocTypeName[] = Object.freeze([
  "__NamingSeries",
  "__UniqueValues",
  "__AutomationRuns"
]);

/**
 * The projection row a stream folds to, from events alone.
 *
 * `foldDocument` for everything but automation runs, whose row is
 * `automationRunSnapshot` of their own fold — the same derivation
 * `AutomationRunService` commits with. Kept in one place because the strong read
 * fallback and the backfill must agree with each other and with the write path,
 * and `tests/application/projection-split.test.ts` holds all three to the rows a
 * single-database commit writes.
 */
export function projectionRowFromEvents(
  tenantId: TenantId,
  doctype: DocTypeName,
  events: readonly DomainEvent[]
): DocumentSnapshot | null {
  if (doctype === "__AutomationRuns") {
    const record = foldAutomationRun(tenantId, events);
    return record === null ? null : automationRunSnapshot(record);
  }
  return foldDocument(events);
}

export interface ProjectionBackfillOptions {
  /** The event store the rows are folded from — always the primary. */
  readonly events: Pick<EventStore, "readStream">;
  readonly streams: StreamCatalog;
  /** Where the rows go: the projection database, or the primary on the way back. */
  readonly target: MonotonicProjectionWriter;
}

export interface ProjectionBackfillCommand {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  /** Resume after this stream; the `cursor` a previous call returned. */
  readonly after?: StreamName;
  readonly batchSize?: number;
}

export interface ProjectionBackfillResult {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly applied: number;
  /** The last stream this call covered; pass it back as `after`. */
  readonly cursor?: StreamName;
  readonly more: boolean;
}

/**
 * Folds a doctype's streams on the primary and writes the rows to a projection
 * store with the newest-version guard. This is the operation both directions of
 * the issue #13 switch need:
 *
 * - **Turning the split on.** The projection database starts empty. Backfill it,
 *   switch the coordinator and the Worker over, then backfill again: writes that
 *   landed between the first pass and the switch went to the primary's own
 *   table, and the second pass picks them up.
 * - **Turning it off, as the fallback.** The primary's projection table stopped
 *   being written while the split was on, and with the switch off reads by
 *   name come from it with no stream head check — so it has to be current
 *   *before* the switch. The rollback consumer (`PROJECTION_ROLLBACK_CURSOR`)
 *   does that from the channel; when the channel no longer holds every write
 *   of the split, backfill the primary's table while the split is still on,
 *   then follow the same steps.
 *
 * Both are safe against live writes for one reason: `saveNewest` never replaces
 * a row with an older one. A stream folded here a moment before a commit moves
 * it is a lower version than the row that commit (or its delivery) writes, so
 * whichever lands second the newer row stays. Plain `save`, which the rebuild
 * service uses on a target nobody else writes, would not be safe here.
 *
 * Unlike `ProjectionRebuildService` this records no run state of its own: the
 * cursor is the only state, and re-running from any cursor — or from the start —
 * rewrites the same rows.
 */
export class ProjectionBackfillService {
  constructor(private readonly options: ProjectionBackfillOptions) {}

  async advance(command: ProjectionBackfillCommand): Promise<ProjectionBackfillResult> {
    const batchSize = backfillBatchSize(command.batchSize);
    // One more than the batch, to learn whether there is more without a second
    // query. A keyset page, not the doctype's whole stream list sliced here:
    // the backfill that switches the split on runs at exactly the scale where
    // listing every stream on every batch stops fitting in an invocation.
    const page = await this.options.streams.listStreams({
      tenantId: command.tenantId,
      doctype: command.doctype,
      ...(command.after === undefined ? {} : { after: command.after }),
      limit: batchSize + 1
    });
    const batch = page.slice(0, batchSize);
    const snapshots: DocumentSnapshot[] = [];
    for (const stream of batch) {
      const snapshot = projectionRowFromEvents(command.tenantId, command.doctype, await this.options.events.readStream(stream));
      // A stream of a doctype that is never projected folds to null; so does
      // one whose events this fold does not know. Neither has a row to write.
      if (snapshot !== null) {
        snapshots.push(snapshot);
      }
    }
    await this.options.target.saveNewest(snapshots);
    return {
      tenantId: command.tenantId,
      doctype: command.doctype,
      applied: snapshots.length,
      ...(batch.length === 0 ? (command.after === undefined ? {} : { cursor: command.after }) : { cursor: batch.at(-1)! }),
      more: page.length > batch.length
    };
  }

  /** Runs {@link advance} until the doctype is covered. For tools and tests. */
  async run(command: Omit<ProjectionBackfillCommand, "after">): Promise<{ readonly applied: number }> {
    let applied = 0;
    let after: StreamName | undefined;
    for (;;) {
      const result = await this.advance({ ...command, ...(after === undefined ? {} : { after }) });
      applied += result.applied;
      if (!result.more) {
        return { applied };
      }
      after = result.cursor;
    }
  }
}

function backfillBatchSize(value: number | undefined): number {
  const size = value ?? DEFAULT_PROJECTION_BACKFILL_BATCH_SIZE;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PROJECTION_BACKFILL_BATCH_SIZE) {
    throw badRequest(`Projection backfill batchSize must be an integer between 1 and ${MAX_PROJECTION_BACKFILL_BATCH_SIZE}`);
  }
  return size;
}
