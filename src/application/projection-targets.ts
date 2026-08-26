import { FrameworkError } from "../core/errors.js";
import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../core/types.js";
import type {
  DocumentCommit,
  DocumentCommitBatchEntry,
  DocumentCommitBatchProjection,
  DocumentStore,
  ReadStreamOptions
} from "../ports/document-store.js";
import type { ProjectionStore } from "../ports/projection-store.js";
import type { DomainEvent, NewDomainEvent, StreamName } from "../core/types.js";

/**
 * Where a projection is in its life cycle.
 *
 * `building` and `caught-up` receive writes but are not read from; `active` is
 * the default read source; `retired` receives nothing. A migration therefore
 * looks like: mount the new shape as `building`, backfill it, promote it to
 * `caught-up`, compare reads against it, make it `active`, retire the old one.
 */
export type ProjectionTargetState = "building" | "caught-up" | "active" | "retired";

export interface ProjectionTarget {
  readonly name: string;
  readonly state: ProjectionTargetState;
  readonly store: ProjectionStore;
}

export interface ProjectionFollowerFailure {
  readonly target: string;
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly reason: string;
}

export interface ProjectionRouterOptions {
  readonly targets: readonly ProjectionTarget[];
  /**
   * Called when a follower write fails. The primary write has already
   * succeeded by then, so this is the only place the divergence becomes
   * visible — a router without it silently drifts.
   */
  readonly onFollowerFailure?: (failure: ProjectionFollowerFailure) => void;
}

/**
 * Fans projection writes out to every live target and routes reads to one of
 * them, so two shapes of the same projection can be maintained side by side.
 *
 * `core` and `application` never see this: it satisfies `ProjectionStore`, and
 * the read source is chosen here rather than passed down through queries.
 *
 * Only the `active` target's write is allowed to fail the caller. Followers are
 * written after it and their failures are reported, not propagated — a projection
 * that is still being built must not be able to break the write path.
 */
export class RoutedProjectionStore implements ProjectionStore {
  private readonly targets: readonly ProjectionTarget[];
  private readonly onFollowerFailure: (failure: ProjectionFollowerFailure) => void;
  private readTarget: string;

  constructor(options: ProjectionRouterOptions) {
    this.targets = assertProjectionTargets(options.targets);
    this.onFollowerFailure = options.onFollowerFailure ?? (() => undefined);
    this.readTarget = activeTarget(this.targets).name;
  }

  /** Names of every mounted target, in declaration order. */
  targetNames(): readonly string[] {
    return this.targets.map((target) => target.name);
  }

  /** The target reads currently go to. */
  readingFrom(): string {
    return this.readTarget;
  }

  /**
   * Switches reads to another mounted target without restarting. Used to compare
   * a `caught-up` projection against the `active` one before promoting it.
   */
  readFrom(name: string): void {
    const target = this.targets.find((candidate) => candidate.name === name);
    if (target === undefined) {
      throw new FrameworkError("PROJECTION_TARGET_NOT_FOUND", `Unknown projection target '${name}'`, {
        status: 404
      });
    }
    if (target.state === "retired") {
      throw new FrameworkError(
        "PROJECTION_TARGET_RETIRED",
        `Projection target '${name}' is retired and cannot serve reads`,
        { status: 409 }
      );
    }
    this.readTarget = name;
  }

  async get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null> {
    return this.reader().get(tenantId, doctype, name);
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    return this.reader().list(query);
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    await activeTarget(this.targets).store.save(snapshot);
    await this.saveFollowers([snapshot]);
  }

  /**
   * Writes snapshots to every target except the `active` one, isolating each
   * failure. Called by {@link withProjectionFollowers} after a commit has
   * already written the active projection inside its own atomic boundary.
   */
  async saveFollowers(snapshots: readonly DocumentSnapshot[]): Promise<void> {
    const followers = this.targets.filter(
      (target) => target.state !== "active" && target.state !== "retired"
    );
    for (const target of followers) {
      for (const snapshot of snapshots) {
        try {
          await target.store.save(snapshot);
        } catch (cause) {
          this.onFollowerFailure({
            target: target.name,
            tenantId: snapshot.tenantId,
            doctype: snapshot.doctype,
            name: snapshot.name,
            reason: cause instanceof Error ? cause.message : String(cause)
          });
        }
      }
    }
  }

  private reader(): ProjectionStore {
    const target = this.targets.find((candidate) => candidate.name === this.readTarget);
    if (target === undefined) {
      throw new FrameworkError(
        "PROJECTION_TARGET_NOT_FOUND",
        `Read target '${this.readTarget}' is no longer mounted`,
        { status: 500 }
      );
    }
    return target.store;
  }
}

/**
 * Feeds follower projections from the commit path.
 *
 * The active projection is written inside `commitBatch`'s atomic batch, together
 * with the events. Followers deliberately stay outside that boundary: a
 * projection being built must not be able to fail a document write, and widening
 * the transaction to cover it would do exactly that.
 */
export function withProjectionFollowers(
  store: DocumentStore,
  router: RoutedProjectionStore
): DocumentStore {
  return {
    readStream: (stream: StreamName, options?: ReadStreamOptions) => store.readStream(stream, options),
    commit: async (
      stream: StreamName,
      expectedVersion: number,
      events: readonly NewDomainEvent[],
      project: (committed: readonly DomainEvent[]) => DocumentSnapshot
    ) => {
      const commit = await store.commit(stream, expectedVersion, events, project);
      await router.saveFollowers([commit.snapshot]);
      return commit;
    },
    commitBatch: async (
      entries: readonly DocumentCommitBatchEntry[],
      project: (committed: readonly DomainEvent[]) => DocumentCommitBatchProjection
    ): Promise<DocumentCommit> => {
      // The auxiliary snapshots never reach the caller, so capture them here:
      // naming counters and unique-value reservations are projection rows too,
      // and a follower missing them is not a usable projection.
      let projected: DocumentCommitBatchProjection | undefined;
      const commit = await store.commitBatch(entries, (committed) => {
        projected = project(committed);
        return projected;
      });
      await router.saveFollowers([
        commit.snapshot,
        ...(projected?.auxiliarySnapshots ?? [])
      ]);
      return commit;
    }
  };
}

function assertProjectionTargets(targets: readonly ProjectionTarget[]): readonly ProjectionTarget[] {
  if (targets.length === 0) {
    throw new FrameworkError("PROJECTION_TARGET_INVALID", "At least one projection target is required", {
      status: 400
    });
  }
  const names = new Set<string>();
  for (const target of targets) {
    if (names.has(target.name)) {
      throw new FrameworkError(
        "PROJECTION_TARGET_DUPLICATE",
        `Projection target '${target.name}' is mounted more than once`,
        { status: 409 }
      );
    }
    names.add(target.name);
  }
  const active = targets.filter((target) => target.state === "active");
  if (active.length !== 1) {
    throw new FrameworkError(
      "PROJECTION_TARGET_INVALID",
      `Exactly one projection target must be active, found ${active.length}`,
      { status: 400 }
    );
  }
  return Object.freeze([...targets]);
}

function activeTarget(targets: readonly ProjectionTarget[]): ProjectionTarget {
  return targets.find((target) => target.state === "active")!;
}
