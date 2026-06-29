import {
  dataPatchApplyDispatchCommand,
  dataPatchJobActor,
  dataPatchRollbackDispatchCommand,
  dataPatchRollbackRetryDispatchCommand
} from "../../src/application/data-patch-job-policy.js";
import { SYSTEM_MANAGER_ROLE } from "../../src/core/types.js";

describe("data patch job policy", () => {
  it("builds apply dispatch commands with snapshotted actor and patch ids", () => {
    const roles = [SYSTEM_MANAGER_ROLE];
    const actor = { id: "admin@example.com", roles, tenantId: "acme", email: "admin@example.com" };
    const patchIds = ["core.first"];
    const command = dataPatchApplyDispatchCommand("patch.apply", actor, patchIds, {
      delaySeconds: 30,
      idempotencyKey: "patches:first",
      metadata: {
        dispatchSource: "caller",
        requestedBy: "other@example.com",
        source: "test"
      }
    });

    roles[0] = "Guest";
    patchIds[0] = "core.mutated";

    expect(command).toEqual({
      jobName: "patch.apply",
      tenantId: "acme",
      idempotencyKey: "patches:first",
      delaySeconds: 30,
      payload: {
        actor: {
          id: "admin@example.com",
          roles: [SYSTEM_MANAGER_ROLE],
          tenantId: "acme",
          email: "admin@example.com"
        },
        patchIds: ["core.first"]
      },
      metadata: {
        dispatchSource: "data-patches",
        requestedBy: "admin@example.com",
        source: "test"
      }
    });
  });

  it("builds rollback dispatch commands with patch plan ids", () => {
    const actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] };

    expect(dataPatchRollbackDispatchCommand("patch.rollback", actor, ["crm.second"], {})).toEqual({
      jobName: "patch.rollback",
      payload: {
        actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] },
        patchIds: ["crm.second"]
      },
      metadata: {
        dispatchSource: "data-patches",
        requestedBy: "admin@example.com"
      }
    });
  });

  it("builds rollback retry dispatch commands with a single patch id", () => {
    const actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    expect(dataPatchRollbackRetryDispatchCommand("patch.rollback-retry", actor, "core.retry", {})).toEqual({
      jobName: "patch.rollback-retry",
      tenantId: "acme",
      payload: {
        actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
        patchId: "core.retry"
      },
      metadata: {
        dispatchSource: "data-patches",
        requestedBy: "admin@example.com"
      }
    });
  });

  it("omits absent optional actor fields", () => {
    expect(dataPatchJobActor({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] })).toEqual({
      id: "admin@example.com",
      roles: [SYSTEM_MANAGER_ROLE]
    });
  });
});
