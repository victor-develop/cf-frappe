import {
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createJobRegistry,
  createResourceApi,
  DataPatchQueueService,
  DataPatchService,
  defineDataPatch,
  deterministicIds,
  fixedClock,
  InMemoryDataPatchLog,
  InMemoryJobQueue,
  JobDispatcher,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("data patch api", () => {
  it("lists and applies data patches through admin JSON routes", async () => {
    const services = createServices();
    const resources = { touched: [] as string[] };
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "crm.backfill",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("crm");
            return { touched: resources.touched.length };
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-1"])
    });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches
    });

    const listed = await app.request("/api/data-patches", { headers: adminHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: {
        totals: { total: 1, notApplied: 1 },
        patches: [{ id: "crm.backfill", checksum: "v1", status: "not_applied" }]
      }
    });

    const applied = await app.request("/api/data-patches/apply", { method: "POST", headers: adminHeaders });
    expect(applied.status).toBe(201);
    await expect(applied.json()).resolves.toMatchObject({
      data: {
        applied: [{ id: "crm.backfill", checksum: "v1", appliedAt: now, result: { touched: 1 } }],
        skipped: []
      }
    });
    expect(resources.touched).toEqual(["crm"]);

    const second = await app.request("/api/data-patches/apply", { method: "POST", headers: adminHeaders });
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toMatchObject({
      data: {
        applied: [],
        skipped: [{ id: "crm.backfill", checksum: "v1", appliedAt: now, result: { touched: 1 } }]
      }
    });
    expect(resources.touched).toEqual(["crm"]);
  });

  it("maps data patch admin authorization failures to JSON errors", async () => {
    const services = createServices();
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources: {},
        patches: [defineDataPatch({ id: "core.seed", checksum: "v1", run: () => undefined })]
      })
    });

    const denied = await app.request("/api/data-patches", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });

    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Actor 'admin@example.com' cannot manage data patches" }
    });
  });

  it("applies bounded batches and single patches through data patch admin routes", async () => {
    const services = createServices();
    const resources = { touched: [] as string[] };
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources,
        patches: [
          defineDataPatch<typeof resources>({
            id: "core.first",
            checksum: "v1",
            run: ({ resources }) => {
              resources.touched.push("first");
            }
          }),
          defineDataPatch<typeof resources>({
            id: "crm.second",
            checksum: "v1",
            run: ({ resources }) => {
              resources.touched.push("second");
            }
          }),
          defineDataPatch<typeof resources>({
            id: "crm.third",
            checksum: "v1",
            run: ({ resources }) => {
              resources.touched.push("third");
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-first", "claim-second", "claim-third"])
      })
    });

    const blocked = await app.request("/api/data-patches/crm.third/apply", {
      method: "POST",
      headers: adminHeaders
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      error: {
        code: "DATA_PATCH_ORDER_VIOLATION",
        message: "Data patch 'crm.third' cannot run before earlier patch 'core.first' is applied"
      }
    });

    const first = await app.request("/api/data-patches/apply?limit=1", { method: "POST", headers: adminHeaders });
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({
      data: { applied: [{ id: "core.first" }], skipped: [] }
    });

    const second = await app.request("/api/data-patches/crm.second/apply", {
      method: "POST",
      headers: adminHeaders
    });
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toMatchObject({
      data: { applied: [{ id: "crm.second" }], skipped: [] }
    });

    const third = await app.request("/api/data-patches/apply", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, patchIds: ["crm.third"] })
    });
    expect(third.status).toBe(201);
    await expect(third.json()).resolves.toMatchObject({
      data: { applied: [{ id: "crm.third" }], skipped: [] }
    });
    expect(resources.touched).toEqual(["first", "second", "third"]);
  });

  it("plans rollback batches through data patch admin routes without running rollback code", async () => {
    const services = createServices();
    const resources = { applied: [] as string[], rolledBack: [] as string[] };
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources,
        patches: [
          defineDataPatch<typeof resources>({
            id: "core.first",
            checksum: "v1",
            run: ({ resources }) => {
              resources.applied.push("first");
            },
            rollback: {
              label: "Undo First",
              run: ({ resources }) => {
                resources.rolledBack.push("first");
              }
            }
          }),
          defineDataPatch<typeof resources>({
            id: "crm.second",
            checksum: "v1",
            run: ({ resources }) => {
              resources.applied.push("second");
            },
            rollback: {
              run: ({ resources }) => {
                resources.rolledBack.push("second");
              }
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-first", "claim-second", "rollback-second", "rollback-first"])
      })
    });

    const applied = await app.request("/api/data-patches/apply", { method: "POST", headers: adminHeaders });
    expect(applied.status).toBe(201);

    const listed = await app.request("/api/data-patches", { headers: adminHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: {
        patches: [
          { id: "core.first", rollbackable: true, rollbackLabel: "Undo First" },
          { id: "crm.second", rollbackable: true }
        ]
      }
    });

    const batch = await app.request("/api/data-patches/rollback-plan", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ limit: 1 })
    });
    expect(batch.status).toBe(200);
    await expect(batch.json()).resolves.toEqual({
      data: { patchIds: ["crm.second"], limit: 1 }
    });

    const single = await app.request("/api/data-patches/crm.second/rollback-plan", {
      method: "POST",
      headers: adminHeaders
    });
    expect(single.status).toBe(200);
    await expect(single.json()).resolves.toEqual({
      data: { patchIds: ["crm.second"], requestedPatchIds: ["crm.second"] }
    });

    const rolledBack = await app.request("/api/data-patches/rollback", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ limit: 1 })
    });
    expect(rolledBack.status).toBe(201);
    await expect(rolledBack.json()).resolves.toEqual({
      data: {
        rolledBack: [{ id: "crm.second", checksum: "v1", rolledBackAt: now }],
        skipped: []
      }
    });

    const rolledBackSingle = await app.request("/api/data-patches/core.first/rollback", {
      method: "POST",
      headers: adminHeaders
    });
    expect(rolledBackSingle.status).toBe(201);
    await expect(rolledBackSingle.json()).resolves.toEqual({
      data: {
        rolledBack: [{ id: "core.first", checksum: "v1", rolledBackAt: now }],
        skipped: []
      }
    });
    expect(resources).toEqual({ applied: ["first", "second"], rolledBack: ["second", "first"] });
  });

  it("retries a failed data patch through the admin JSON route", async () => {
    const services = createServices();
    const resources = { attempts: 0 };
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources,
        patches: [
          defineDataPatch<typeof resources>({
            id: "core.retry",
            checksum: "v1",
            run: ({ resources }) => {
              resources.attempts += 1;
              if (resources.attempts === 1) {
                throw new Error("boom");
              }
              return { attempts: resources.attempts };
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-failed", "claim-retry"])
      })
    });

    const failed = await app.request("/api/data-patches/apply", { method: "POST", headers: adminHeaders });
    expect(failed.status).toBe(500);
    expect(resources.attempts).toBe(1);

    const retried = await app.request("/api/data-patches/core.retry/retry", {
      method: "POST",
      headers: adminHeaders
    });
    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({
      data: {
        applied: [{ id: "core.retry", checksum: "v1", appliedAt: now, result: { attempts: 2 } }],
        skipped: []
      }
    });
    expect(resources.attempts).toBe(2);

    const appliedRetry = await app.request("/api/data-patches/core.retry/retry", {
      method: "POST",
      headers: adminHeaders
    });
    expect(appliedRetry.status).toBe(409);
    await expect(appliedRetry.json()).resolves.toMatchObject({
      error: { code: "DATA_PATCH_RETRY_UNAVAILABLE" }
    });
  });

  it("retries a failed data patch rollback through the admin JSON route", async () => {
    const services = createServices();
    const resources = { attempts: 0 };
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources,
        patches: [
          defineDataPatch<typeof resources>({
            id: "core.rollback_retry",
            checksum: "v1",
            run: () => undefined,
            rollback: {
              run: ({ resources }) => {
                resources.attempts += 1;
                if (resources.attempts === 1) {
                  throw new Error("rollback boom");
                }
                return { attempts: resources.attempts };
              }
            }
          })
        ],
        clock: fixedClock(now),
        ids: deterministicIds(["claim-apply", "rollback-failed", "rollback-retry"])
      })
    });

    const applied = await app.request("/api/data-patches/apply", { method: "POST", headers: adminHeaders });
    expect(applied.status).toBe(201);
    const failed = await app.request("/api/data-patches/core.rollback_retry/rollback", {
      method: "POST",
      headers: adminHeaders
    });
    expect(failed.status).toBe(500);
    expect(resources.attempts).toBe(1);

    const retried = await app.request("/api/data-patches/core.rollback_retry/rollback-retry", {
      method: "POST",
      headers: adminHeaders
    });
    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toEqual({
      data: {
        rolledBack: [{ id: "core.rollback_retry", checksum: "v1", rolledBackAt: now, result: { attempts: 2 } }],
        skipped: []
      }
    });
    expect(resources.attempts).toBe(2);

    const retriedAgain = await app.request("/api/data-patches/core.rollback_retry/rollback-retry", {
      method: "POST",
      headers: adminHeaders
    });
    expect(retriedAgain.status).toBe(409);
    await expect(retriedAgain.json()).resolves.toMatchObject({
      error: { code: "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE" }
    });
  });

  it("enqueues data patch apply jobs through admin JSON routes", async () => {
    const services = createServices();
    const resources = { touched: [] as string[] };
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("first");
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("second");
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second"])
    });
    const registry = createJobRegistry({ jobs: [createDataPatchApplyJob()] });
    const queue = new InMemoryJobQueue();
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches,
      dataPatchQueue: new DataPatchQueueService({
        dataPatches,
        dispatcher: new JobDispatcher({
          registry,
          queue,
          clock: fixedClock(now),
          ids: deterministicIds(["patch-001", "patch-002"])
        })
      })
    });

    const blocked = await app.request("/api/data-patches/crm.second/enqueue", {
      method: "POST",
      headers: adminHeaders
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      error: {
        code: "DATA_PATCH_ORDER_VIOLATION",
        message: "Data patch 'crm.second' cannot run before earlier patch 'core.first' is applied"
      }
    });

    const enqueued = await app.request("/api/data-patches/enqueue?limit=1", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "patches:first", delaySeconds: 15 })
    });

    expect(enqueued.status).toBe(202);
    await expect(enqueued.json()).resolves.toMatchObject({
      data: {
        plan: { patchIds: ["core.first"], limit: 1 },
        message: {
          tenantId: "acme",
          jobName: "cf-frappe.data-patches.apply",
          runId: "job_patch-001",
          idempotencyKey: "patches:first",
          payload: {
            actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
            patchIds: ["core.first"]
          }
        }
      }
    });
    expect(queue.queued()).toEqual([
      expect.objectContaining({
        delaySeconds: 15,
        message: expect.objectContaining({ idempotencyKey: "patches:first" })
      })
    ]);
    expect(resources.touched).toEqual([]);

    const single = await app.request("/api/data-patches/core.first/enqueue", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ patchIds: [], idempotencyKey: "patches:route-id" })
    });
    expect(single.status).toBe(202);
    await expect(single.json()).resolves.toMatchObject({
      data: {
        plan: { patchIds: ["core.first"], requestedPatchIds: ["core.first"] },
        message: { idempotencyKey: "patches:route-id", payload: { patchIds: ["core.first"] } }
      }
    });
  });

  it("enqueues data patch rollback jobs through admin JSON routes", async () => {
    const services = createServices();
    const resources = { applied: [] as string[], rolledBack: [] as string[] };
    const dataPatches = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("first");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("first");
            }
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("second");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("second");
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second"])
    });
    const registry = createJobRegistry({ jobs: [createDataPatchRollbackJob()] });
    const queue = new InMemoryJobQueue();
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches,
      dataPatchRollbackQueue: new DataPatchQueueService({
        dataPatches,
        dispatcher: new JobDispatcher({
          registry,
          queue,
          clock: fixedClock(now),
          ids: deterministicIds(["patch-rollback-001", "patch-rollback-002"])
        })
      })
    });
    await dataPatches.apply({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" });

    const enqueued = await app.request("/api/data-patches/rollback-enqueue?limit=1", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "patches:rollback-second", delaySeconds: 30 })
    });

    expect(enqueued.status).toBe(202);
    await expect(enqueued.json()).resolves.toMatchObject({
      data: {
        plan: { patchIds: ["crm.second"], limit: 1 },
        message: {
          tenantId: "acme",
          jobName: "cf-frappe.data-patches.rollback",
          runId: "job_patch-rollback-001",
          idempotencyKey: "patches:rollback-second",
          payload: {
            actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
            patchIds: ["crm.second"]
          }
        }
      }
    });
    expect(queue.queued()).toEqual([
      expect.objectContaining({
        delaySeconds: 30,
        message: expect.objectContaining({ idempotencyKey: "patches:rollback-second" })
      })
    ]);
    expect(resources.rolledBack).toEqual([]);

    const single = await app.request("/api/data-patches/crm.second/rollback-enqueue", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ patchIds: [], idempotencyKey: "patches:route-id" })
    });
    expect(single.status).toBe(202);
    await expect(single.json()).resolves.toMatchObject({
      data: {
        plan: { patchIds: ["crm.second"], requestedPatchIds: ["crm.second"] },
        message: { idempotencyKey: "patches:route-id", payload: { patchIds: ["crm.second"] } }
      }
    });
  });

  it("maps invalid data patch apply options to JSON errors", async () => {
    const services = createServices();
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources: {},
        patches: [defineDataPatch({ id: "core.seed", checksum: "v1", run: () => undefined })]
      }),
      dataPatchQueue: new DataPatchQueueService({
        dataPatches: new DataPatchService({
          log: new InMemoryDataPatchLog(),
          resources: {},
          patches: [defineDataPatch({ id: "core.seed", checksum: "v1", run: () => undefined })]
        }),
        dispatcher: new JobDispatcher({
          registry: createJobRegistry({ jobs: [createDataPatchApplyJob()] }),
          queue: new InMemoryJobQueue(),
          clock: fixedClock(now),
          ids: deterministicIds(["patch-001"])
        })
      })
    });

    const invalidLimit = await app.request("/api/data-patches/apply?limit=0", {
      method: "POST",
      headers: adminHeaders
    });
    expect(invalidLimit.status).toBe(400);
    await expect(invalidLimit.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Data patch apply limit must be a positive integer" }
    });

    const nullLimit = await app.request("/api/data-patches/apply", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ limit: null })
    });
    expect(nullLimit.status).toBe(400);
    await expect(nullLimit.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Data patch apply limit must be a positive integer" }
    });

    const missingPatch = await app.request("/api/data-patches/missing.patch/apply", {
      method: "POST",
      headers: adminHeaders
    });
    expect(missingPatch.status).toBe(404);
    await expect(missingPatch.json()).resolves.toMatchObject({
      error: { code: "DATA_PATCH_NOT_FOUND", message: "Data patch 'missing.patch' is not registered" }
    });

    const invalidDelay = await app.request("/api/data-patches/enqueue", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ delaySeconds: -1 })
    });
    expect(invalidDelay.status).toBe(400);
    await expect(invalidDelay.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Data patch enqueue delaySeconds must be a non-negative integer" }
    });

    const invalidKey = await app.request("/api/data-patches/enqueue", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "" })
    });
    expect(invalidKey.status).toBe(400);
    await expect(invalidKey.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "idempotencyKey must be a non-empty string" }
    });
  });

  it("keeps data patch enqueue routes hidden until a queue port is configured", async () => {
    const services = createServices();
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      dataPatches: new DataPatchService({
        log: new InMemoryDataPatchLog(),
        resources: {},
        patches: [defineDataPatch({ id: "core.seed", checksum: "v1", run: () => undefined })]
      })
    });

    const hidden = await app.request("/api/data-patches/enqueue", { method: "POST", headers: adminHeaders });
    const hiddenRollback = await app.request("/api/data-patches/rollback-enqueue", { method: "POST", headers: adminHeaders });

    expect(hidden.status).toBe(404);
    expect(hiddenRollback.status).toBe(404);
  });
});
