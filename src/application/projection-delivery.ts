import { badRequest } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { documentDeliveryOutboxStream, documentStream } from "../core/streams.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, NewDomainEvent, TenantId } from "../core/types.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { ProjectionHandoff } from "../ports/document-store.js";
import type { MonotonicProjectionWriter } from "../ports/projection-store.js";
import {
  documentDeliveryOutboxDrainLimit,
  documentDeliveryOutboxErrorMessage,
  documentDeliveryOutboxRetryAt,
  ensureDocumentDeliveryOutboxConsumerAvailable,
  isDocumentSnapshotValue,
  parseDocumentDeliveryOutboxDrainJobLimit
} from "./document-delivery-outbox-consumer-policy.js";
import {
  documentDeliveryOutboxEventType,
  documentDeliveryOutboxRecordId,
  type DocumentDeliveryOutboxEventPayload,
  type DocumentDeliveryOutboxRecord
} from "./document-delivery-outbox-events.js";
import type { DocumentDeliveryOutboxService } from "./document-delivery-outbox-service.js";

/**
 * The outbox channel projection deliveries travel on. Its own stream per tenant,
 * not the notification outbox's: one record per write would otherwise share a
 * working set, and a compaction carry-over limit, with every notification.
 */
export const PROJECTION_OUTBOX_CHANNEL = "projections";

export const PROJECTION_DELIVERY_DRAIN_JOB_NAME = "cf-frappe.projection-delivery.drain";

/** How many claim rounds one drain call may run before returning. */
export const DEFAULT_PROJECTION_DRAIN_ROUNDS = 10;
export const MAX_PROJECTION_DRAIN_ROUNDS = 100;

/**
 * A projection record claimed for longer than this is claimed again. Applying a
 * claim is one D1 batch, so a minute is generous for a live consumer and short
 * enough that a dead one is noticed before the lag alert's default age.
 */
export const DEFAULT_PROJECTION_CLAIM_LEASE_SECONDS = 60;

export const DEFAULT_PROJECTION_LAG_MAX_AGE_SECONDS = 120;
export const DEFAULT_PROJECTION_LAG_MAX_IN_FLIGHT = 1_000;

const OUTBOX_DOCTYPE = "__DocumentDeliveryOutbox";

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

/** The rows a projection record carries, validated, or a reason it has none. */
export function projectionDeliverySnapshots(record: DocumentDeliveryOutboxRecord): readonly DocumentSnapshot[] {
  const snapshots = record.payload.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw badRequest(`Projection delivery '${record.id}' carries no snapshots`);
  }
  return snapshots.map((snapshot) => {
    if (!isDocumentSnapshotValue(snapshot) || snapshot.tenantId !== record.tenantId) {
      throw badRequest(`Projection delivery '${record.id}' carries an invalid snapshot`);
    }
    return snapshot;
  });
}

export interface ProjectionDeliveryConsumerOptions {
  /** An outbox service on {@link PROJECTION_OUTBOX_CHANNEL}. */
  readonly outbox: Pick<
    DocumentDeliveryOutboxService,
    "claimPending" | "markDeliveredBatch" | "markFailed" | "list"
  >;
  /** The projection database's writer. */
  readonly projections: MonotonicProjectionWriter;
  readonly clock?: Clock;
  readonly retry?: {
    readonly baseDelaySeconds?: number;
    readonly maxDelaySeconds?: number;
  };
  readonly lag?: ProjectionLagThresholds;
  /** Called once per {@link ProjectionDeliveryConsumer.checkLag} that breaches a threshold. */
  readonly onLagAlert?: (alert: ProjectionLagReport) => void | Promise<void>;
}

export interface DrainProjectionDeliveriesCommand {
  readonly tenantId: TenantId;
  readonly limit?: number;
  readonly maxRounds?: number;
  readonly now?: string;
}

export interface ProjectionDeliveryDrainResult {
  readonly tenantId: TenantId;
  readonly rounds: number;
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
}

export interface ProjectionLagThresholds {
  /** Oldest in-flight record older than this is lag. Seconds. */
  readonly maxAgeSeconds?: number;
  /** More records in flight than this is lag, whatever their age. */
  readonly maxInFlight?: number;
}

export interface ProjectionLag {
  readonly tenantId: TenantId;
  readonly measuredAt: string;
  /** Records not yet delivered: pending, claimed and failed. */
  readonly inFlight: number;
  readonly pending: number;
  readonly claimed: number;
  readonly failed: number;
  readonly oldestEnqueuedAt?: string;
  /** Age of the oldest in-flight record, 0 when there is none. */
  readonly ageSeconds: number;
  readonly maxAttempts: number;
}

export interface ProjectionLagReport extends ProjectionLag {
  readonly status: "ok" | "lagging";
  readonly breaches: readonly ("age" | "in-flight")[];
  readonly thresholds: Required<ProjectionLagThresholds>;
}

const DEFAULT_RETRY_BASE_DELAY_SECONDS = 5;
const DEFAULT_RETRY_MAX_DELAY_SECONDS = 300;

/**
 * Drains the projection channel into the projection database.
 *
 * A claim is applied as a whole — one `saveNewest` batch, one
 * `markDeliveredBatch` — because a drain carries one record per write since the
 * last drain, and per-record completion made each drain that many folds of the
 * outbox tail. Rows are applied with the newest-version guard, so the order the
 * records arrive in, a redelivery, and a concurrent eager apply or backfill all
 * leave the newest row in place.
 *
 * Deliberately not the generic `DocumentDeliveryOutboxConsumer`: that one runs a
 * handler per record and completes each separately, which is the per-record
 * cost this avoids.
 */
export class ProjectionDeliveryConsumer {
  private readonly clock: Clock;
  private readonly retryBaseDelaySeconds: number;
  private readonly retryMaxDelaySeconds: number;
  private readonly thresholds: Required<ProjectionLagThresholds>;

  constructor(private readonly options: ProjectionDeliveryConsumerOptions) {
    this.clock = options.clock ?? systemClock;
    this.retryBaseDelaySeconds = positiveInteger(
      options.retry?.baseDelaySeconds ?? DEFAULT_RETRY_BASE_DELAY_SECONDS,
      "Projection delivery retry baseDelaySeconds"
    );
    this.retryMaxDelaySeconds = positiveInteger(
      options.retry?.maxDelaySeconds ?? DEFAULT_RETRY_MAX_DELAY_SECONDS,
      "Projection delivery retry maxDelaySeconds"
    );
    if (this.retryMaxDelaySeconds < this.retryBaseDelaySeconds) {
      throw badRequest("Projection delivery retry maxDelaySeconds must be greater than or equal to baseDelaySeconds");
    }
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
   * Claims and applies until the channel is empty or `maxRounds` claims have
   * run. Bounded on purpose: this shares the primary database with live writes,
   * and a driver that wants more simply calls again.
   */
  async drain(command: DrainProjectionDeliveriesCommand): Promise<ProjectionDeliveryDrainResult> {
    const limit = documentDeliveryOutboxDrainLimit(command.limit);
    const maxRounds = projectionDrainRounds(command.maxRounds);
    let rounds = 0;
    let claimed = 0;
    let delivered = 0;
    let failed = 0;
    while (rounds < maxRounds) {
      const now = command.now ?? this.clock.now();
      const batch = await this.options.outbox.claimPending({ tenantId: command.tenantId, limit, now });
      rounds += 1;
      claimed += batch.length;
      if (batch.length === 0) {
        break;
      }
      const outcome = await this.applyClaim(command.tenantId, batch, now);
      delivered += outcome.delivered;
      failed += outcome.failed;
      if (batch.length < limit) {
        break;
      }
    }
    return { tenantId: command.tenantId, rounds, claimed, delivered, failed };
  }

  /** Where the projection channel stands for one tenant, right now. */
  async lag(tenantId: TenantId, now: string = this.clock.now()): Promise<ProjectionLag> {
    const records = await this.options.outbox.list(tenantId);
    const oldest = records.reduce<string | undefined>(
      (current, record) => current === undefined || record.enqueuedAt < current ? record.enqueuedAt : current,
      undefined
    );
    return {
      tenantId,
      measuredAt: now,
      inFlight: records.length,
      pending: records.filter((record) => record.status === "pending").length,
      claimed: records.filter((record) => record.status === "claimed").length,
      failed: records.filter((record) => record.status === "failed").length,
      ...(oldest === undefined ? {} : { oldestEnqueuedAt: oldest }),
      ageSeconds: oldest === undefined ? 0 : Math.max(0, Math.floor((Date.parse(now) - Date.parse(oldest)) / 1000)),
      maxAttempts: records.reduce((max, record) => Math.max(max, record.attempts), 0)
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

  private async applyClaim(
    tenantId: TenantId,
    batch: readonly DocumentDeliveryOutboxRecord[],
    now: string
  ): Promise<{ readonly delivered: number; readonly failed: number }> {
    const valid: { readonly record: DocumentDeliveryOutboxRecord; readonly snapshots: readonly DocumentSnapshot[] }[] = [];
    let failed = 0;
    for (const record of batch) {
      try {
        valid.push({ record, snapshots: projectionDeliverySnapshots(record) });
      } catch (error) {
        // A record that cannot be read will not become readable by retrying,
        // but failing it — rather than dropping it — keeps it in flight, where
        // the lag check counts it and an operator can see it.
        await this.fail(record, now, documentDeliveryOutboxErrorMessage(error));
        failed += 1;
      }
    }
    if (valid.length === 0) {
      return { delivered: 0, failed };
    }
    try {
      await this.options.projections.saveNewest(valid.flatMap((entry) => entry.snapshots));
    } catch (error) {
      const message = documentDeliveryOutboxErrorMessage(error);
      for (const { record } of valid) {
        await this.fail(record, now, message);
      }
      return { delivered: 0, failed: failed + valid.length };
    }
    // Every record in one claim shares its claim id.
    const claimId = valid[0]!.record.claimId!;
    const delivered = await this.options.outbox.markDeliveredBatch({
      tenantId,
      claimId,
      outboxIds: valid.map((entry) => entry.record.id)
    });
    return { delivered: delivered.length, failed };
  }

  private async fail(record: DocumentDeliveryOutboxRecord, now: string, error: string): Promise<void> {
    await this.options.outbox.markFailed({
      tenantId: record.tenantId,
      outboxId: record.id,
      claimId: record.claimId!,
      error,
      retryAt: documentDeliveryOutboxRetryAt({
        now,
        attempts: record.attempts,
        baseDelaySeconds: this.retryBaseDelaySeconds,
        maxDelaySeconds: this.retryMaxDelaySeconds
      })
    });
  }
}

export interface ProjectionDeliveryDrainJobResources {
  readonly projectionDelivery?: {
    drain(command: DrainProjectionDeliveriesCommand): Promise<ProjectionDeliveryDrainResult>;
    checkLag(tenantId: TenantId): Promise<ProjectionLagReport>;
  };
}

/**
 * Drains one tenant's projection channel and then checks its lag, so the cron
 * that keeps the projection database fed is also what raises the alert when it
 * falls behind.
 */
export function createProjectionDeliveryDrainJob<
  TResources extends ProjectionDeliveryDrainJobResources = ProjectionDeliveryDrainJobResources
>(options: { readonly name?: string } = {}): JobDefinition<JobPayload, TResources> {
  return {
    name: options.name ?? PROJECTION_DELIVERY_DRAIN_JOB_NAME,
    description: "Apply pending cf-frappe projection deliveries to the projection database",
    retry: { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 120 },
    async handler({ tenantId, payload, resources }) {
      const consumer = resources.projectionDelivery;
      ensureDocumentDeliveryOutboxConsumerAvailable(consumer);
      const limit = parseDocumentDeliveryOutboxDrainJobLimit(payload.limit);
      const maxRounds = parseProjectionDrainJobRounds(payload.maxRounds);
      const tenant = tenantId ?? "default";
      const result = await consumer.drain({
        tenantId: tenant,
        ...(limit === undefined ? {} : { limit }),
        ...(maxRounds === undefined ? {} : { maxRounds })
      });
      const lag = await consumer.checkLag(tenant);
      return {
        tenantId: result.tenantId,
        rounds: result.rounds,
        claimed: result.claimed,
        delivered: result.delivered,
        failed: result.failed,
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return value;
}
