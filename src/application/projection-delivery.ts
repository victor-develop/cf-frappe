import { badRequest } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  documentDeliveryOutboxStream,
  documentStream,
  PROJECTION_DELIVERY_DEFAULT_CURSOR,
  projectionDeliveryCursorStream
} from "../core/streams.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, NewDomainEvent, TenantId } from "../core/types.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { ProjectionHandoff } from "../ports/document-store.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { MonotonicProjectionWriter } from "../ports/projection-store.js";
import { isDocumentConflictError } from "./concurrency-policy.js";
import {
  documentDeliveryOutboxDrainLimit,
  documentDeliveryOutboxErrorMessage,
  ensureDocumentDeliveryOutboxConsumerAvailable,
  isDocumentSnapshotValue,
  parseDocumentDeliveryOutboxDrainJobLimit
} from "./document-delivery-outbox-consumer-policy.js";
import {
  documentDeliveryOutboxEventType,
  documentDeliveryOutboxRecordId,
  type DocumentDeliveryOutboxEventPayload
} from "./document-delivery-outbox-events.js";
import {
  projectionDeliveryCursor,
  type ProjectionDeliveryCursor,
  type ProjectionDeliveryCursorEventPayload,
  type ProjectionDeliverySkip
} from "./projection-delivery-events.js";

/**
 * The outbox channel projection deliveries travel on. Its own stream per tenant,
 * not the notification outbox's: one record per write would otherwise share a
 * working set, and a compaction carry-over limit, with every notification.
 */
export const PROJECTION_OUTBOX_CHANNEL = "projections";

export const PROJECTION_DELIVERY_DRAIN_JOB_NAME = "cf-frappe.projection-delivery.drain";

/**
 * The cursor of the consumer that applies the projection channel to the
 * primary's own projection table, for switching the split off. While the split
 * is on nothing else writes that table, so draining the channel into it keeps it
 * as current as the projection database; once the switch is off, reads by name
 * come from it with no stream head check, and only a table that was kept current
 * answers them correctly. See `docs/projection-database.md`.
 */
export const PROJECTION_ROLLBACK_CURSOR = "primary";

export const PROJECTION_ROLLBACK_DRAIN_JOB_NAME = "cf-frappe.projection-rollback.drain";

/** How many rounds one drain call may run before returning. */
export const DEFAULT_PROJECTION_DRAIN_ROUNDS = 10;
export const MAX_PROJECTION_DRAIN_ROUNDS = 100;

export const DEFAULT_PROJECTION_LAG_MAX_AGE_SECONDS = 120;
export const DEFAULT_PROJECTION_LAG_MAX_IN_FLIGHT = 1_000;

const OUTBOX_DOCTYPE = "__DocumentDeliveryOutbox";
const PROJECTION_DELIVERY_DOCTYPE = "__ProjectionDelivery";

/**
 * Turns a commit's projection rows into one outbox record on the projection
 * channel, committed in the same batch as the events (see `ProjectionHandoff`).
 *
 * One record per commit rather than per row: a create that also advances a
 * naming counter and reserves a unique value produces three rows, and they are
 * applied together or not at all, as they were when they shared the commit.
 *
 * The record carries the rows rather than a reference to them. Folding the
 * stream again at delivery time would put a read of the primary database on
 * every delivery, which is the load this split exists to take off it; the price
 * is that the outbox payload repeats the snapshot. That is real storage on the
 * primary — see `docs/projection-database.md` — and it is the kind cold-event
 * archival (#18) exists for.
 */
export class ProjectionOutboxHandoff implements ProjectionHandoff {
  constructor(private readonly options: {
    /**
     * Applied right after the commit lands, so a document is normally listable
     * by the time the write returns. Optional, and never on the commit's
     * critical path for correctness: it is the outbox record that guarantees
     * the row arrives; this only makes it arrive sooner.
     */
    readonly eager?: MonotonicProjectionWriter;
    /** Told about an eager apply that failed. The write itself has succeeded. */
    readonly onEagerApplyError?: (error: unknown, snapshots: readonly DocumentSnapshot[]) => void;
  } = {}) {}

  handoff(commit: {
    readonly events: readonly DomainEvent[];
    readonly snapshots: readonly DocumentSnapshot[];
  }): readonly NewDomainEvent[] {
    const [primary] = commit.snapshots;
    if (primary === undefined || commit.events.length === 0) {
      return [];
    }
    const source = projectionSourceEvent(primary, commit.events);
    const outboxId = documentDeliveryOutboxRecordId(source.id, "projection");
    const payload: DocumentDeliveryOutboxEventPayload = {
      kind: "DocumentDeliveryOutboxEnqueued",
      outboxId,
      target: "projection",
      sourceEventId: source.id,
      sourceEventType: source.type,
      payloadKind: domainEventPayloadKind(source),
      doctype: primary.doctype,
      documentName: primary.name,
      actorId: source.actorId,
      payload: projectionDeliveryPayload(commit.snapshots)
    };
    return [{
      // Derived, never drawn from an id generator: this runs inside a store's
      // commit, where no generator is in reach, and one commit hands off once,
      // so its source event's id is already unique.
      id: `evt_projection_${source.id}`,
      tenantId: primary.tenantId,
      stream: documentDeliveryOutboxStream(primary.tenantId, PROJECTION_OUTBOX_CHANNEL),
      type: documentDeliveryOutboxEventType(payload),
      doctype: OUTBOX_DOCTYPE,
      documentName: outboxId,
      actorId: source.actorId,
      occurredAt: source.occurredAt,
      payload,
      metadata: {}
    }];
  }

  async afterHandoff(snapshots: readonly DocumentSnapshot[]): Promise<void> {
    if (this.options.eager === undefined) {
      return;
    }
    try {
      await this.options.eager.saveNewest(snapshots);
    } catch (error) {
      this.options.onEagerApplyError?.(error, snapshots);
    }
  }
}

/**
 * The event a projection record is named after: the newest one the commit wrote
 * to the primary snapshot's own stream. A commit writes exactly one there today;
 * the fallback to the last event of the batch only keeps a future path that
 * writes none from failing a write over a naming detail.
 */
function projectionSourceEvent(primary: DocumentSnapshot, events: readonly DomainEvent[]): DomainEvent {
  const stream = documentStream(primary.tenantId, primary.doctype, primary.name);
  return events.filter((event) => event.stream === stream).at(-1) ?? events.at(-1)!;
}

function projectionDeliveryPayload(snapshots: readonly DocumentSnapshot[]): DocumentData {
  return { snapshots: snapshots as unknown as DocumentData[] };
}

/**
 * The rows a projection record carries, validated, or a reason it has none.
 * Every row must belong to the tenant whose channel the record is on: the
 * consumer applies them to that tenant's projection without looking further.
 */
export function projectionDeliverySnapshots(tenantId: TenantId, record: DomainEvent): readonly DocumentSnapshot[] {
  const payload = record.payload as Partial<DocumentDeliveryOutboxEventPayload>;
  if (payload.kind !== "DocumentDeliveryOutboxEnqueued" || payload.target !== "projection") {
    throw badRequest(`Event '${record.id}' is not a projection delivery`);
  }
  const snapshots = payload.payload?.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw badRequest(`Projection delivery '${record.id}' carries no snapshots`);
  }
  return snapshots.map((snapshot) => {
    if (!isDocumentSnapshotValue(snapshot) || snapshot.tenantId !== tenantId || record.tenantId !== tenantId) {
      throw badRequest(`Projection delivery '${record.id}' carries an invalid snapshot`);
    }
    return snapshot;
  });
}

export interface ProjectionDeliveryConsumerOptions {
  /**
   * The primary event store: the projection channel is read from it and the
   * cursor is kept in it.
   */
  readonly events: Pick<EventStore, "readStream" | "append" | "currentVersion">;
  /** Where the rows go: the projection database, or the primary's own table on the way back. */
  readonly projections: MonotonicProjectionWriter;
  /**
   * Which cursor on the channel this consumer advances. Consumers with
   * different cursors read the same records independently. Defaults to the
   * projection database's; {@link PROJECTION_ROLLBACK_CURSOR} is the primary's.
   */
  readonly cursor?: string;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly lag?: ProjectionLagThresholds;
  /** Called once per {@link ProjectionDeliveryConsumer.checkLag} that breaches a threshold. */
  readonly onLagAlert?: (alert: ProjectionLagReport) => void | Promise<void>;
  /** Told about each record a drain read past without applying. */
  readonly onSkipped?: (skipped: ProjectionDeliverySkip & { readonly tenantId: TenantId }) => void;
}

export interface DrainProjectionDeliveriesCommand {
  readonly tenantId: TenantId;
  /** Records read and applied per round. */
  readonly limit?: number;
  readonly maxRounds?: number;
}

export interface ProjectionDeliveryDrainResult {
  readonly tenantId: TenantId;
  readonly rounds: number;
  /** Records applied by rounds whose cursor advance this drain committed. */
  readonly delivered: number;
  readonly skipped: number;
  /** The channel position this drain left the cursor at. */
  readonly cursor: number;
  /**
   * True when another drain advanced the cursor first. The rows this drain
   * applied in that round are harmless — the other drain applied the same
   * records — and it stops rather than read the range again.
   */
  readonly contended: boolean;
}

export interface ProjectionLagThresholds {
  /** Oldest undelivered record older than this is lag. Seconds. */
  readonly maxAgeSeconds?: number;
  /** More undelivered records than this is lag, whatever their age. */
  readonly maxInFlight?: number;
}

export interface ProjectionLag {
  readonly tenantId: TenantId;
  readonly measuredAt: string;
  /** Records on the channel past the cursor: written, not yet delivered. */
  readonly inFlight: number;
  /** Channel position the cursor stands at. */
  readonly cursor: number;
  /** Channel head. */
  readonly head: number;
  readonly oldestEnqueuedAt?: string;
  /** Age of the oldest undelivered record, 0 when there is none. */
  readonly ageSeconds: number;
}

export interface ProjectionLagReport extends ProjectionLag {
  readonly status: "ok" | "lagging";
  readonly breaches: readonly ("age" | "in-flight")[];
  readonly thresholds: Required<ProjectionLagThresholds>;
}

/**
 * Drains the projection channel into the projection database by cursor.
 *
 * Writers head-append to the channel (see `ProjectionOutboxHandoff`), and
 * head-append sequences are serial and gap-free: a record that becomes visible
 * later always has a higher sequence than every record visible before it. So
 * "everything at or below N is applied" is the whole of the consumer's state,
 * and it lives on a stream of its own ({@link projectionDeliveryCursorStream})
 * that only consumers compare-and-swap. A round reads the records past the
 * cursor, applies them in one `saveNewest` batch and advances the cursor with
 * one append.
 *
 * Why not claim records the way the notification outbox does: claims and
 * completions are compare-and-swap appends to the stream every write in the
 * tenant head-appends to, so under sustained writes they lose the race again
 * and again, and the drain starves exactly when the projection has the most to
 * catch up on. Here a write can never conflict with a drain, and a write costs
 * one channel event rather than three (enqueue, claim, delivered).
 *
 * Rows are applied with the newest-version guard, so a round applied twice —
 * by a drain that crashed before advancing, or by two drains racing for the
 * same range — and a concurrent eager apply or backfill all leave the newest
 * row in place. Of two racing drains one advances the cursor and the other gets
 * a conflict and stops; neither has done anything wrong.
 *
 * A round whose apply throws does not advance, so the next drain reads the same
 * records again; the error propagates, and the job's retry and the lag alert
 * take it from there. Only a record that can never apply — no valid snapshot —
 * is read past, and it is named in the cursor event and to `onSkipped`.
 */
export class ProjectionDeliveryConsumer {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly thresholds: Required<ProjectionLagThresholds>;
  private readonly cursorName: string;

  constructor(private readonly options: ProjectionDeliveryConsumerOptions) {
    this.clock = options.clock ?? systemClock;
    this.cursorName = projectionCursorName(options.cursor);
    this.ids = options.ids ?? cryptoIdGenerator;
    this.thresholds = {
      maxAgeSeconds: positiveInteger(
        options.lag?.maxAgeSeconds ?? DEFAULT_PROJECTION_LAG_MAX_AGE_SECONDS,
        "Projection lag maxAgeSeconds"
      ),
      maxInFlight: positiveInteger(
        options.lag?.maxInFlight ?? DEFAULT_PROJECTION_LAG_MAX_IN_FLIGHT,
        "Projection lag maxInFlight"
      )
    };
  }

  /**
   * Applies rounds until the channel is caught up or `maxRounds` have run.
   * Bounded on purpose: this shares the primary database with live writes, and
   * a driver that wants more simply calls again.
   */
  async drain(command: DrainProjectionDeliveriesCommand): Promise<ProjectionDeliveryDrainResult> {
    const limit = documentDeliveryOutboxDrainLimit(command.limit);
    const maxRounds = projectionDrainRounds(command.maxRounds);
    const channel = documentDeliveryOutboxStream(command.tenantId, PROJECTION_OUTBOX_CHANNEL);
    let cursor = await this.cursor(command.tenantId);
    let rounds = 0;
    let delivered = 0;
    let skipped = 0;
    while (rounds < maxRounds) {
      const records = await this.options.events.readStream(channel, { minSequence: cursor.position + 1, limit });
      rounds += 1;
      if (records.length === 0) {
        break;
      }
      const round = projectionDeliveryRound(command.tenantId, records);
      await this.options.projections.saveNewest(round.snapshots);
      const advanced = await this.advance(command.tenantId, cursor, records.at(-1)!.sequence, round);
      if (advanced === undefined) {
        return { tenantId: command.tenantId, rounds, delivered, skipped, cursor: cursor.position, contended: true };
      }
      cursor = advanced;
      delivered += round.applied;
      skipped += round.skipped.length;
      for (const skip of round.skipped) {
        this.options.onSkipped?.({ tenantId: command.tenantId, ...skip });
      }
      if (records.length < limit) {
        break;
      }
    }
    return { tenantId: command.tenantId, rounds, delivered, skipped, cursor: cursor.position, contended: false };
  }

  /**
   * Where the projection channel stands for one tenant, right now. Three point
   * reads on the primary — the cursor, the channel head and the oldest record
   * past the cursor — however far behind the consumer is.
   */
  async lag(tenantId: TenantId, now: string = this.clock.now()): Promise<ProjectionLag> {
    const channel = documentDeliveryOutboxStream(tenantId, PROJECTION_OUTBOX_CHANNEL);
    const [cursor, head] = await Promise.all([this.cursor(tenantId), this.options.events.currentVersion(channel)]);
    const [oldest] = head > cursor.position
      ? await this.options.events.readStream(channel, { minSequence: cursor.position + 1, limit: 1 })
      : [];
    return {
      tenantId,
      measuredAt: now,
      inFlight: Math.max(0, head - cursor.position),
      cursor: cursor.position,
      head,
      ...(oldest === undefined ? {} : { oldestEnqueuedAt: oldest.occurredAt }),
      ageSeconds: oldest === undefined
        ? 0
        : Math.max(0, Math.floor((Date.parse(now) - Date.parse(oldest.occurredAt)) / 1000))
    };
  }

  /**
   * {@link lag}, judged against the thresholds, with the alert raised when one
   * is breached. The alert is the caller's to route — a log line Workers Logs
   * can alert on is the default the Cloudflare wiring installs.
   */
  async checkLag(tenantId: TenantId, now: string = this.clock.now()): Promise<ProjectionLagReport> {
    const lag = await this.lag(tenantId, now);
    const breaches: ("age" | "in-flight")[] = [
      ...(lag.ageSeconds > this.thresholds.maxAgeSeconds ? ["age" as const] : []),
      ...(lag.inFlight > this.thresholds.maxInFlight ? ["in-flight" as const] : [])
    ];
    const report: ProjectionLagReport = {
      ...lag,
      status: breaches.length === 0 ? "ok" : "lagging",
      breaches,
      thresholds: this.thresholds
    };
    if (report.status === "lagging") {
      await this.options.onLagAlert?.(report);
    }
    return report;
  }

  private async cursor(tenantId: TenantId): Promise<ProjectionDeliveryCursor> {
    const [newest] = await this.options.events.readStream(
      projectionDeliveryCursorStream(tenantId, this.cursorName),
      { limit: 1 }
    );
    return projectionDeliveryCursor(newest);
  }

  /** The advanced cursor, or undefined when another drain advanced it first. */
  private async advance(
    tenantId: TenantId,
    from: ProjectionDeliveryCursor,
    toSequence: number,
    round: ProjectionDeliveryRound
  ): Promise<ProjectionDeliveryCursor | undefined> {
    const stream = projectionDeliveryCursorStream(tenantId, this.cursorName);
    const payload: ProjectionDeliveryCursorEventPayload = {
      kind: "ProjectionDeliveryCursorAdvanced",
      fromSequence: from.position,
      toSequence,
      applied: round.applied,
      skipped: round.skipped
    };
    try {
      const [saved] = await this.options.events.append(stream, from.version, [{
        id: this.ids.next("evt_"),
        tenantId,
        stream,
        type: payload.kind,
        doctype: PROJECTION_DELIVERY_DOCTYPE,
        documentName: this.cursorName,
        actorId: "system",
        occurredAt: this.clock.now(),
        payload,
        metadata: {}
      }]);
      return { position: toSequence, version: saved!.sequence };
    } catch (error) {
      if (isDocumentConflictError(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

interface ProjectionDeliveryRound {
  /** Newest row per document across the round. */
  readonly snapshots: readonly DocumentSnapshot[];
  readonly applied: number;
  readonly skipped: readonly ProjectionDeliverySkip[];
}

/**
 * The rows one page of the channel carries, newest per document.
 *
 * A busy document is written many times between drains; applying only its
 * newest row is what the version guard would leave anyway, at a fraction of the
 * statements. Events on the channel that are not projection records are read
 * past without counting either way — nothing else writes there today.
 */
function projectionDeliveryRound(tenantId: TenantId, records: readonly DomainEvent[]): ProjectionDeliveryRound {
  const newest = new Map<string, DocumentSnapshot>();
  const skipped: ProjectionDeliverySkip[] = [];
  let applied = 0;
  for (const record of records) {
    const payload = record.payload as Partial<DocumentDeliveryOutboxEventPayload>;
    if (payload.kind !== "DocumentDeliveryOutboxEnqueued") {
      continue;
    }
    let snapshots: readonly DocumentSnapshot[];
    try {
      snapshots = projectionDeliverySnapshots(tenantId, record);
    } catch (error) {
      skipped.push({ sequence: record.sequence, eventId: record.id, reason: documentDeliveryOutboxErrorMessage(error) });
      continue;
    }
    applied += 1;
    for (const snapshot of snapshots) {
      const key = `${snapshot.doctype}\u0000${snapshot.name}`;
      const current = newest.get(key);
      if (current === undefined || snapshot.version >= current.version) {
        newest.set(key, snapshot);
      }
    }
  }
  return { snapshots: [...newest.values()], applied, skipped };
}

interface ProjectionChannelDrainer {
  drain(command: DrainProjectionDeliveriesCommand): Promise<ProjectionDeliveryDrainResult>;
  checkLag(tenantId: TenantId): Promise<ProjectionLagReport>;
}

export interface ProjectionDeliveryDrainJobResources {
  readonly projectionDelivery?: ProjectionChannelDrainer;
}

export interface ProjectionRollbackDrainJobResources {
  readonly projectionRollback?: ProjectionChannelDrainer;
}

/**
 * Drains one tenant's projection channel and then checks its lag, so the cron
 * that keeps the projection database fed is also what raises the alert when it
 * falls behind.
 *
 * The lag check runs whether or not the drain succeeded. A drain that throws —
 * the projection database down, a row it refuses — is precisely when the
 * projection falls behind, so it is the last case the alert may be skipped in.
 */
export function createProjectionDeliveryDrainJob<
  TResources extends ProjectionDeliveryDrainJobResources = ProjectionDeliveryDrainJobResources
>(options: { readonly name?: string } = {}): JobDefinition<JobPayload, TResources> {
  return projectionChannelDrainJob(
    options.name ?? PROJECTION_DELIVERY_DRAIN_JOB_NAME,
    "Apply pending cf-frappe projection deliveries to the projection database",
    (resources) => resources.projectionDelivery
  );
}

/**
 * Drains one tenant's projection channel into the primary's own projection
 * table, under {@link PROJECTION_ROLLBACK_CURSOR}. Scheduled only while the
 * split is being switched off: before the switch it keeps the primary's table
 * current, and once after it picks up the last records the coordinator handed
 * off. With the switch off the channel stops growing, and this job has nothing
 * more to do. See `docs/projection-database.md`.
 */
export function createProjectionRollbackDrainJob<
  TResources extends ProjectionRollbackDrainJobResources = ProjectionRollbackDrainJobResources
>(options: { readonly name?: string } = {}): JobDefinition<JobPayload, TResources> {
  return projectionChannelDrainJob(
    options.name ?? PROJECTION_ROLLBACK_DRAIN_JOB_NAME,
    "Apply the cf-frappe projection channel to the primary's own projection table, for switching the split off",
    (resources) => resources.projectionRollback
  );
}

function projectionChannelDrainJob<TResources>(
  name: string,
  description: string,
  drainer: (resources: TResources) => ProjectionChannelDrainer | undefined
): JobDefinition<JobPayload, TResources> {
  return {
    name,
    description,
    retry: { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 120 },
    async handler({ tenantId, payload, resources }) {
      const consumer = drainer(resources);
      ensureDocumentDeliveryOutboxConsumerAvailable(consumer);
      const limit = parseDocumentDeliveryOutboxDrainJobLimit(payload.limit);
      const maxRounds = parseProjectionDrainJobRounds(payload.maxRounds);
      const tenant = tenantId ?? "default";
      let result: ProjectionDeliveryDrainResult;
      try {
        result = await consumer.drain({
          tenantId: tenant,
          ...(limit === undefined ? {} : { limit }),
          ...(maxRounds === undefined ? {} : { maxRounds })
        });
      } catch (error) {
        // The drain's error is the one that matters; a lag check that also
        // fails must not replace it.
        await consumer.checkLag(tenant).catch(() => undefined);
        throw error;
      }
      const lag = await consumer.checkLag(tenant);
      return {
        tenantId: result.tenantId,
        rounds: result.rounds,
        delivered: result.delivered,
        skipped: result.skipped,
        cursor: result.cursor,
        lag: {
          status: lag.status,
          inFlight: lag.inFlight,
          ageSeconds: lag.ageSeconds
        }
      };
    }
  };
}

export function projectionDrainRounds(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROJECTION_DRAIN_ROUNDS;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PROJECTION_DRAIN_ROUNDS) {
    throw badRequest(`Projection drain maxRounds must be an integer between 1 and ${MAX_PROJECTION_DRAIN_ROUNDS}`);
  }
  return value;
}

function parseProjectionDrainJobRounds(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw badRequest("Projection drain job maxRounds is invalid");
  }
  return projectionDrainRounds(value);
}

function projectionCursorName(value: string | undefined): string {
  const name = value ?? PROJECTION_DELIVERY_DEFAULT_CURSOR;
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) {
    throw badRequest("Projection delivery cursor must be 1-40 lowercase letters, digits or dashes, starting with a letter");
  }
  return name;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return value;
}
