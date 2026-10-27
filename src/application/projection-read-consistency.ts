import { documentStream } from "../core/streams.js";
import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../core/types.js";
import { badRequest } from "../core/errors.js";
import { isAutomationRunClaimStore, type AutomationRunClaimStore } from "../ports/automation-run-claim-store.js";
import type { EventStore } from "../ports/event-store.js";
import type { MonotonicProjectionWriter, ProjectionStore } from "../ports/projection-store.js";
import type { SnapshotStore } from "../ports/snapshot-store.js";
import { DocumentFoldSnapshots } from "./document-fold-snapshots.js";
import { projectionRowFromEvents } from "./projection-backfill.js";

/**
 * Which reads must see the latest write, and how each one gets there, once
 * projections live in their own database (issue #13).
 *
 * | Read | Consistency | How |
 * | --- | --- | --- |
 * | One document by name — form load, `getDocument*`, print, workflow actions, automation targets | **strong** | {@link ConsistentProjectionStore.get}: the projection row is used only when it is at the stream head on the primary; otherwise the document is folded from the primary's events |
 * | Naming series, unique values, expected-version checks, every write's own read | **strong** | never read projections — `DocumentService` folds the event stream on the primary, in every layout |
 * | Lists, link options, search, reports, dashboards, kanban, calendar, CSV export, automation-run candidates | **eventual** | the projection database as it stands; a read-your-writes token makes it wait for the caller's own writes first |
 *
 * The middle row is why splitting is possible at all: nothing that decides a
 * write reads a projection, so a lagging projection can make a read stale but
 * cannot make a write wrong.
 */
export const PROJECTION_READ_CONSISTENCY = Object.freeze({
  documentByName: "strong",
  writeDecisions: "strong",
  lists: "eventual"
} as const);

export interface ConsistentProjectionStoreOptions {
  /** The projection database. */
  readonly projections: ProjectionStore;
  /** The primary event store — the stream head and, when needed, the fold. */
  readonly events: Pick<EventStore, "readStream" | "currentVersion">;
  /**
   * Fold snapshots on the primary, so a fallback read replays only the tail of
   * a long stream. Optional for the reason it is everywhere: a snapshot may
   * always be ignored.
   */
  readonly snapshots?: SnapshotStore;
  /** Told each time a read had to fall back to the primary. For metrics. */
  readonly onFallback?: (fallback: ProjectionReadFallback) => void;
}

export interface ProjectionReadFallback {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  /** Version in the projection database, or null when the row is missing. */
  readonly projectedVersion: number | null;
  readonly streamVersion: number;
}

/**
 * The read side of the split layout: a `ProjectionStore` over the projection
 * database that keeps by-name reads strongly consistent.
 *
 * `get` costs one indexed `MAX(sequence)` on the primary on top of the
 * projection read. That is the price of the strong row in the table above, and
 * it is a key lookup, not the JSON row — the payload, and every list, still come
 * from the projection database.
 *
 * A stream whose newest event does not move the folded version (a superseded
 * workflow transition is the one case today) always takes the fallback. That
 * costs a fold, never a wrong answer.
 */
export class ConsistentProjectionStore implements ProjectionStore, MonotonicProjectionWriter, AutomationRunClaimStore {
  private readonly folds: DocumentFoldSnapshots;

  constructor(private readonly options: ConsistentProjectionStoreOptions) {
    this.folds = new DocumentFoldSnapshots(options.events, options.snapshots);
  }

  async get(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<DocumentSnapshot | null> {
    const stream = documentStream(tenantId, doctype, name);
    const [projected, streamVersion] = await Promise.all([
      this.options.projections.get(tenantId, doctype, name),
      this.options.events.currentVersion(stream)
    ]);
    if (projected !== null && projected.version >= streamVersion) {
      return projected;
    }
    if (projected === null && streamVersion === 0) {
      return null;
    }
    this.options.onFallback?.({
      tenantId,
      doctype,
      name,
      projectedVersion: projected?.version ?? null,
      streamVersion
    });
    // Fold snapshots are keyed to `foldDocument`; a row with a fold of its own
    // is folded whole.
    return doctype === "__AutomationRuns"
      ? projectionRowFromEvents(tenantId, doctype, await this.options.events.readStream(stream))
      : this.folds.resume(stream);
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    return this.options.projections.list(query);
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    await this.options.projections.save(snapshot);
  }

  async remove(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<void> {
    await this.options.projections.remove?.(tenantId, doctype, name);
  }

  async saveNewest(snapshots: readonly DocumentSnapshot[]): Promise<void> {
    const writer = this.options.projections as Partial<MonotonicProjectionWriter>;
    if (writer.saveNewest === undefined) {
      throw new Error("The projection database store does not support newest-version writes");
    }
    await writer.saveNewest(snapshots);
  }

  async listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]> {
    if (!isAutomationRunClaimStore(this.options.projections)) {
      return [];
    }
    return this.options.projections.listAutomationRunClaimCandidates(query);
  }
}

/** "The projection must show `name` at `version` or later." */
export interface ProjectionReadRequirement {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
}

export interface ProjectionCatchUpResult {
  readonly status: "fresh" | "stale";
  /** Requirements the projection still did not meet when the wait ended. */
  readonly pending: readonly ProjectionReadRequirement[];
  readonly waitedMs: number;
}

export interface ProjectionCatchUpOptions {
  /** The projection database itself — not a store that falls back to the primary. */
  readonly projections: Pick<ProjectionStore, "get">;
  /** Longest a read waits for the caller's writes. */
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Milliseconds, monotonic enough to measure a wait. */
  readonly now?: () => number;
}

export const DEFAULT_PROJECTION_CATCH_UP_TIMEOUT_MS = 2_000;
export const DEFAULT_PROJECTION_CATCH_UP_POLL_MS = 50;
export const MAX_PROJECTION_READ_REQUIREMENTS = 50;

/**
 * The waiting half of read-your-writes: holds a read until the projection
 * database shows the caller's own writes, or until the timeout.
 *
 * Timing out does not fail the read. It reports `stale`, and the read goes
 * ahead against the projection as it stands — a list has no primary to fall
 * back to once the rows have moved, so the honest options are "wait" and "say
 * so", and this does both. By-name reads never need this; they are strong
 * already (see {@link ConsistentProjectionStore}).
 *
 * The other half — minting and checking the token a client carries between
 * the write and the read — is an HTTP concern, in `adapters/http`.
 */
export class ProjectionCatchUp {
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: ProjectionCatchUpOptions) {
    this.timeoutMs = nonNegativeInteger(options.timeoutMs ?? DEFAULT_PROJECTION_CATCH_UP_TIMEOUT_MS, "timeoutMs");
    this.pollMs = nonNegativeInteger(options.pollMs ?? DEFAULT_PROJECTION_CATCH_UP_POLL_MS, "pollMs");
    if (this.pollMs === 0 && this.timeoutMs > 0) {
      throw badRequest("Projection catch-up pollMs must be positive when timeoutMs is");
    }
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async waitFor(requirements: readonly ProjectionReadRequirement[]): Promise<ProjectionCatchUpResult> {
    if (requirements.length > MAX_PROJECTION_READ_REQUIREMENTS) {
      throw badRequest(`A read can wait for at most ${MAX_PROJECTION_READ_REQUIREMENTS} documents`);
    }
    const started = this.now();
    let pending = await this.unmet(requirements);
    while (pending.length > 0) {
      const waited = this.now() - started;
      if (waited >= this.timeoutMs) {
        return { status: "stale", pending, waitedMs: waited };
      }
      await this.sleep(Math.min(this.pollMs, this.timeoutMs - waited));
      pending = await this.unmet(pending);
    }
    return { status: "fresh", pending: [], waitedMs: this.now() - started };
  }

  private async unmet(requirements: readonly ProjectionReadRequirement[]): Promise<readonly ProjectionReadRequirement[]> {
    const rows = await Promise.all(requirements.map((requirement) =>
      this.options.projections.get(requirement.tenantId, requirement.doctype, requirement.name)
    ));
    return requirements.filter((requirement, index) => (rows[index]?.version ?? 0) < requirement.version);
  }
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw badRequest(`Projection catch-up ${label} must be a non-negative integer`);
  }
  return value;
}
