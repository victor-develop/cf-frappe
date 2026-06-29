import {
  dataPatchApplyDispatchCommand,
  dataPatchJobActor,
  dataPatchRollbackResultJson,
  dataPatchRollbackDispatchCommand,
  dataPatchRollbackRetryDispatchCommand,
  dataPatchRunResultJson,
  parseDataPatchJobActor,
  parseDataPatchJobPatchIds,
  parseDataPatchRollbackRetryJobPatchId
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

  it("parses job actor payloads by value", () => {
    const roles = [SYSTEM_MANAGER_ROLE];
    const parsed = parseDataPatchJobActor({
      id: "admin@example.com",
      roles,
      tenantId: "acme",
      email: "admin@example.com"
    });

    roles[0] = "Guest";

    expect(parsed).toEqual({
      id: "admin@example.com",
      roles: [SYSTEM_MANAGER_ROLE],
      tenantId: "acme",
      email: "admin@example.com"
    });
    expect(() => parseDataPatchJobActor({ id: "admin@example.com", roles: ["ok", 1] })).toThrow(
      "Data patch apply job actor roles are invalid"
    );
    expect(() => parseDataPatchJobActor({ id: "admin@example.com", roles: [], tenantId: 1 })).toThrow(
      "Data patch apply job actor tenantId is invalid"
    );
  });

  it("parses job patch payloads by value", () => {
    const patchIds = ["core.first"];
    const parsed = parseDataPatchJobPatchIds(patchIds);
    patchIds[0] = "core.mutated";

    expect(parsed).toEqual(["core.first"]);
    expect(parseDataPatchRollbackRetryJobPatchId("core.retry")).toBe("core.retry");
    expect(() => parseDataPatchJobPatchIds([""])).toThrow("Data patch apply job patchIds are invalid");
    expect(() => parseDataPatchRollbackRetryJobPatchId("")).toThrow(
      "Data patch rollback retry job patchId is invalid"
    );
  });

  it("shapes apply run results as job JSON", () => {
    expect(
      dataPatchRunResultJson({
        applied: [
          { id: "core.first", checksum: "v1", appliedAt: "2026-01-01T00:00:00.000Z", result: { touched: 1 } }
        ],
        skipped: [{ id: "crm.second", checksum: "v1", appliedAt: "2026-01-01T00:01:00.000Z" }]
      })
    ).toEqual({
      applied: [
        {
          id: "core.first",
          checksum: "v1",
          appliedAt: "2026-01-01T00:00:00.000Z",
          result: { touched: 1 }
        }
      ],
      skipped: [{ id: "crm.second", checksum: "v1", appliedAt: "2026-01-01T00:01:00.000Z" }]
    });
  });

  it("shapes rollback run results as job JSON", () => {
    expect(
      dataPatchRollbackResultJson({
        rolledBack: [
          { id: "crm.second", checksum: "v1", rolledBackAt: "2026-01-01T00:00:00.000Z", result: { undone: 1 } }
        ],
        skipped: [
          {
            id: "core.first",
            checksum: "v1",
            appliedAt: "2026-01-01T00:00:00.000Z",
            rolledBackAt: "2026-01-01T00:01:00.000Z"
          }
        ]
      })
    ).toEqual({
      rolledBack: [
        {
          id: "crm.second",
          checksum: "v1",
          rolledBackAt: "2026-01-01T00:00:00.000Z",
          result: { undone: 1 }
        }
      ],
      skipped: [{ id: "core.first", checksum: "v1", rolledBackAt: "2026-01-01T00:01:00.000Z" }]
    });
  });
});
