import type { DocumentData, JsonValue } from "../../src/core/types.js";
import {
  dataPatchErrorMessage,
  dataPatchRollbackCompleteCommand,
  dataPatchRollbackFailureCommand,
  dataPatchRollbackRecord,
  dataPatchRunCompleteCommand,
  dataPatchRunFailureCommand,
  dataPatchRunRecord,
  normalizeDataPatchRunResult
} from "../../src/application/data-patch-run-policy.js";
import { now } from "../helpers";

describe("data patch run policy", () => {
  it("normalizes JSON results by value and rejects non-JSON results", () => {
    const result = { nested: { count: 1 }, tags: ["seed"] };
    const normalized = normalizeDataPatchRunResult(result, "Data patch result") as DocumentData;

    result.nested.count = 2;
    result.tags.push("mutated");

    expect(normalized).toEqual({ nested: { count: 1 }, tags: ["seed"] });
    (normalized.tags as JsonValue[]).push("returned");
    expect(result.tags).toEqual(["seed", "mutated"]);
    expect(normalizeDataPatchRunResult(undefined, "Data patch result")).toBeUndefined();
    expect(() => normalizeDataPatchRunResult(Number.POSITIVE_INFINITY as never, "Data patch result")).toThrow(
      "Data patch result must be JSON-serializable"
    );
  });

  it("shapes apply completion and failure journal commands", () => {
    const record = dataPatchRunRecord("core.seed", "v1", now, { touched: 1 });

    expect(record).toEqual({ id: "core.seed", checksum: "v1", appliedAt: now, result: { touched: 1 } });
    expect(dataPatchRunRecord("core.empty", "v1", now, undefined)).toEqual({
      id: "core.empty",
      checksum: "v1",
      appliedAt: now
    });
    expect(dataPatchRunCompleteCommand(record, "claim-seed")).toEqual({
      id: "core.seed",
      checksum: "v1",
      claimId: "claim-seed",
      appliedAt: now,
      result: { touched: 1 }
    });
    expect(dataPatchRunFailureCommand("core.seed", "v1", "claim-seed", now, new Error("boom"))).toEqual({
      id: "core.seed",
      checksum: "v1",
      claimId: "claim-seed",
      failedAt: now,
      error: "boom"
    });
  });

  it("shapes rollback completion and failure journal commands", () => {
    const record = dataPatchRollbackRecord("core.seed", "v1", now, { undone: true });

    expect(record).toEqual({ id: "core.seed", checksum: "v1", rolledBackAt: now, result: { undone: true } });
    expect(dataPatchRollbackRecord("core.empty", "v1", now, undefined)).toEqual({
      id: "core.empty",
      checksum: "v1",
      rolledBackAt: now
    });
    expect(dataPatchRollbackCompleteCommand(record, "rollback-seed")).toEqual({
      id: "core.seed",
      checksum: "v1",
      claimId: "rollback-seed",
      rolledBackAt: now,
      result: { undone: true }
    });
    expect(dataPatchRollbackFailureCommand("core.seed", "v1", "rollback-seed", now, "rollback boom")).toEqual({
      id: "core.seed",
      checksum: "v1",
      claimId: "rollback-seed",
      failedAt: now,
      error: "rollback boom"
    });
  });

  it("formats unknown thrown values consistently", () => {
    expect(dataPatchErrorMessage(new Error("boom"))).toBe("boom");
    expect(dataPatchErrorMessage("plain")).toBe("plain");
    expect(dataPatchErrorMessage(42)).toBe("42");
  });
});
