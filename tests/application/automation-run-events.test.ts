import {
  AUTOMATION_RUN_PAYLOAD_KINDS,
  automationRunEventType,
  automationRunRecordFromSnapshot,
  automationRunSnapshot,
  foldAutomationRun,
  isAutomationRunEvent,
  isAutomationRunPayloadKind,
  selectedAutomationRunRecords,
  sortedAutomationRunRecords
} from "../../src";
import type { DomainEvent } from "../../src";

const now = "2026-01-01T00:00:00.000Z";

describe("automation run events", () => {
  it("derives event types and exposes a bounded payload-kind set", () => {
    expect(AUTOMATION_RUN_PAYLOAD_KINDS).toEqual([
      "AutomationRunEnqueued",
      "AutomationRunClaimed",
      "AutomationRunDelivered",
      "AutomationRunFailed",
      "AutomationRunDeadLettered"
    ]);
    expect(automationRunEventType(enqueuedPayload("run-1"))).toBe("AutomationRunEnqueued");
    expect(automationRunEventType({ kind: "AutomationRunClaimed", runId: "run-1", claimId: "claim-1", claimExpiresAt: now })).toBe("AutomationRunClaimed");
    expect(automationRunEventType({ kind: "AutomationRunDelivered", runId: "run-1", claimId: "claim-1" })).toBe("AutomationRunDelivered");
    expect(automationRunEventType({ kind: "AutomationRunFailed", runId: "run-1", claimId: "claim-1", error: "nope", retryAt: now })).toBe("AutomationRunFailed");
    expect(automationRunEventType({ kind: "AutomationRunDeadLettered", runId: "run-1", claimId: "claim-1", error: "nope" })).toBe("AutomationRunDeadLettered");
  });

  it("narrows automation run events by payload kind instead of event type", () => {
    const event = { ...enqueuedEvent(1, "run-1", now), type: "CustomType" };

    expect(isAutomationRunPayloadKind("AutomationRunEnqueued")).toBe(true);
    expect(isAutomationRunPayloadKind("DocumentUpdated")).toBe(false);
    expect(isAutomationRunEvent(event)).toBe(true);
    expect(isAutomationRunEvent({ ...event, payload: { kind: "DocumentUpdated", patch: {} } })).toBe(false);
    expect(foldAutomationRun("acme", [{ ...event, payload: { kind: "DocumentUpdated", patch: {} } }])).toBeNull();
    expect(foldAutomationRun("acme", [claimedEvent(1, "run-before-enqueue", "claim-1", now)])).toBeNull();
  });

  it("folds claim, failure, retry, delivery, and dead-letter states", () => {
    const delivered = foldAutomationRun("acme", [
      enqueuedEvent(1, "run-1", now),
      claimedEvent(2, "run-1", "claim-1", "2026-01-01T00:05:00.000Z"),
      failedEvent(3, "run-1", "claim-1", "target missing", "2026-01-01T00:01:00.000Z"),
      claimedEvent(4, "run-1", "claim-2", "2026-01-01T00:10:00.000Z"),
      deliveredEvent(5, "run-1", "claim-2")
    ]);

    expect(delivered).toMatchObject({
      id: "run-1",
      status: "delivered",
      attempts: 2,
      claimId: "claim-2",
      deliveredAt: now
    });
    expect(delivered).not.toHaveProperty("error");
    expect(delivered).not.toHaveProperty("retryAt");

    const dead = foldAutomationRun("acme", [
      enqueuedEvent(1, "run-2", now),
      claimedEvent(2, "run-2", "claim-1", "2026-01-01T00:05:00.000Z"),
      deadEvent(3, "run-2", "claim-1", "always broken")
    ]);
    expect(dead).toMatchObject({ id: "run-2", status: "dead", error: "always broken" });
  });

  it("projects and hydrates run snapshots", () => {
    const record = foldAutomationRun("acme", [
      enqueuedEvent(1, "run-1", now),
      claimedEvent(2, "run-1", "claim-1", "2026-01-01T00:05:00.000Z")
    ]);

    expect(record).not.toBeNull();
    const snapshot = automationRunSnapshot(record!);
    expect(snapshot).toMatchObject({
      doctype: "__AutomationRuns",
      name: "run-1",
      docstatus: "draft",
      data: { status: "claimed", attempts: 1 }
    });
    expect(automationRunRecordFromSnapshot(snapshot)).toEqual(record);
    expect(automationRunSnapshot(foldAutomationRun("acme", [
      enqueuedEvent(1, "delivered-run", now),
      claimedEvent(2, "delivered-run", "claim-1", now),
      deliveredEvent(3, "delivered-run", "claim-1")
    ])!)).toMatchObject({ docstatus: "submitted" });
    expect(automationRunSnapshot(foldAutomationRun("acme", [
      enqueuedEvent(1, "dead-run", now),
      claimedEvent(2, "dead-run", "claim-1", now),
      deadEvent(3, "dead-run", "claim-1", "nope")
    ])!)).toMatchObject({ docstatus: "cancelled" });
  });

  it("sorts and selects records deterministically", () => {
    const late = foldAutomationRun("acme", [enqueuedEvent(1, "late", "2026-01-01T00:02:00.000Z")]);
    const alpha = foldAutomationRun("acme", [enqueuedEvent(1, "alpha", now)]);
    const beta = foldAutomationRun("acme", [enqueuedEvent(1, "beta", now)]);
    const records = [late, beta, alpha].filter((record): record is NonNullable<typeof record> => record !== null);

    expect(sortedAutomationRunRecords(records).map((record) => record.id)).toEqual(["alpha", "beta", "late"]);
    expect(selectedAutomationRunRecords(records, ["late", "missing", "alpha"]).map((record) => record.id)).toEqual([
      "late",
      "alpha"
    ]);
    expect(selectedAutomationRunRecords(records, undefined).map((record) => record.id)).toEqual([
      "alpha",
      "beta",
      "late"
    ]);
  });

  it("rejects invalid persisted run snapshots", () => {
    const snapshot = automationRunSnapshot(foldAutomationRun("acme", [enqueuedEvent(1, "run-1", now)])!);

    expect(() => automationRunRecordFromSnapshot({
      ...snapshot,
      data: { ...snapshot.data, action: { kind: "unsupported" } }
    })).toThrow("invalid action");
    expect(() => automationRunRecordFromSnapshot({
      ...snapshot,
      data: { ...snapshot.data, action: { kind: "updateDocument", target: {}, patch: {} } }
    })).toThrow("invalid updateDocument");
    expect(() => automationRunRecordFromSnapshot({
      ...snapshot,
      data: {
        ...snapshot.data,
        action: {
          kind: "updateDocument",
          target: { doctype: "Target", name: "Target One" },
          patch: { bad: undefined }
        }
      }
    } as never)).toThrow("invalid updateDocument");
    expect(() => automationRunRecordFromSnapshot({
      ...snapshot,
      data: { ...snapshot.data, retry: { maxAttempts: "ten" } }
    })).toThrow("invalid retry");
    expect(() => automationRunRecordFromSnapshot({
      ...snapshot,
      data: { ...snapshot.data, status: "unknown" }
    })).toThrow("invalid status");
  });
});

function enqueuedPayload(runId: string) {
  return {
    kind: "AutomationRunEnqueued" as const,
    runId,
    sourceEventId: "evt_source",
    sourceEventType: "SourceUpdated",
    sourcePayloadKind: "DocumentUpdated",
    sourceDoctype: "Source",
    sourceDocumentName: "Source One",
    sourceActorId: "owner@example.com",
    ruleName: "Mirror",
    actionIndex: 0,
    action: {
      kind: "updateDocument" as const,
      target: { doctype: "Target", name: "Target One" },
      patch: { title: "Done" }
    },
    retry: { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 60 }
  };
}

function enqueuedEvent(sequence: number, runId: string, occurredAt: string): DomainEvent {
  return stateEvent(sequence, runId, enqueuedPayload(runId), occurredAt, "owner@example.com");
}

function claimedEvent(sequence: number, runId: string, claimId: string, claimExpiresAt: string): DomainEvent {
  return stateEvent(sequence, runId, {
    kind: "AutomationRunClaimed",
    runId,
    claimId,
    claimExpiresAt
  }, now);
}

function failedEvent(sequence: number, runId: string, claimId: string, error: string, retryAt: string): DomainEvent {
  return stateEvent(sequence, runId, {
    kind: "AutomationRunFailed",
    runId,
    claimId,
    error,
    retryAt
  }, now);
}

function deliveredEvent(sequence: number, runId: string, claimId: string): DomainEvent {
  return stateEvent(sequence, runId, {
    kind: "AutomationRunDelivered",
    runId,
    claimId
  }, now);
}

function deadEvent(sequence: number, runId: string, claimId: string, error: string): DomainEvent {
  return stateEvent(sequence, runId, {
    kind: "AutomationRunDeadLettered",
    runId,
    claimId,
    error
  }, now);
}

function stateEvent(
  sequence: number,
  runId: string,
  payload: DomainEvent["payload"],
  occurredAt: string,
  actorId = "system"
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: `acme:__AutomationRuns:${runId}`,
    sequence,
    type: payload.kind,
    doctype: "__AutomationRuns",
    documentName: runId,
    actorId,
    occurredAt,
    payload,
    metadata: {}
  };
}
