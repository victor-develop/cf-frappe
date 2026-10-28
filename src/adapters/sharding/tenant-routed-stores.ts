import { FrameworkError } from "../../core/errors.js";
import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  DomainEvent,
  ListDocumentsQuery,
  ListDocumentsResult,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type { AutomationRunClaimStore } from "../../ports/automation-run-claim-store.js";
import type {
  DocumentCommit,
  DocumentCommitBatchEntry,
  DocumentCommitBatchProjection,
  DocumentStore,
  ReadStreamOptions
} from "../../ports/document-store.js";
import type {
  EventAppendBatchEntry,
  EventBatchStore,
  EventStore,
  StreamCatalog,
  StreamCatalogQuery
} from "../../ports/event-store.js";
import type {
  MonotonicProjectionWriter,
  ProjectionDocumentRef,
  ProjectionStore,
  ProjectionVersionReader
} from "../../ports/projection-store.js";
import type { FoldSnapshot, FoldSnapshotKey, SnapshotStore } from "../../ports/snapshot-store.js";
import { tenantOfStream, writeWithFenceRetry, type TenantShardRouter } from "./tenant-shard-router.js";

/** Everything the framework writes events through, on one shard. `D1EventStore` is one. */
export type ShardEventStore = EventStore & EventBatchStore & StreamCatalog & AuditEventStore;

/** A shard's document store, with the extra reads `D1DocumentStore` offers. */
export type ShardDocumentStore = DocumentStore & AuditEventStore & Pick<EventStore, "currentVersion">;

/**
 * A shard's projection table. `D1ProjectionStore` implements every part; the
 * split layout's `ConsistentProjectionStore` implements all but `versions`,
 * which only the read-your-writes wait asks of the raw table.
 */
export type ShardProjectionStore = ProjectionStore &
  MonotonicProjectionWriter &
  AutomationRunClaimStore &
  Partial<ProjectionVersionReader>;

/** Decides whether a write failed because its tenant is fenced on that shard. */
export type TenantFenceCheck = (error: unknown) => boolean;

/**
 * Routes every `EventStore` call to the shard of the tenant it names.
 *
 * Reads go where the directory says the tenant lives. Writes go there too, and
 * when the shard's fence refuses them — the tenant is mid-move or has moved —
 * they are retried against the directory's new answer (`writeWithFenceRetry`).
 * A batch must stay inside one tenant: D1 batches are atomic only within one
 * database, and a batch spanning tenants could span databases.
 */
export class TenantRoutedEventStore<S> implements ShardEventStore {
  constructor(
    private readonly router: TenantShardRouter<S>,
    private readonly select: (shard: S) => ShardEventStore,
    private readonly isFenced: TenantFenceCheck
  ) {}

  async append(stream: StreamName, expectedVersion: number, events: readonly NewDomainEvent[]): Promise<readonly DomainEvent[]> {
    return writeWithFenceRetry(this.router, tenantOfStream(stream), this.isFenced, (shard) =>
      this.select(shard).append(stream, expectedVersion, events)
    );
  }

  async appendBatch(entries: readonly EventAppendBatchEntry[]): Promise<readonly DomainEvent[]> {
    const tenantId = singleTenant(entries.map((entry) => entry.stream));
    if (tenantId === undefined) {
      return [];
    }
    return writeWithFenceRetry(this.router, tenantId, this.isFenced, (shard) => this.select(shard).appendBatch(entries));
  }

  async readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    return this.select(await this.router.forRead(tenantOfStream(stream))).readStream(stream, options);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.select(await this.router.forRead(tenantOfStream(stream))).currentVersion(stream);
  }

  async listStreams(query: StreamCatalogQuery): Promise<readonly StreamName[]> {
    return this.select(await this.router.forRead(query.tenantId)).listStreams(query);
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    return this.select(await this.router.forRead(query.tenantId)).searchEvents(query);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return this.select(await this.router.forRead(query.tenantId)).readDocumentEvents(query);
  }
}

/**
 * Routes `DocumentStore` commits — events and their projection rows, or their
 * projection handoff, in one batch — to the tenant's shard. The per-shard store
 * decides inline rows versus handoff, exactly as it does unsharded.
 */
export class TenantRoutedDocumentStore<S> implements ShardDocumentStore {
  constructor(
    private readonly router: TenantShardRouter<S>,
    private readonly select: (shard: S) => ShardDocumentStore,
    private readonly isFenced: TenantFenceCheck
  ) {}

  async commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit> {
    return writeWithFenceRetry(this.router, tenantOfStream(stream), this.isFenced, (shard) =>
      this.select(shard).commit(stream, expectedVersion, events, project)
    );
  }

  async commitBatch(
    entries: readonly DocumentCommitBatchEntry[],
    project: (events: readonly DomainEvent[]) => DocumentCommitBatchProjection
  ): Promise<DocumentCommit> {
    const tenantId = singleTenant(entries.map((entry) => entry.stream));
    if (tenantId === undefined) {
      // Let the shard store refuse or accept an empty commit exactly as it
      // would unsharded.
      return this.select(this.router.shard(this.router.home)).commitBatch(entries, project);
    }
    return writeWithFenceRetry(this.router, tenantId, this.isFenced, (shard) =>
      this.select(shard).commitBatch(entries, project)
    );
  }

  async readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    return this.select(await this.router.forRead(tenantOfStream(stream))).readStream(stream, options);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.select(await this.router.forRead(tenantOfStream(stream))).currentVersion(stream);
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    return this.select(await this.router.forRead(query.tenantId)).searchEvents(query);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return this.select(await this.router.forRead(query.tenantId)).readDocumentEvents(query);
  }
}

/**
 * Routes projection reads and writes to the tenant's shard.
 *
 * Projection writes are routed like reads — to where the tenant lives, without
 * provisioning it — because they always follow an event write that already
 * placed the tenant, and they are not fenced: only events are the truth a move
 * must not lose. A projection row written to a shard the tenant just left lands
 * in a table nobody reads any more; the target's table is rebuilt from events.
 */
export class TenantRoutedProjectionStore<S> implements ShardProjectionStore, ProjectionVersionReader {
  constructor(
    private readonly router: TenantShardRouter<S>,
    private readonly select: (shard: S) => ShardProjectionStore
  ) {}

  async get(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<DocumentSnapshot | null> {
    return (await this.store(tenantId)).get(tenantId, doctype, name);
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    await (await this.store(snapshot.tenantId)).save(snapshot);
  }

  async remove(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<void> {
    await (await this.store(tenantId)).remove?.(tenantId, doctype, name);
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    return (await this.store(query.tenantId)).list(query);
  }

  async saveNewest(snapshots: readonly DocumentSnapshot[]): Promise<void> {
    const byTenant = new Map<TenantId, DocumentSnapshot[]>();
    for (const snapshot of snapshots) {
      const group = byTenant.get(snapshot.tenantId) ?? [];
      group.push(snapshot);
      byTenant.set(snapshot.tenantId, group);
    }
    for (const [tenantId, group] of byTenant) {
      await (await this.store(tenantId)).saveNewest(group);
    }
  }

  async versions(tenantId: TenantId, refs: readonly ProjectionDocumentRef[]): Promise<readonly (number | null)[]> {
    const store = await this.store(tenantId);
    if (store.versions === undefined) {
      throw new FrameworkError("TENANT_SHARD_INVALID", "This shard's projection store cannot report row versions", {
        status: 500
      });
    }
    return store.versions(tenantId, refs);
  }

  async listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]> {
    return (await this.store(query.tenantId)).listAutomationRunClaimCandidates(query);
  }

  private async store(tenantId: TenantId): Promise<ShardProjectionStore> {
    return this.select(await this.router.forRead(tenantId));
  }
}

/**
 * Routes fold snapshots to the shard of the stream they fold. Snapshots are
 * never copied by a move: a target shard simply starts cold, which issue #17's
 * rule makes harmless — a snapshot may always be ignored.
 */
export class TenantRoutedSnapshotStore<S> implements SnapshotStore {
  constructor(
    private readonly router: TenantShardRouter<S>,
    private readonly select: (shard: S) => SnapshotStore
  ) {}

  async read<State>(key: FoldSnapshotKey): Promise<FoldSnapshot<State> | null> {
    return this.select(await this.router.forRead(tenantOfStream(key.stream))).read<State>(key);
  }

  async write<State>(snapshot: FoldSnapshot<State>): Promise<void> {
    await this.select(await this.router.forRead(tenantOfStream(snapshot.stream))).write(snapshot);
  }
}

/** The one tenant every stream belongs to, or a refusal if they span tenants. */
function singleTenant(streams: readonly StreamName[]): TenantId | undefined {
  const tenants = new Set(streams.map(tenantOfStream));
  if (tenants.size > 1) {
    throw new FrameworkError(
      "TENANT_SHARD_INVALID",
      `One atomic write cannot span tenants (${[...tenants].join(", ")}): they may live in different databases`,
      { status: 400 }
    );
  }
  return tenants.values().next().value;
}
