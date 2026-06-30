import {
  ensureDataPatchAdminAvailable,
  ensureDataPatchQueueAvailable,
  ensureDataPatchRollbackQueueAvailable,
  ensureDataPatchRollbackRetryQueueAvailable
} from "../../src";

describe("data patch availability policy", () => {
  it("guards Desk data patch admin availability", () => {
    expect(() => ensureDataPatchAdminAvailable({ dashboard: async () => ({ patches: [], totals: {} }) })).not.toThrow();

    expectDataPatchNotFound(() => ensureDataPatchAdminAvailable(undefined), "Data patches are not enabled");
  });

  it("guards Desk data patch apply queue availability", () => {
    expect(() => ensureDataPatchQueueAvailable({ enqueue: async () => ({ message: {} }) })).not.toThrow();

    expectDataPatchNotFound(() => ensureDataPatchQueueAvailable(undefined), "Data patch queue is not enabled");
  });

  it("guards Desk data patch rollback queue availability", () => {
    expect(() =>
      ensureDataPatchRollbackQueueAvailable({ enqueueRollback: async () => ({ message: {} }) })
    ).not.toThrow();

    expectDataPatchNotFound(
      () => ensureDataPatchRollbackQueueAvailable(undefined),
      "Data patch rollback queue is not enabled"
    );
  });

  it("guards Desk data patch rollback retry queue availability", () => {
    expect(() =>
      ensureDataPatchRollbackRetryQueueAvailable({ enqueueRollbackRetry: async () => ({ message: {} }) })
    ).not.toThrow();

    expectDataPatchNotFound(
      () => ensureDataPatchRollbackRetryQueueAvailable(undefined),
      "Data patch rollback retry queue is not enabled"
    );
  });
});

function expectDataPatchNotFound(action: () => void, message: string): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({
    code: "DATA_PATCH_NOT_FOUND",
    message,
    status: 404
  });
}
