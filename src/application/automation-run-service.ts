import { automationActionIdentity, automationActionsFromDomainEvent } from "../core/automation-rules.js";
import { domainEventPayloadKind, domainEventWorkflowIdentity } from "../core/domain-events.js";
import type { DomainEventWorkflowIdentity } from "../core/domain-events.js";
import { notFound } from "../core/errors.js";
import { automationRunStream } from "../core/streams.js";
import type {
  AutomationRuleDefinition,
  Actor,
  DocumentChangeContext,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  JsonValue,
  PredicateExpression,
  NewDomainEvent,
  TenantId
} from "../core/types.js";
import type { DocumentCommitBatchEntry, DocumentStore } from "../ports/document-store.js";
import { systemClock, type Clock } from "../ports/clock.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { ProjectionStore } from "../ports/projection-store.js";
import {
  isAutomationRunClaimStore,
  type AutomationRunClaimStore
} from "../ports/automation-run-claim-store.js";
import { isDocumentConflictError } from "./concurrency-policy.js";
import { requireSavedEvent } from "./document-lifecycle-events.js";
import {
  AUTOMATION_RUN_PAYLOAD_KINDS,
  automationRunEvent,
  automationRunRecordFromSnapshot,
  automationRunSnapshot,
  foldAutomationRun,
  selectedAutomationRunRecords,
  sortedAutomationRunRecords,
  type AutomationRunEventPayload,
  type AutomationRunRecord,
  type AutomationRunRetryPolicy
} from "./automation-run-events.js";
import {
  automationRunClaimLeaseSeconds,
  automationRunClaimLimit,
  automationRunFailureError,
  automationRunRetryAt,
  automationRunShouldDeadLetter,
  claimableAutomationRuns,
  ensureAutomationRunClaimed,
  normalizeAutomationRunRetryPolicy
} from "./automation-run-policy.js";

export type {
  AutomationRunEventPayload,
  AutomationRunRecord,
  AutomationRunRetryPolicy,
  AutomationRunStatus
} from "./automation-run-events.js";

const MAX_AUTOMATION_RUN_APPEND_ATTEMPTS = 5;
const AUTOMATION_RUN_LIST_PAGE_SIZE = 100;
export const DEFAULT_AUTOMATION_MAX_DEPTH = 8;
export const DEFAULT_AUTOMATION_MAX_PATH_REPEATS = 1;

export interface AutomationRunCommitPlan {
  readonly entries: readonly DocumentCommitBatchEntry[];
  readonly runIds: readonly string[];
  auxiliarySnapshots(savedEvents: readonly DomainEvent[]): readonly DocumentSnapshot[];
}

export interface AutomationRunPlannerOptions {
  readonly ids?: IdGenerator;
  readonly retry?: Partial<AutomationRunRetryPolicy>;
  readonly maxDepth?: number;
  readonly maxPathRepeats?: number;
}

export interface PlanAutomationRunsFromDomainEventCommand {
  readonly event: NewDomainEvent | DomainEvent;
  readonly change: DocumentChangeContext;
  readonly input: DocumentData;
  readonly actor: Actor;
  readonly rules: readonly AutomationRuleDefinition[] | undefined;
  readonly metadata?: DocumentData;
}

export interface AutomationRunServiceOptions extends AutomationRunPlannerOptions {
  readonly store: DocumentStore;
  readonly projections: ProjectionStore;
  readonly claims?: AutomationRunClaimStore;
  readonly clock?: Clock;
}

export interface ClaimAutomationRunsCommand {
  readonly tenantId: TenantId;
  readonly claimId?: string;
  readonly limit?: number;
  readonly now?: string;
  readonly leaseSeconds?: number;
}

export interface CompleteAutomationRunCommand {
  readonly tenantId: TenantId;
  readonly runId: string;
  readonly claimId: string;
  readonly metadata?: DocumentData;
}

export interface FailAutomationRunCommand extends CompleteAutomationRunCommand {
  readonly error: string;
  readonly retryAt?: string;
}

export class AutomationRunPlanner {
  protected readonly ids: IdGenerator;
  protected readonly retry: AutomationRunRetryPolicy;
  protected readonly maxDepth: number;
  protected readonly maxPathRepeats: number;

  constructor(options: AutomationRunPlannerOptions = {}) {
    this.ids = options.ids ?? cryptoIdGenerator;
    this.retry = normalizeAutomationRunRetryPolicy(options.retry);
    this.maxDepth = positiveInteger(options.maxDepth, DEFAULT_AUTOMATION_MAX_DEPTH, "Automation max depth");
    this.maxPathRepeats = positiveInteger(
      options.maxPathRepeats,
      DEFAULT_AUTOMATION_MAX_PATH_REPEATS,
      "Automation max path repeats"
    );
  }

  planEnqueueFromDomainEvent(command: PlanAutomationRunsFromDomainEventCommand): AutomationRunCommitPlan {
    const rules = command.rules ?? [];
    if (rules.length === 0) {
      return emptyAutomationRunCommitPlan;
    }
    const sourceEvent = committedLikeEvent(command.event);
    const actions = automationActionsFromDomainEvent({
      event: sourceEvent,
      change: command.change,
      input: command.input,
      actor: command.actor,
      rules
    });
    if (actions.length === 0) {
      return emptyAutomationRunCommitPlan;
    }
    const sourcePayloadKind = domainEventPayloadKind(sourceEvent);
    const workflowIdentity = domainEventWorkflowIdentity(sourceEvent);
    const workflowMetadata = workflowIdentityMetadata(workflowIdentity);
    const runGroups = actions.map((action) => {
      const automationPathKey = automationActionIdentity(action.ruleId, action.actionId);
      const automationDepth = sourceAutomationDepth(sourceEvent) + 1;
      const sourcePath = sourceAutomationPath(sourceEvent);
      const automationPath = Object.freeze([...sourcePath, automationPathKey]);
      const correlationId = sourceCorrelationId(sourceEvent);
      const payload: AutomationRunEventPayload = {
        kind: "AutomationRunEnqueued",
        runId: action.runId,
        sourceEventId: sourceEvent.id,
        sourceEventType: sourceEvent.type,
        sourcePayloadKind,
        sourceDoctype: sourceEvent.doctype,
        sourceDocumentName: sourceEvent.documentName,
        sourceActorId: sourceEvent.actorId,
        ...workflowIdentity,
        ruleId: action.ruleId,
        ruleName: action.ruleName,
        actionId: action.actionId,
        action: action.action,
        retry: this.retry,
        causationId: sourceEvent.id,
        correlationId,
        automationDepth,
        automationPath
      };
      const enqueued = automationRunEvent({
        id: this.ids.next("evt_"),
        tenantId: sourceEvent.tenantId,
        stream: automationRunStream(sourceEvent.tenantId, action.runId),
        actorId: sourceEvent.actorId,
        occurredAt: sourceEvent.occurredAt,
        payload,
        metadata: {
          sourceEventId: sourceEvent.id,
          causationId: sourceEvent.id,
          correlationId,
          automationDepth,
          automationPath,
          automationRuleId: action.ruleId,
          automationRuleName: action.ruleName,
          automationActionDefinitionId: action.actionId,
          ...workflowMetadata,
          ...(command.metadata ?? {})
        }
      });
      const suppressionError = automationLoopSuppressionError({
        automationDepth,
        automationPathKey,
        maxDepth: this.maxDepth,
        maxPathRepeats: this.maxPathRepeats,
        sourcePath
      });
      const events: NewDomainEvent<AutomationRunEventPayload>[] = [enqueued];
      if (suppressionError !== undefined) {
        events.push(automationRunEvent({
          id: this.ids.next("evt_"),
          tenantId: sourceEvent.tenantId,
          stream: enqueued.stream,
          actorId: "system",
          occurredAt: sourceEvent.occurredAt,
          payload: {
            kind: "AutomationRunSuppressed",
            runId: action.runId,
            error: suppressionError
          },
          metadata: {
            sourceEventId: sourceEvent.id,
            causationId: sourceEvent.id,
            correlationId,
            automationDepth,
            automationPath,
            automationRuleId: action.ruleId,
            automationActionDefinitionId: action.actionId,
            ...workflowMetadata
          }
        }));
      }
      return Object.freeze({ runId: action.runId, events: Object.freeze(events) });
    });
    return {
      entries: runGroups.map((group) => ({
        stream: group.events[0]!.stream,
        expectedVersion: 0,
        events: group.events
      })),
      runIds: runGroups.map((group) => group.runId),
      auxiliarySnapshots(savedEvents) {
        return runGroups.map((group) => {
          const saved = group.events.map((event) => requireSavedEvent(savedEvents, event.id));
          const record = foldAutomationRun(saved[0]!.tenantId, saved);
          if (record === null) {
            throw new Error("Automation run enqueue event did not fold into a run record");
          }
          return automationRunSnapshot(record);
        });
      }
    };
  }
}

function workflowIdentityMetadata(identity: DomainEventWorkflowIdentity): DocumentData {
  return {
    ...(identity.workflowName === undefined ? {} : { workflowName: identity.workflowName }),
    ...(identity.workflowAction === undefined ? {} : { workflowAction: identity.workflowAction }),
    ...(identity.workflowTransitions === undefined
      ? {}
      : { workflowTransitions: identity.workflowTransitions as unknown as JsonValue })
  };
}

export class AutomationRunService extends AutomationRunPlanner {
  private readonly store: DocumentStore;
  private readonly projections: ProjectionStore;
  private readonly claims: AutomationRunClaimStore | undefined;
  private readonly clock: Clock;

  constructor(options: AutomationRunServiceOptions) {
    super(options);
    this.store = options.store;
    this.projections = options.projections;
    this.claims = options.claims ?? (isAutomationRunClaimStore(options.projections) ? options.projections : undefined);
    this.clock = options.clock ?? systemClock;
  }

  async get(tenantId: TenantId, runId: string): Promise<AutomationRunRecord | null> {
    const snapshot = await this.projections.get(tenantId, "__AutomationRuns", runId);
    return snapshot === null ? null : automationRunRecordFromSnapshot(snapshot);
  }

  async list(tenantId: TenantId): Promise<readonly AutomationRunRecord[]> {
    const records: AutomationRunRecord[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.projections.list({
        tenantId,
        doctype: "__AutomationRuns",
        orderBy: "enqueuedAt",
        order: "asc",
        limit: AUTOMATION_RUN_LIST_PAGE_SIZE,
        offset
      });
      records.push(...page.data.map(automationRunRecordFromSnapshot));
      offset += page.data.length;
      if (offset >= page.total || page.data.length === 0) {
        return sortedAutomationRunRecords(records);
      }
    }
  }

  async claimPending(command: ClaimAutomationRunsCommand): Promise<readonly AutomationRunRecord[]> {
    const now = command.now ?? this.clock.now();
    const limit = automationRunClaimLimit(command.limit);
    const claimId = command.claimId ?? this.ids.next("claim_");
    const leaseSeconds = automationRunClaimLeaseSeconds(command.leaseSeconds);
    const candidates = await this.listClaimCandidates(command.tenantId, now, limit);
    const selected = claimableAutomationRuns(candidates, now, limit);
    const claimed: AutomationRunRecord[] = [];
    for (const record of selected) {
      const next = await this.claimOne({
        tenantId: command.tenantId,
        runId: record.id,
        claimId,
        now,
        leaseSeconds
      });
      if (next !== undefined) {
        claimed.push(next);
      }
    }
    return selectedAutomationRunRecords(claimed, selected.map((record) => record.id));
  }

  async markDelivered(command: CompleteAutomationRunCommand): Promise<AutomationRunRecord> {
    return requireAutomationRunRecord(await this.appendRunEvent(command.tenantId, command.runId, (record) => {
      const existing = requireAutomationRunRecord(record, command.runId);
      if (existing.status === "delivered") {
        return { record: existing };
      }
      ensureAutomationRunClaimed(existing, command.claimId);
      const payload: AutomationRunEventPayload = {
        kind: "AutomationRunDelivered",
        runId: command.runId,
        claimId: command.claimId
      };
      return {
        event: this.newRunEvent(existing, payload, command.metadata)
      };
    }), command.runId);
  }

  async markFailed(command: FailAutomationRunCommand): Promise<AutomationRunRecord> {
    const normalizedError = automationRunFailureError(command.error);
    return requireAutomationRunRecord(await this.appendRunEvent(command.tenantId, command.runId, (record) => {
      const existing = requireAutomationRunRecord(record, command.runId);
      ensureAutomationRunClaimed(existing, command.claimId);
      const payload: AutomationRunEventPayload = {
        kind: "AutomationRunFailed",
        runId: command.runId,
        claimId: command.claimId,
        error: normalizedError,
        retryAt: command.retryAt ?? automationRunRetryAt({
          now: this.clock.now(),
          attempts: existing.attempts,
          baseDelaySeconds: existing.retry.baseDelaySeconds,
          maxDelaySeconds: existing.retry.maxDelaySeconds
        })
      };
      return {
        event: this.newRunEvent(existing, payload, command.metadata)
      };
    }), command.runId);
  }

  async markDeadLettered(command: FailAutomationRunCommand): Promise<AutomationRunRecord> {
    const normalizedError = automationRunFailureError(command.error);
    return requireAutomationRunRecord(await this.appendRunEvent(command.tenantId, command.runId, (record) => {
      const existing = requireAutomationRunRecord(record, command.runId);
      if (existing.status === "dead") {
        return { record: existing };
      }
      ensureAutomationRunClaimed(existing, command.claimId);
      const payload: AutomationRunEventPayload = {
        kind: "AutomationRunDeadLettered",
        runId: command.runId,
        claimId: command.claimId,
        error: normalizedError
      };
      return {
        event: this.newRunEvent(existing, payload, command.metadata)
      };
    }), command.runId);
  }

  shouldDeadLetter(record: AutomationRunRecord): boolean {
    return automationRunShouldDeadLetter(record);
  }

  private async listClaimCandidates(
    tenantId: TenantId,
    now: string,
    limit: number
  ): Promise<readonly AutomationRunRecord[]> {
    if (this.claims !== undefined) {
      return sortedAutomationRunRecords(
        (await this.claims.listAutomationRunClaimCandidates({ tenantId, now, limit }))
          .map(automationRunRecordFromSnapshot)
      );
    }
    const records: AutomationRunRecord[] = [];
    let offset = 0;
    const predicate: PredicateExpression = {
      kind: "group",
      match: "any",
      predicates: [
        statusPredicate("pending"),
        statusPredicate("failed"),
        statusPredicate("claimed")
      ]
    };
    for (;;) {
      const page = await this.projections.list({
        tenantId,
        doctype: "__AutomationRuns",
        predicate,
        orderBy: "enqueuedAt",
        order: "asc",
        limit: AUTOMATION_RUN_LIST_PAGE_SIZE,
        offset
      });
      records.push(...page.data.map(automationRunRecordFromSnapshot));
      offset += page.data.length;
      if (offset >= page.total || page.data.length === 0) {
        return sortedAutomationRunRecords(records);
      }
    }
  }

  private async claimOne(command: {
    readonly tenantId: TenantId;
    readonly runId: string;
    readonly claimId: string;
    readonly now: string;
    readonly leaseSeconds: number;
  }): Promise<AutomationRunRecord | undefined> {
    return this.appendRunEvent(command.tenantId, command.runId, (record) => {
      const existing = requireAutomationRunRecord(record, command.runId);
      if (!claimableAutomationRuns([existing], command.now, 1).some((item) => item.id === existing.id)) {
        return { record: undefined };
      }
      const payload: AutomationRunEventPayload = {
        kind: "AutomationRunClaimed",
        runId: command.runId,
        claimId: command.claimId,
        claimExpiresAt: new Date(Date.parse(command.now) + command.leaseSeconds * 1000).toISOString()
      };
      return {
        event: automationRunEvent({
          id: this.ids.next("evt_"),
          tenantId: existing.tenantId,
          stream: automationRunStream(existing.tenantId, existing.id),
          actorId: "system",
          occurredAt: command.now,
          payload
        })
      };
    }, { allowMissingResult: true });
  }

  private async appendRunEvent(
    tenantId: TenantId,
    runId: string,
    plan: (
      record: AutomationRunRecord | null
    ) => {
      readonly event?: NewDomainEvent<AutomationRunEventPayload>;
      readonly record?: AutomationRunRecord | undefined;
    },
    options: { readonly allowMissingResult?: boolean } = {}
  ): Promise<AutomationRunRecord | undefined> {
    const stream = automationRunStream(tenantId, runId);
    for (let attempt = 1; attempt <= MAX_AUTOMATION_RUN_APPEND_ATTEMPTS; attempt += 1) {
      const events = await this.store.readStream(stream, { payloadKinds: AUTOMATION_RUN_PAYLOAD_KINDS });
      const record = foldAutomationRun(tenantId, events);
      const planned = plan(record);
      if (planned.event === undefined) {
        if (planned.record !== undefined) {
          return planned.record;
        }
        if (options.allowMissingResult) {
          return undefined;
        }
        return requireAutomationRunRecord(record, runId);
      }
      try {
        const commit = await this.store.commitBatch(
          [{
            stream,
            expectedVersion: record?.version ?? 0,
            events: [planned.event]
          }],
          (savedEvents) => {
            const saved = requireSavedEvent(savedEvents, planned.event!.id);
            const updated = foldAutomationRun(tenantId, [...events, saved]);
            if (updated === null) {
              throw new Error("Automation run event did not fold into a run record");
            }
            return { snapshot: automationRunSnapshot(updated) };
          }
        );
        return automationRunRecordFromSnapshot(commit.snapshot);
      } catch (error) {
        if (isDocumentConflictError(error) && attempt < MAX_AUTOMATION_RUN_APPEND_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unreachable automation run append retry state");
  }

  private newRunEvent(
    record: AutomationRunRecord,
    payload: AutomationRunEventPayload,
    metadata: DocumentData | undefined
  ): NewDomainEvent<AutomationRunEventPayload> {
    return automationRunEvent({
      id: this.ids.next("evt_"),
      tenantId: record.tenantId,
      stream: automationRunStream(record.tenantId, record.id),
      actorId: "system",
      occurredAt: this.clock.now(),
      payload,
      ...(metadata === undefined ? {} : { metadata })
    });
  }
}

const emptyAutomationRunCommitPlan: AutomationRunCommitPlan = Object.freeze({
  entries: Object.freeze([]),
  runIds: Object.freeze([]),
  auxiliarySnapshots: () => []
});

function committedLikeEvent(event: NewDomainEvent | DomainEvent): DomainEvent {
  return "sequence" in event ? event : { ...event, sequence: 0 } as DomainEvent;
}

function sourceAutomationDepth(event: DomainEvent): number {
  const value = event.metadata.automationDepth;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sourceAutomationPath(event: DomainEvent): readonly string[] {
  const value = event.metadata.automationPath;
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function sourceCorrelationId(event: DomainEvent): string {
  const value = event.metadata.correlationId;
  return typeof value === "string" && value.length > 0 ? value : event.id;
}

function automationLoopSuppressionError(options: {
  readonly automationDepth: number;
  readonly automationPathKey: string;
  readonly maxDepth: number;
  readonly maxPathRepeats: number;
  readonly sourcePath: readonly string[];
}): string | undefined {
  if (options.automationDepth > options.maxDepth) {
    return `Automation depth ${String(options.automationDepth)} exceeds limit ${String(options.maxDepth)}`;
  }
  const priorOccurrences = options.sourcePath.filter((item) => item === options.automationPathKey).length;
  if (priorOccurrences >= options.maxPathRepeats) {
    return `Automation path '${options.automationPathKey}' exceeds repeat limit ${String(options.maxPathRepeats)}`;
  }
  return undefined;
}

function statusPredicate(status: string): PredicateExpression {
  return Object.freeze({
    kind: "compare",
    left: Object.freeze({ kind: "field", scope: "after", field: "status" }),
    operator: "eq",
    right: Object.freeze({ kind: "literal", value: status })
  });
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return normalized;
}

function requireAutomationRunRecord(record: AutomationRunRecord | null | undefined, runId: string): AutomationRunRecord {
  if (record === null || record === undefined) {
    throw notFound(`Automation run '${runId}' was not found`, "AUTOMATION_RUN_NOT_FOUND");
  }
  return record;
}
