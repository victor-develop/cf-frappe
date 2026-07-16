import { domainEventPayloadKind } from "../core/domain-events.js";
import type { ResolvedAutomationActionDefinition } from "../core/automation-rules.js";
import type {
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  JsonValue,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../core/types.js";

export type AutomationRunStatus = "pending" | "claimed" | "delivered" | "failed" | "dead";

export interface AutomationRunRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
}

export type AutomationRunEventPayload =
  | {
      readonly kind: "AutomationRunEnqueued";
      readonly runId: string;
      readonly sourceEventId: string;
      readonly sourceEventType: string;
      readonly sourcePayloadKind: string;
      readonly sourceDoctype: string;
      readonly sourceDocumentName: string;
      readonly sourceActorId: string;
      readonly ruleName: string;
      readonly actionIndex: number;
      readonly action: ResolvedAutomationActionDefinition;
      readonly retry: AutomationRunRetryPolicy;
    }
  | {
      readonly kind: "AutomationRunClaimed";
      readonly runId: string;
      readonly claimId: string;
      readonly claimExpiresAt: string;
    }
  | {
      readonly kind: "AutomationRunDelivered";
      readonly runId: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "AutomationRunFailed";
      readonly runId: string;
      readonly claimId: string;
      readonly error: string;
      readonly retryAt: string;
    }
  | {
      readonly kind: "AutomationRunDeadLettered";
      readonly runId: string;
      readonly claimId: string;
      readonly error: string;
    };

export type AutomationRunPayloadKind = AutomationRunEventPayload["kind"];

export const AUTOMATION_RUN_PAYLOAD_KINDS = Object.freeze([
  "AutomationRunEnqueued",
  "AutomationRunClaimed",
  "AutomationRunDelivered",
  "AutomationRunFailed",
  "AutomationRunDeadLettered"
] as const satisfies readonly AutomationRunPayloadKind[]);

const AUTOMATION_RUN_PAYLOAD_KIND_SET = new Set<string>(AUTOMATION_RUN_PAYLOAD_KINDS);

export interface AutomationRunRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly sourcePayloadKind: string;
  readonly sourceDoctype: string;
  readonly sourceDocumentName: string;
  readonly sourceActorId: string;
  readonly ruleName: string;
  readonly actionIndex: number;
  readonly action: ResolvedAutomationActionDefinition;
  readonly retry: AutomationRunRetryPolicy;
  readonly status: AutomationRunStatus;
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly claimedAt?: string;
  readonly claimId?: string;
  readonly claimExpiresAt?: string;
  readonly deliveredAt?: string;
  readonly failedAt?: string;
  readonly error?: string;
  readonly retryAt?: string;
  readonly deadLetteredAt?: string;
  readonly version: number;
}

export function automationRunEventType(payload: AutomationRunEventPayload): AutomationRunPayloadKind {
  return payload.kind;
}

export function isAutomationRunPayloadKind(kind: string): kind is AutomationRunPayloadKind {
  return AUTOMATION_RUN_PAYLOAD_KIND_SET.has(kind);
}

export function isAutomationRunEvent(event: DomainEvent): event is DomainEvent<AutomationRunEventPayload> {
  return isAutomationRunPayloadKind(domainEventPayloadKind(event));
}

export function automationRunEvent<TPayload extends AutomationRunEventPayload>(options: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: automationRunEventType(options.payload),
    doctype: "__AutomationRuns",
    documentName: options.payload.runId,
    actorId: options.actorId,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function foldAutomationRun(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): AutomationRunRecord | null {
  let record: AutomationRunRecord | null = null;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!isAutomationRunEvent(event)) {
      continue;
    }
    if (event.payload.kind === "AutomationRunEnqueued") {
      record = {
        id: event.payload.runId,
        tenantId,
        sourceEventId: event.payload.sourceEventId,
        sourceEventType: event.payload.sourceEventType,
        sourcePayloadKind: event.payload.sourcePayloadKind,
        sourceDoctype: event.payload.sourceDoctype,
        sourceDocumentName: event.payload.sourceDocumentName,
        sourceActorId: event.payload.sourceActorId,
        ruleName: event.payload.ruleName,
        actionIndex: event.payload.actionIndex,
        action: event.payload.action,
        retry: event.payload.retry,
        status: "pending",
        attempts: 0,
        enqueuedAt: event.occurredAt,
        version: event.sequence
      };
      continue;
    }
    if (record === null) {
      continue;
    }
    record = applyAutomationRunEvent(record, event);
  }
  return record;
}

export function automationRunSnapshot(record: AutomationRunRecord): DocumentSnapshot {
  return {
    tenantId: record.tenantId,
    doctype: "__AutomationRuns",
    name: record.id,
    version: record.version,
    docstatus: record.status === "dead" ? "cancelled" : record.status === "delivered" ? "submitted" : "draft",
    data: automationRunData(record),
    createdAt: record.enqueuedAt,
    updatedAt: record.deliveredAt ?? record.deadLetteredAt ?? record.failedAt ?? record.claimedAt ?? record.enqueuedAt
  };
}

export function automationRunRecordFromSnapshot(snapshot: DocumentSnapshot): AutomationRunRecord {
  const data = snapshot.data as Record<string, unknown>;
  return {
    id: snapshot.name,
    tenantId: snapshot.tenantId,
    sourceEventId: String(data.sourceEventId),
    sourceEventType: String(data.sourceEventType),
    sourcePayloadKind: String(data.sourcePayloadKind),
    sourceDoctype: String(data.sourceDoctype),
    sourceDocumentName: String(data.sourceDocumentName),
    sourceActorId: String(data.sourceActorId),
    ruleName: String(data.ruleName),
    actionIndex: Number(data.actionIndex),
    action: automationRunActionFromData(data.action),
    retry: automationRunRetryFromData(data.retry),
    status: automationRunStatusFromData(data.status),
    attempts: Number(data.attempts),
    enqueuedAt: String(data.enqueuedAt),
    ...(typeof data.claimedAt === "string" ? { claimedAt: data.claimedAt } : {}),
    ...(typeof data.claimId === "string" ? { claimId: data.claimId } : {}),
    ...(typeof data.claimExpiresAt === "string" ? { claimExpiresAt: data.claimExpiresAt } : {}),
    ...(typeof data.deliveredAt === "string" ? { deliveredAt: data.deliveredAt } : {}),
    ...(typeof data.failedAt === "string" ? { failedAt: data.failedAt } : {}),
    ...(typeof data.error === "string" ? { error: data.error } : {}),
    ...(typeof data.retryAt === "string" ? { retryAt: data.retryAt } : {}),
    ...(typeof data.deadLetteredAt === "string" ? { deadLetteredAt: data.deadLetteredAt } : {}),
    version: snapshot.version
  };
}

export function sortedAutomationRunRecords(
  records: readonly AutomationRunRecord[]
): readonly AutomationRunRecord[] {
  return [...records].sort(
    (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id)
  );
}

export function selectedAutomationRunRecords(
  records: readonly AutomationRunRecord[],
  runIds: readonly string[] | undefined
): readonly AutomationRunRecord[] {
  if (runIds === undefined) {
    return sortedAutomationRunRecords(records);
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  return runIds.map((runId) => byId.get(runId)).filter((record): record is AutomationRunRecord => record !== undefined);
}

function applyAutomationRunEvent(record: AutomationRunRecord, event: DomainEvent<AutomationRunEventPayload>): AutomationRunRecord {
  switch (event.payload.kind) {
    case "AutomationRunClaimed": {
      const { error: _error, retryAt: _retryAt, ...claimable } = record;
      return {
        ...claimable,
        status: "claimed",
        attempts: record.attempts + 1,
        claimId: event.payload.claimId,
        claimedAt: event.occurredAt,
        claimExpiresAt: event.payload.claimExpiresAt,
        version: event.sequence
      };
    }
    case "AutomationRunDelivered": {
      const { error: _error, retryAt: _retryAt, claimExpiresAt: _claimExpiresAt, ...deliverable } = record;
      return {
        ...deliverable,
        status: "delivered",
        claimId: event.payload.claimId,
        deliveredAt: event.occurredAt,
        version: event.sequence
      };
    }
    case "AutomationRunFailed":
      return {
        ...record,
        status: "failed",
        claimId: event.payload.claimId,
        failedAt: event.occurredAt,
        error: event.payload.error,
        retryAt: event.payload.retryAt,
        version: event.sequence
      };
    case "AutomationRunDeadLettered": {
      const { retryAt: _retryAt, claimExpiresAt: _claimExpiresAt, ...dead } = record;
      return {
        ...dead,
        status: "dead",
        claimId: event.payload.claimId,
        error: event.payload.error,
        deadLetteredAt: event.occurredAt,
        version: event.sequence
      };
    }
    case "AutomationRunEnqueued":
      return record;
  }
}

function automationRunData(record: AutomationRunRecord): DocumentData {
  return {
    sourceEventId: record.sourceEventId,
    sourceEventType: record.sourceEventType,
    sourcePayloadKind: record.sourcePayloadKind,
    sourceDoctype: record.sourceDoctype,
    sourceDocumentName: record.sourceDocumentName,
    sourceActorId: record.sourceActorId,
    ruleName: record.ruleName,
    actionIndex: record.actionIndex,
    action: record.action as unknown as JsonValue,
    retry: record.retry as unknown as JsonValue,
    status: record.status,
    attempts: record.attempts,
    enqueuedAt: record.enqueuedAt,
    ...(record.claimedAt === undefined ? {} : { claimedAt: record.claimedAt }),
    ...(record.claimId === undefined ? {} : { claimId: record.claimId }),
    ...(record.claimExpiresAt === undefined ? {} : { claimExpiresAt: record.claimExpiresAt }),
    ...(record.deliveredAt === undefined ? {} : { deliveredAt: record.deliveredAt }),
    ...(record.failedAt === undefined ? {} : { failedAt: record.failedAt }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.retryAt === undefined ? {} : { retryAt: record.retryAt }),
    ...(record.deadLetteredAt === undefined ? {} : { deadLetteredAt: record.deadLetteredAt })
  };
}

function automationRunActionFromData(value: unknown): ResolvedAutomationActionDefinition {
  if (!isRecord(value) || value.kind !== "updateDocument") {
    throw new Error("Automation run snapshot contains an invalid action");
  }
  const target = value.target;
  const patch = value.patch;
  if (
    !isRecord(target) ||
    typeof target.doctype !== "string" ||
    typeof target.name !== "string" ||
    !isDocumentData(patch)
  ) {
    throw new Error("Automation run snapshot contains an invalid updateDocument action");
  }
  return {
    kind: "updateDocument",
    target: {
      doctype: target.doctype,
      name: target.name
    },
    patch
  };
}

function automationRunRetryFromData(value: unknown): AutomationRunRetryPolicy {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.maxAttempts) ||
    !Number.isSafeInteger(value.baseDelaySeconds) ||
    !Number.isSafeInteger(value.maxDelaySeconds)
  ) {
    throw new Error("Automation run snapshot contains an invalid retry policy");
  }
  const maxAttempts = Number(value.maxAttempts);
  const baseDelaySeconds = Number(value.baseDelaySeconds);
  const maxDelaySeconds = Number(value.maxDelaySeconds);
  return {
    maxAttempts,
    baseDelaySeconds,
    maxDelaySeconds
  };
}

function automationRunStatusFromData(value: unknown): AutomationRunStatus {
  if (
    value === "pending" ||
    value === "claimed" ||
    value === "delivered" ||
    value === "failed" ||
    value === "dead"
  ) {
    return value;
  }
  throw new Error("Automation run snapshot contains an invalid status");
}

function isDocumentData(value: unknown): value is DocumentData {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly AutomationRunEnqueued: Extract<
      AutomationRunEventPayload,
      { readonly kind: "AutomationRunEnqueued" }
    >;
    readonly AutomationRunClaimed: Extract<
      AutomationRunEventPayload,
      { readonly kind: "AutomationRunClaimed" }
    >;
    readonly AutomationRunDelivered: Extract<
      AutomationRunEventPayload,
      { readonly kind: "AutomationRunDelivered" }
    >;
    readonly AutomationRunFailed: Extract<
      AutomationRunEventPayload,
      { readonly kind: "AutomationRunFailed" }
    >;
    readonly AutomationRunDeadLettered: Extract<
      AutomationRunEventPayload,
      { readonly kind: "AutomationRunDeadLettered" }
    >;
  }
}
