import { D1ArchivedEvents } from "../adapters/d1/archived-events.js";
import { D1EventArchive } from "../adapters/d1/event-archive.js";
import { D1EventStore } from "../adapters/d1/event-store.js";
import { D1SnapshotStore } from "../adapters/d1/snapshot-store.js";
import {
  EventArchiveService,
  type EventArchiveCutPolicy
} from "../application/event-archive-service.js";
import type { Clock } from "../ports/clock.js";
import type { ColdEventReadMetrics } from "../ports/cold-event-storage.js";
import { R2ColdEventStorage } from "./r2-cold-event-storage.js";

/**
 * Switches on the cold event archive (issue #18). Absent — the default — the
 * framework reads and writes exactly as it did before the archive existed.
 *
 * **Pass the same options to `createCloudFrappeWorker` and to
 * `createAggregateCoordinatorClass`.** Both read event streams, and a reader
 * without the archive cannot see archived events. It refuses a stream whose
 * oldest events are missing rather than folding half of it, but a reader that
 * fails is still an outage. Declaring the options once and importing them in
 * both places is the way to keep them equal.
 *
 * Turning it on changes reads only; nothing is archived until something calls
 * `services.eventArchive.archivePass()` — typically a scheduled job. Turning it
 * off again requires `restorePass()` to have brought every stream back first.
 */
export interface CloudFrappeEventArchiveOptions<TEnv = unknown> {
  /** The R2 bucket that holds archived segments. Use a dedicated bucket. */
  readonly bucket: (env: TEnv) => R2Bucket;
  /** Archived events cached per isolate. See `D1ArchivedEventsOptions.cacheEvents`. */
  readonly cacheEvents?: number;
  /**
   * Called after every read that needed archived segments, with how many and how
   * long it took — the way to see what archiving costs the paths that still
   * reach cold storage (timeline, `cancel`, `amend`, rebuilds).
   */
  readonly onColdRead?: (metrics: ColdEventReadMetrics, env: TEnv) => void;
  /** Which streams may be cut, and where. Defaults to `DEFAULT_EVENT_ARCHIVE_CUT_POLICIES`. */
  readonly policies?: readonly EventArchiveCutPolicy[];
  readonly keepHotEvents?: number;
  readonly minSegmentEvents?: number;
  readonly maxSegmentEvents?: number;
  readonly clock?: Clock;
}

export interface CloudFrappeEventArchiveRuntime {
  /** The read side, to hand to every `D1EventStore` and `D1DocumentStore` of the isolate. */
  readonly archived: D1ArchivedEvents;
  readonly service: EventArchiveService;
}

/**
 * Builds the archive's read side and service for one environment. One per
 * isolate, so the stores built from it share a segment cache.
 */
export function createCloudFrappeEventArchiveRuntime<TEnv extends { readonly DB: D1Database }>(
  env: TEnv,
  options: CloudFrappeEventArchiveOptions<TEnv>
): CloudFrappeEventArchiveRuntime {
  const storage = new R2ColdEventStorage(options.bucket(env));
  const onColdRead = options.onColdRead;
  const archived = new D1ArchivedEvents(env.DB, {
    storage,
    ...(options.cacheEvents === undefined ? {} : { cacheEvents: options.cacheEvents }),
    ...(onColdRead === undefined ? {} : { observer: (metrics: ColdEventReadMetrics) => onColdRead(metrics, env) })
  });
  const service = new EventArchiveService({
    events: new D1EventStore(env.DB, { archive: archived }),
    archive: new D1EventArchive(env.DB, { storage, ...(options.clock === undefined ? {} : { clock: options.clock }) }),
    snapshots: new D1SnapshotStore(env.DB, options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.policies === undefined ? {} : { policies: options.policies }),
    ...(options.keepHotEvents === undefined ? {} : { keepHotEvents: options.keepHotEvents }),
    ...(options.minSegmentEvents === undefined ? {} : { minSegmentEvents: options.minSegmentEvents }),
    ...(options.maxSegmentEvents === undefined ? {} : { maxSegmentEvents: options.maxSegmentEvents })
  });
  return { archived, service };
}
