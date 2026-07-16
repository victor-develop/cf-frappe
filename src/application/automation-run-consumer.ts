import { badRequest } from "../core/errors.js";
import { documentStream } from "../core/streams.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type DocumentData, type DocumentSnapshot, type JsonValue, type TenantId } from "../core/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { DocumentStore } from "../ports/document-store.js";
import type { ProjectionStore } from "../ports/projection-store.js";
import type { DocumentCommandExecutor } from "./document-service.js";
import {
  automationRunClaimLimit,
  automationRunRetryAt,
  ensureAutomationRunServiceAvailable
} from "./automation-run-policy.js";
import type { AutomationRunRecord } from "./automation-run-events.js";

export const AUTOMATION_RUN_DRAIN_JOB_NAME = "cf-frappe.automation-runs.drain";

export interface AutomationRunConsumerRuns {
  claimPending(command: {
    readonly tenantId: TenantId;
    readonly claimId?: string;
    readonly limit?: number;
    readonly now?: string;
    readonly leaseSeconds?: number;
  }): Promise<readonly AutomationRunRecord[]>;
  markDelivered(command: {
    readonly tenantId: TenantId;
    readonly runId: string;
    readonly claimId: string;
    readonly metadata?: DocumentData;
  }): Promise<AutomationRunRecord>;
  markFailed(command: {
    readonly tenantId: TenantId;
    readonly runId: string;
    readonly claimId: string;
    readonly error: string;
    readonly retryAt?: string;
    readonly metadata?: DocumentData;
  }): Promise<AutomationRunRecord>;
  markDeadLettered(command: {
    readonly tenantId: TenantId;
    readonly runId: string;
    readonly claimId: string;
    readonly error: string;
    readonly metadata?: DocumentData;
  }): Promise<AutomationRunRecord>;
  shouldDeadLetter(record: AutomationRunRecord): boolean;
}

export type AutomationRunActorResolver = (
  record: AutomationRunRecord
) => Actor | Promise<Actor>;

export interface AutomationRunConsumerOptions {
  readonly runs: AutomationRunConsumerRuns;
  readonly documents: Pick<DocumentCommandExecutor, "update">;
  readonly events: Pick<DocumentStore, "readStream">;
  readonly projections: ProjectionStore;
  readonly actor?: Actor | AutomationRunActorResolver;
  readonly clock?: Clock;
}

export interface DrainAutomationRunsCommand {
  readonly tenantId: TenantId;
  readonly claimId?: string;
  readonly limit?: number;
  readonly now?: string;
  readonly leaseSeconds?: number;
}

export interface AutomationRunDeliveryOutcome {
  readonly runId: string;
  readonly status: "delivered" | "failed" | "dead";
  readonly attempts: number;
  readonly error?: string;
  readonly retryAt?: string;
}

export interface AutomationRunDrainResult {
  readonly tenantId: TenantId;
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly dead: number;
  readonly outcomes: readonly AutomationRunDeliveryOutcome[];
}

export interface AutomationRunDrainJobResources {
  readonly automationRunConsumer?: {
    drain(command: DrainAutomationRunsCommand): Promise<AutomationRunDrainResult>;
  };
}

export type AutomationRunDrainJobPayload = DocumentData & {
  readonly limit?: number;
  readonly claimId?: string;
  readonly leaseSeconds?: number;
};

export interface AutomationRunDrainJobOptions {
  readonly name?: string;
}

export class AutomationRunConsumer {
  private readonly runs: AutomationRunConsumerRuns;
  private readonly documents: Pick<DocumentCommandExecutor, "update">;
  private readonly events: Pick<DocumentStore, "readStream">;
  private readonly projections: ProjectionStore;
  private readonly actor: Actor | AutomationRunActorResolver;
  private readonly clock: Clock;

  constructor(options: AutomationRunConsumerOptions) {
    this.runs = options.runs;
    this.documents = options.documents;
    this.events = options.events;
    this.projections = options.projections;
    this.actor = options.actor ?? defaultAutomationActor;
    this.clock = options.clock ?? systemClock;
  }

  async drain(command: DrainAutomationRunsCommand): Promise<AutomationRunDrainResult> {
    const now = command.now ?? this.clock.now();
    const claimed = await this.runs.claimPending({
      tenantId: command.tenantId,
      ...(command.claimId === undefined ? {} : { claimId: command.claimId }),
      limit: automationRunClaimLimit(command.limit),
      now,
      ...(command.leaseSeconds === undefined ? {} : { leaseSeconds: command.leaseSeconds })
    });
    const outcomes: AutomationRunDeliveryOutcome[] = [];
    for (const record of claimed) {
      outcomes.push(await this.deliver(record, now));
    }
    return {
      tenantId: command.tenantId,
      claimed: claimed.length,
      delivered: outcomes.filter((outcome) => outcome.status === "delivered").length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      dead: outcomes.filter((outcome) => outcome.status === "dead").length,
      outcomes
    };
  }

  private async deliver(record: AutomationRunRecord, now: string): Promise<AutomationRunDeliveryOutcome> {
    const claimId = automationRunRecordClaimId(record);
    try {
      await this.deliverUpdateDocument(record);
      const delivered = await this.runs.markDelivered({
        tenantId: record.tenantId,
        runId: record.id,
        claimId,
        metadata: {
          sourceEventId: record.sourceEventId,
          automationRuleName: record.ruleName,
          automationActionId: record.id
        }
      });
      return {
        runId: delivered.id,
        status: "delivered",
        attempts: delivered.attempts
      };
    } catch (error) {
      return this.fail(record, claimId, now, automationRunErrorMessage(error));
    }
  }

  private async deliverUpdateDocument(record: AutomationRunRecord): Promise<void> {
    if (await this.hasAppliedAction(record)) {
      return;
    }
    const target = await this.projections.get(
      record.tenantId,
      record.action.target.doctype,
      record.action.target.name
    );
    if (target === null || target.docstatus === "deleted") {
      throw new Error(`Automation target ${record.action.target.doctype}/${record.action.target.name} was not found`);
    }
    if (!automationPatchChangesDocument(target, record.action.patch)) {
      return;
    }
    const actor = await automationActor(this.actor, record);
    try {
      await this.documents.update({
        actor,
        tenantId: record.tenantId,
        doctype: record.action.target.doctype,
        name: record.action.target.name,
        patch: record.action.patch,
        expectedVersion: target.version,
        metadata: {
          automationActionId: record.id,
          automationRunId: record.id,
          automationRuleName: record.ruleName,
          sourceEventId: record.sourceEventId,
          sourceDoctype: record.sourceDoctype,
          sourceDocumentName: record.sourceDocumentName
        }
      });
    } catch (error) {
      if (await this.hasAppliedAction(record)) {
        return;
      }
      throw error;
    }
  }

  private async hasAppliedAction(record: AutomationRunRecord): Promise<boolean> {
    const events = await this.events.readStream(documentStream(
      record.tenantId,
      record.action.target.doctype,
      record.action.target.name
    ));
    return events.some((event) => event.metadata.automationActionId === record.id);
  }

  private async fail(
    record: AutomationRunRecord,
    claimId: string,
    now: string,
    error: string
  ): Promise<AutomationRunDeliveryOutcome> {
    if (this.runs.shouldDeadLetter(record)) {
      const dead = await this.runs.markDeadLettered({
        tenantId: record.tenantId,
        runId: record.id,
        claimId,
        error,
        metadata: {
          sourceEventId: record.sourceEventId,
          automationRuleName: record.ruleName,
          automationActionId: record.id
        }
      });
      return {
        runId: dead.id,
        status: "dead",
        attempts: dead.attempts,
        error
      };
    }
    const retryAt = automationRunRetryAt({
      now,
      attempts: record.attempts,
      baseDelaySeconds: record.retry.baseDelaySeconds,
      maxDelaySeconds: record.retry.maxDelaySeconds
    });
    const failed = await this.runs.markFailed({
      tenantId: record.tenantId,
      runId: record.id,
      claimId,
      error,
      retryAt,
      metadata: {
        sourceEventId: record.sourceEventId,
        automationRuleName: record.ruleName,
        automationActionId: record.id
      }
    });
    return {
      runId: failed.id,
      status: "failed",
      attempts: failed.attempts,
      error,
      retryAt
    };
  }
}

export function createAutomationRunDrainJob<
  TResources extends AutomationRunDrainJobResources = AutomationRunDrainJobResources
>(options: AutomationRunDrainJobOptions = {}) {
  const name = options.name ?? AUTOMATION_RUN_DRAIN_JOB_NAME;
  return {
    name,
    description: "Drain claimed cf-frappe automation runs",
    retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
    async handler({ tenantId, payload, resources }: {
      readonly tenantId?: string;
      readonly payload: AutomationRunDrainJobPayload;
      readonly resources: TResources;
    }): Promise<DocumentData> {
      const consumer = resources.automationRunConsumer;
      ensureAutomationRunServiceAvailable(consumer);
      const limit = parseAutomationRunDrainJobLimit(payload.limit);
      const claimId = parseAutomationRunDrainJobClaimId(payload.claimId);
      const leaseSeconds = parseAutomationRunDrainJobLeaseSeconds(payload.leaseSeconds);
      const result = await consumer.drain({
        tenantId: tenantId ?? "default",
        ...(limit === undefined ? {} : { limit }),
        ...(claimId === undefined ? {} : { claimId }),
        ...(leaseSeconds === undefined ? {} : { leaseSeconds })
      });
      return automationRunDrainResultJson(result);
    }
  };
}

export function automationRunDrainResultJson(result: AutomationRunDrainResult): DocumentData {
  return {
    tenantId: result.tenantId,
    claimed: result.claimed,
    delivered: result.delivered,
    failed: result.failed,
    dead: result.dead,
    outcomes: result.outcomes.map((outcome) => ({
      runId: outcome.runId,
      status: outcome.status,
      attempts: outcome.attempts,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
      ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt })
    }))
  };
}

export function automationPatchChangesDocument(
  document: DocumentSnapshot,
  patch: DocumentData
): boolean {
  return Object.entries(patch).some(([field, value]) => !jsonEqual(document.data[field], value));
}

function automationRunRecordClaimId(record: AutomationRunRecord): string {
  if (record.claimId === undefined || record.claimId.trim().length === 0) {
    throw badRequest(`Automation run '${record.id}' is not claimed`);
  }
  return record.claimId;
}

function automationRunErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseAutomationRunDrainJobLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw badRequest("Automation run drain job limit is invalid");
  }
  return automationRunClaimLimit(value);
}

function parseAutomationRunDrainJobClaimId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Automation run drain job claimId is invalid");
  }
  return value;
}

function parseAutomationRunDrainJobLeaseSeconds(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw badRequest("Automation run drain job leaseSeconds is invalid");
  }
  return value;
}

async function automationActor(
  actor: Actor | AutomationRunActorResolver,
  record: AutomationRunRecord
): Promise<Actor> {
  return typeof actor === "function" ? actor(record) : actor;
}

function jsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  const leftObject = left as Record<string, JsonValue>;
  const rightObject = right as Record<string, JsonValue>;
  return leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(leftObject[key], rightObject[key]));
}

const defaultAutomationActor: Actor = Object.freeze({
  id: "__automation__",
  roles: Object.freeze([SYSTEM_MANAGER_ROLE])
});
