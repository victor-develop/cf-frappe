import {
  ensureJobQueueIdempotencyKey,
  jobQueueSendOptions,
  normalizeJobDocumentData,
  normalizeJobHandlerResult
} from "../../src";

describe("job payload policy", () => {
  it("normalizes JSON object job data by value", () => {
    const data = { source: "api", nested: { count: 1 } };
    const normalized = normalizeJobDocumentData(data, "Job payload");

    data.nested.count = 2;

    expect(normalized).toEqual({ source: "api", nested: { count: 1 } });
  });

  it("rejects non-object or non-JSON job data", () => {
    expect(() => normalizeJobDocumentData([] as never, "Job payload")).toThrow("Job payload must be a JSON object");
    expect(() => normalizeJobDocumentData({ source: undefined } as never, "Job metadata"))
      .toThrow("Job metadata must be a JSON object");
  });

  it("normalizes JSON handler results by value", () => {
    const result = { sent: 3 };
    const normalized = normalizeJobHandlerResult(result);

    result.sent = 4;

    expect(normalized).toEqual({ sent: 3 });
    expect(normalizeJobHandlerResult(undefined)).toBeUndefined();
  });

  it("plans optional queue send delay options", () => {
    expect(jobQueueSendOptions({})).toBeUndefined();
    expect(jobQueueSendOptions({ delaySeconds: 0 })).toEqual({ delaySeconds: 0 });
    expect(jobQueueSendOptions({ delaySeconds: 86_400 })).toEqual({ delaySeconds: 86_400 });
  });

  it("rejects invalid queue delay options", () => {
    expect(() => jobQueueSendOptions({ delaySeconds: -1 }))
      .toThrow("Job queue delaySeconds must be an integer between 0 and 86400");
    expect(() => jobQueueSendOptions({ delaySeconds: 1.5 }))
      .toThrow("Job queue delaySeconds must be an integer between 0 and 86400");
    expect(() => jobQueueSendOptions({ delaySeconds: 86_401 }))
      .toThrow("Job queue delaySeconds must be an integer between 0 and 86400");
  });

  it("guards queue idempotency key length", () => {
    expect(() => ensureJobQueueIdempotencyKey(undefined)).not.toThrow();
    expect(() => ensureJobQueueIdempotencyKey("job:key")).not.toThrow();
    expect(() => ensureJobQueueIdempotencyKey("x".repeat(257)))
      .toThrow("Job queue idempotencyKey must be at most 256 characters");
  });
});
