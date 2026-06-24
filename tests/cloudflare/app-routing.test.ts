import {
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createDataPatchRollbackRetryJob,
  createJobRegistry,
  createRegistry,
  createInMemoryAccountRecoveryNotifier,
  createSignedSessionCookie,
  defineDashboard,
  defineDataPatch,
  deterministicIds,
  fixedClock,
  InMemoryDataPatchLog,
  InMemoryJobQueue,
  signedSessionActorResolver,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver,
  type CloudflareAccessJwtClaims,
  type CloudflareAccessJwks,
  type JobMessage,
  type PasswordHasher,
} from "../../src";
import {
  createCloudFrappeWorker,
  type AggregateCoordinatorCommand,
  type AggregateCoordinatorRpc,
  type RealtimeHubNamespace,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { createTestRegistry, noteDocType, now, owner } from "../helpers";

describe("CloudFrappe Worker routing", () => {
  it("routes only /desk and /desk/* to the Desk app", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const fetch = worker.fetch!;
    const desk = await fetch(cfRequest("http://localhost/desk"), env, fakeExecutionContext());
    const deskish = await fetch(cfRequest("http://localhost/deskish"), env, fakeExecutionContext());

    expect(desk.status).toBe(200);
    expect(desk.headers.get("content-type")).toContain("text/html");
    expect(deskish.status).toBe(404);
    expect(deskish.headers.get("content-type")).toContain("application/json");
  });

  it("serves the built-in Desk client runtime through Worker routing", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(cfRequest("http://localhost/desk/client.js"), env, fakeExecutionContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    await expect(response.text()).resolves.toContain("root.cfFrappe");
  });

  it("mounts metadata dashboard Desk routes through Worker routing", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      dashboards: [
        defineDashboard({
          name: "Operations",
          label: "Operations",
          description: "Operational KPIs",
          roles: ["User"],
          cards: [
            {
              name: "open_notes",
              label: "Open Notes",
              source: { kind: "documentCount", doctype: "Note", filters: [{ field: "workflow_state", value: "Open" }] }
            }
          ]
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(
      cfRequest("http://localhost/desk/dashboards/Operations"),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Operational KPIs");
    expect(html).toContain("Open Notes");
    expect(html).toContain("<strong>0</strong>");
  });

  it("enables generated Desk document presence panels when realtime is configured", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace([]), route: "/rt" }
    });
    const env = {
      DB: fakeDocumentD1("My Note"),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(
      cfRequest("http://localhost/desk/Note/My%20Note"),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-cf-frappe-presence="document"');
    expect(html).toContain('data-document-name="My Note"');
    expect(html).toContain('data-realtime-route="/rt"');
    expect(html).toContain('data-tenant-id="acme"');
  });

  it("mounts admin audit search on the Worker API", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(cfRequest("http://localhost/api/audit/events?limit=1"), env, fakeExecutionContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { tenantId: "acme", events: [] } });
  });

  it("mounts workflow definition routes and applies them to Worker metadata", async () => {
    const worker = createCloudFrappeWorker({
      registry: createRegistry({ doctypes: [noteDocType] }),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" })
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace()
    };

    const saved = await worker.fetch!(
      cfRequest("http://localhost/api/workflows/Note", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 0,
          workflow: {
            initialState: "Open",
            states: ["Open", "Closed"],
            transitions: [{ action: "approve", from: "Open", to: "Closed", roles: ["User"] }]
          }
        })
      }),
      env,
      fakeExecutionContext()
    );
    expect(saved.status).toBe(200);

    const meta = await worker.fetch!(cfRequest("http://localhost/api/meta/doctypes/Note"), env, fakeExecutionContext());

    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: { workflow: { transitions: [{ action: "approve" }] } }
    });
  });

  it("mounts field property routes and applies them to Worker metadata", async () => {
    const worker = createCloudFrappeWorker({
      registry: createRegistry({ doctypes: [noteDocType] }),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" })
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace()
    };

    const saved = await worker.fetch!(
      cfRequest("http://localhost/api/field-properties/Note/priority", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 0,
          overrides: {
            label: "Urgency",
            options: ["Low", "High"],
            defaultValue: "High"
          }
        })
      }),
      env,
      fakeExecutionContext()
    );
    expect(saved.status).toBe(200);

    const meta = await worker.fetch!(cfRequest("http://localhost/api/meta/doctypes/Note"), env, fakeExecutionContext());

    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toMatchObject({
      data: {
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "priority", label: "Urgency", options: ["Low", "High"] })
        ])
      }
    });
  });

  it("mounts durable user notification inbox routes on the Worker API", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(cfRequest("http://localhost/api/notifications"), env, fakeExecutionContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        userId: "owner@example.com",
        unreadCount: 0,
        notifications: []
      }
    });
  });

  it("mounts notification rule administration routes on the Worker API", async () => {
    const worker = createCloudFrappeWorker({
      registry: createRegistry({ doctypes: [noteDocType] }),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE, "User"], tenantId: "acme" })
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace()
    };

    const saved = await worker.fetch!(
      cfRequest("http://localhost/api/notification-rules/Note/Managers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 0,
          rule: {
            events: ["DocumentUpdated"],
            recipients: [{ kind: "user", userId: "manager@example.com" }],
            subject: "Note changed"
          }
        })
      }),
      env,
      fakeExecutionContext()
    );
    expect(saved.status).toBe(200);

    const rules = await worker.fetch!(
      cfRequest("http://localhost/api/notification-rules/Note"),
      env,
      fakeExecutionContext()
    );

    expect(rules.status).toBe(200);
    await expect(rules.json()).resolves.toMatchObject({
      data: {
        rules: [{ rule: { name: "Managers", subject: "Note changed" } }]
      }
    });
  });

  it("routes document share API commands through the aggregate namespace", async () => {
    const calls: AggregateCoordinatorCommand[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeTransactingNamespace(calls)
    };

    const shared = await worker.fetch!(
      cfRequest("http://localhost/api/resource/Note/My%20Note/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "collab@example.com", permissions: ["read"], expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );
    const revoked = await worker.fetch!(
      cfRequest("http://localhost/api/resource/Note/My%20Note/shares/collab%40example.com", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 2 })
      }),
      env,
      fakeExecutionContext()
    );

    expect(shared.status).toBe(201);
    expect(revoked.status).toBe(200);
    expect(calls).toMatchObject([
      { kind: "share", doctype: "Note", name: "My Note", userId: "collab@example.com", permissions: ["read"] },
      { kind: "revokeShare", doctype: "Note", name: "My Note", userId: "collab@example.com" }
    ]);
  });

  it("mounts saved report-builder definitions on the Worker API", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/report-builder/Note"),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it("mounts app-declared data patch admin routes on the Worker", async () => {
    const resources = { touched: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
          id: "crm.backfill",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("crm");
            return { touched: resources.touched.length };
          }
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log,
        resources: () => resources,
        clock: fixedClock(now),
        ids: deterministicIds(["claim-1"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const dashboard = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches"),
      env,
      fakeExecutionContext()
    );
    expect(dashboard.status).toBe(200);
    await expect(dashboard.json()).resolves.toMatchObject({
      data: {
        totals: { total: 1, notApplied: 1 },
        patches: [{ id: "crm.backfill", checksum: "v1", status: "not_applied" }]
      }
    });

    const planned = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/plan", {
        method: "POST",
        body: JSON.stringify({ limit: 1 })
      }),
      env,
      fakeExecutionContext()
    );

    expect(planned.status).toBe(200);
    await expect(planned.json()).resolves.toMatchObject({
      data: {
        patchIds: ["crm.backfill"],
        limit: 1
      }
    });
    expect(resources.touched).toEqual([]);
    await expect(log.recordedDataPatches()).resolves.toEqual([]);

    const targetedPlan = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/crm.backfill/plan", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(targetedPlan.status).toBe(200);
    await expect(targetedPlan.json()).resolves.toMatchObject({
      data: {
        patchIds: ["crm.backfill"],
        requestedPatchIds: ["crm.backfill"]
      }
    });
    expect(resources.touched).toEqual([]);
    await expect(log.recordedDataPatches()).resolves.toEqual([]);

    const applied = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/apply", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(applied.status).toBe(201);
    await expect(applied.json()).resolves.toMatchObject({
      data: {
        applied: [{ id: "crm.backfill", checksum: "v1", appliedAt: now, result: { touched: 1 } }],
        skipped: []
      }
    });
    expect(resources.touched).toEqual(["crm"]);
  });

  it("mounts failed data patch retry routes on the Worker", async () => {
    const resources = { attempts: 0 };
    const log = new InMemoryDataPatchLog();
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
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
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log,
        resources: () => resources,
        clock: fixedClock(now),
        ids: deterministicIds(["claim-failed", "claim-retry"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const failed = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/apply", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(failed.status).toBe(500);

    const retried = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/core.retry/retry", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({
      data: {
        applied: [{ id: "core.retry", checksum: "v1", appliedAt: now, result: { attempts: 2 } }],
        skipped: []
      }
    });
    expect(resources.attempts).toBe(2);
  });

  it("mounts failed data patch rollback retry routes on the Worker", async () => {
    const resources = { attempts: 0 };
    const log = new InMemoryDataPatchLog();
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
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
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log,
        resources: () => resources,
        clock: fixedClock(now),
        ids: deterministicIds(["claim-apply", "rollback-failed", "rollback-retry"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const applied = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/apply", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(applied.status).toBe(201);

    const failed = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/core.rollback_retry/rollback", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(failed.status).toBe(500);

    const retried = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/core.rollback_retry/rollback-retry", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({
      data: {
        rolledBack: [{ id: "core.rollback_retry", checksum: "v1", rolledBackAt: now, result: { attempts: 2 } }],
        skipped: []
      }
    });
    expect(resources.attempts).toBe(2);
  });

  it("enqueues and consumes app-declared failed rollback retries through Worker jobs", async () => {
    const resources = { attempts: 0, rolledBack: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const queue = new InMemoryJobQueue();
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
          id: "core.rollback_retry",
          checksum: "v1",
          run: () => undefined,
          rollback: {
            run: ({ resources }) => {
              resources.attempts += 1;
              if (resources.attempts === 1) {
                throw new Error("rollback boom");
              }
              resources.rolledBack.push("core");
              return { attempts: resources.attempts };
            }
          }
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log,
        resources: () => resources,
        clock: fixedClock(now),
        ids: deterministicIds(["claim-apply", "rollback-failed", "rollback-retry"])
      },
      jobs: {
        registry: createJobRegistry<any>({
          jobs: [createDataPatchRollbackRetryJob<any>()]
        }),
        queue: () => queue,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-rollback-retry-001"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const applied = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/apply", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(applied.status).toBe(201);
    const failed = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/core.rollback_retry/rollback", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(failed.status).toBe(500);

    const enqueued = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/core.rollback_retry/rollback-retry-enqueue", {
        body: JSON.stringify({ idempotencyKey: "patches:rollback-retry", delaySeconds: 10 }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      env,
      fakeExecutionContext()
    );

    expect(enqueued.status).toBe(202);
    await expect(enqueued.json()).resolves.toMatchObject({
      data: {
        plan: { patchId: "core.rollback_retry" },
        message: {
          tenantId: "acme",
          jobName: "cf-frappe.data-patches.rollback-retry",
          runId: "job_patch-rollback-retry-001",
          idempotencyKey: "patches:rollback-retry",
          payload: { patchId: "core.rollback_retry" }
        }
      }
    });
    expect(resources).toEqual({ attempts: 1, rolledBack: [] });
    const message = queue.queued()[0]!.message;

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "msg_rollback_retry_001",
            timestamp: new Date(now),
            body: message,
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn()
          } as unknown as Message<JobMessage>
        ],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(resources).toEqual({ attempts: 2, rolledBack: ["core"] });
    await expect(log.recordedDataPatches()).resolves.toMatchObject([
      {
        id: "core.rollback_retry",
        checksum: "v1",
        status: "rolled_back",
        rolledBackAt: now,
        rollbackResult: { attempts: 2 }
      }
    ]);
  });

  it("keeps rollback retry enqueue hidden until the retry job is registered on the Worker", async () => {
    const log = new InMemoryDataPatchLog();
    const queue = new InMemoryJobQueue();
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
          id: "core.rollback_retry",
          checksum: "v1",
          run: () => undefined,
          rollback: { run: () => undefined }
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log
      },
      jobs: {
        registry: createJobRegistry<any>({
          jobs: [createDataPatchApplyJob<any>(), createDataPatchRollbackJob<any>()]
        }),
        queue: () => queue,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-001"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const hidden = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/core.rollback_retry/rollback-retry-enqueue", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(hidden.status).toBe(404);
    expect(queue.queued()).toEqual([]);
  });

  it("uses the default D1 data patch journal for app-declared Worker patches", async () => {
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
          id: "core.seed",
          checksum: "v1",
          run: ({ resources }) => ({
            hasQueries: typeof resources.queries?.listDoctypes === "function"
          })
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeDataPatchD1(),
      AGGREGATES: fakeNamespace()
    };

    const applied = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/apply", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(applied.status).toBe(201);
    await expect(applied.json()).resolves.toMatchObject({
      data: {
        applied: [{ id: "core.seed", checksum: "v1", result: { hasQueries: true } }],
        skipped: []
      }
    });

    const dashboard = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches"),
      env,
      fakeExecutionContext()
    );
    expect(dashboard.status).toBe(200);
    await expect(dashboard.json()).resolves.toMatchObject({
      data: {
        totals: { total: 1, applied: 1 },
        patches: [{ id: "core.seed", checksum: "v1", status: "applied", result: { hasQueries: true } }]
      }
    });
  });

  it("enqueues and consumes app-declared data patches through Worker jobs", async () => {
    const resources = { touched: [] as string[], rolledBack: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const queue = new InMemoryJobQueue();
    const checkedResources: string[] = [];
    class NarrowJobResources {
      constructor(readonly custom: string) {}
      describe() {
        return this.custom;
      }
    }
    const jobResources = new NarrowJobResources("narrow");
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
          id: "crm.backfill",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("crm");
            return { touched: resources.touched.length };
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("crm");
              return { rolledBack: resources.rolledBack.length };
            }
          }
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log,
        resources: () => resources,
        clock: fixedClock(now),
        ids: deterministicIds(["claim-1", "rollback-1"])
      },
      jobs: {
        registry: createJobRegistry<any>({
          jobs: [
            createDataPatchApplyJob<any>(),
            createDataPatchRollbackJob<any>(),
            {
              name: "custom.check",
              handler: ({ resources }) => {
                checkedResources.push(
                  resources instanceof NarrowJobResources ? resources.describe() : "flattened"
                );
              }
            }
          ]
        }),
        queue: () => queue,
        resources: () => jobResources,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-001", "patch-rollback-001"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const enqueued = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/enqueue?limit=1", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(enqueued.status).toBe(202);
    await expect(enqueued.json()).resolves.toMatchObject({
      data: {
        plan: { patchIds: ["crm.backfill"], limit: 1 },
        message: {
          tenantId: "acme",
          jobName: "cf-frappe.data-patches.apply",
          runId: "job_patch-001",
          payload: { patchIds: ["crm.backfill"] }
        }
      }
    });
    expect(resources.touched).toEqual([]);
    const message = queue.queued()[0]!.message;

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "msg_001",
            timestamp: new Date(now),
            body: message,
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn()
          } as unknown as Message<JobMessage>
        ],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(resources.touched).toEqual(["crm"]);
    expect(resources.rolledBack).toEqual([]);
    await expect(log.appliedDataPatches()).resolves.toMatchObject([
      { id: "crm.backfill", checksum: "v1", appliedAt: now, result: { touched: 1 } }
    ]);

    const rollbackEnqueued = await worker.fetch!(
      cfRequest("http://localhost/api/data-patches/rollback-enqueue?limit=1", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(rollbackEnqueued.status).toBe(202);
    await expect(rollbackEnqueued.json()).resolves.toMatchObject({
      data: {
        plan: { patchIds: ["crm.backfill"], limit: 1 },
        message: {
          tenantId: "acme",
          jobName: "cf-frappe.data-patches.rollback",
          runId: "job_patch-rollback-001",
          payload: { patchIds: ["crm.backfill"] }
        }
      }
    });
    const rollbackMessage = queue.queued()[1]!.message;

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "msg_rollback_001",
            timestamp: new Date(now),
            body: rollbackMessage,
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn()
          } as unknown as Message<JobMessage>
        ],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(resources.rolledBack).toEqual(["crm"]);
    await expect(log.recordedDataPatches()).resolves.toMatchObject([
      { id: "crm.backfill", checksum: "v1", status: "rolled_back", rolledBackAt: now, rollbackResult: { rolledBack: 1 } }
    ]);

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "msg_002",
            timestamp: new Date(now),
            body: {
              tenantId: "acme",
              jobName: "custom.check",
              payload: {},
              runId: "job_custom",
              idempotencyKey: "custom.check:job_custom",
              enqueuedAt: now,
              metadata: {}
            },
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn()
          } as unknown as Message<JobMessage>
        ],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );
    expect(checkedResources).toEqual(["narrow"]);
  });

  it("mounts app-declared data patch Desk routes on the Worker", async () => {
    const resources = { touched: [] as string[], rollbackAttempts: 0 };
    const log = new InMemoryDataPatchLog();
    const queue = new InMemoryJobQueue();
    const registry = createRegistry({
      dataPatches: [
        defineDataPatch<any>({
          id: "crm.backfill",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("crm");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rollbackAttempts += 1;
              throw new Error("rollback boom");
            }
          }
        })
      ]
    });
    const worker = createCloudFrappeWorker({
      registry,
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      dataPatches: {
        log: () => log,
        resources: () => resources,
        clock: fixedClock(now),
        ids: deterministicIds(["claim-1", "rollback-failed"])
      },
      jobs: {
        registry: createJobRegistry<any>({
          jobs: [
            createDataPatchApplyJob<any>(),
            createDataPatchRollbackJob<any>(),
            createDataPatchRollbackRetryJob<any>()
          ]
        }),
        queue: () => queue,
        clock: fixedClock(now),
        ids: deterministicIds(["desk-patch-001"])
      }
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const dashboard = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/data-patches"),
      env,
      fakeExecutionContext()
    );
    expect(dashboard.status).toBe(200);
    const html = await dashboard.text();
    expect(html).toContain("Data Patches");
    expect(html).toContain("crm.backfill");
    expect(html).toContain('formaction="/desk/admin/data-patches/plan"');
    expect(html).toContain('formaction="/desk/admin/data-patches/enqueue"');
    expect(html).toContain('formaction="/desk/admin/data-patches/crm.backfill/plan"');
    expect(html).toContain('action="/desk/admin/data-patches/crm.backfill/enqueue"');
    expect(html).toContain('formaction="/desk/admin/data-patches/crm.backfill/apply"');

    const enqueued = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/data-patches/enqueue", {
        body: new URLSearchParams({ limit: "1" }),
        method: "POST"
      }),
      env,
      fakeExecutionContext()
    );
    expect(enqueued.status).toBe(303);
    const enqueuedLocation = enqueued.headers.get("location");
    expect(enqueuedLocation).toContain("/desk/admin/data-patches?");
    const enqueuedNotice = await worker.fetch!(
      cfRequest(`http://localhost${enqueuedLocation!}`),
      env,
      fakeExecutionContext()
    );
    expect(enqueuedNotice.status).toBe(200);
    const enqueuedHtml = await enqueuedNotice.text();
    expect(enqueuedHtml).toContain("Enqueued data patch job cf-frappe.data-patches.apply / job_desk-patch-001");
    expect(queue.queued()[0]?.message).toMatchObject({
      tenantId: "acme",
      jobName: "cf-frappe.data-patches.apply",
      runId: "job_desk-patch-001",
      payload: { patchIds: ["crm.backfill"] }
    });
    expect(resources.touched).toEqual([]);

    const planned = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/data-patches/crm.backfill/plan", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(planned.status).toBe(200);
    const plannedHtml = await planned.text();
    expect(plannedHtml).toContain("Planned Patches");
    expect(plannedHtml).toContain("crm.backfill");
    expect(resources.touched).toEqual([]);

    const applied = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/data-patches/crm.backfill/apply", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(applied.status).toBe(303);
    expect(applied.headers.get("location")).toBe("/desk/admin/data-patches");
    expect(resources.touched).toEqual(["crm"]);

    const appliedDashboard = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/data-patches"),
      env,
      fakeExecutionContext()
    );
    expect(appliedDashboard.status).toBe(200);
    const appliedHtml = await appliedDashboard.text();
    expect(appliedHtml).toContain('action="/desk/admin/data-patches/crm.backfill/rollback-enqueue"');

    const failedRollback = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/data-patches/crm.backfill/rollback", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(failedRollback.status).toBe(500);
    const failedRollbackHtml = await failedRollback.text();
    expect(failedRollbackHtml).toContain(
      'action="/desk/admin/data-patches/crm.backfill/rollback-retry-enqueue"'
    );
    expect(resources.rollbackAttempts).toBe(1);
  });

  it("mounts user-permission admin API and Desk routes on the Worker", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const api = await worker.fetch!(
      cfRequest("http://localhost/api/user-permissions/admin%40example.com"),
      env,
      fakeExecutionContext()
    );
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        userId: "admin@example.com",
        grants: []
      }
    });

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/user-permissions?user=admin%40example.com"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    const html = await desk.text();
    expect(html).toContain("User Permissions");
    expect(html).toContain("No grants configured.");
  });

  it("mounts custom-field admin API and Desk routes on the Worker", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace()
    };

    const empty = await worker.fetch!(
      cfRequest("http://localhost/api/custom-fields/Note"),
      env,
      fakeExecutionContext()
    );
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", doctype: "Note", version: 0, fields: [] }
    });

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/custom-fields/Note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: { name: "reviewed", type: "boolean" }, expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/custom-fields?doctype=Note"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    const html = await desk.text();
    expect(html).toContain("Custom Fields");
    expect(html).toContain("reviewed");
    expect(html).toContain('action="/desk/admin/custom-fields/Note/reviewed/disable"');
  });

  it("mounts role catalog API and Desk routes on the Worker", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace()
    };

    const empty = await worker.fetch!(cfRequest("http://localhost/api/roles"), env, fakeExecutionContext());
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", version: 0, roles: [] }
    });

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/roles/Support%20Lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Escalation owner", expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/roles"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    const html = await desk.text();
    expect(html).toContain("Support Lead");
    expect(html).toContain("Escalation owner");
    expect(html).toContain('action="/desk/admin/roles/Support%20Lead/disable"');
  });

  it("uses custom auth admin roles for Worker role catalog administration", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "desk-admin@example.com", roles: ["Desk Admin"], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        adminRoles: ["Desk Admin"]
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    const api = await worker.fetch!(cfRequest("http://localhost/api/roles"), env, fakeExecutionContext());
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toMatchObject({ data: { tenantId: "acme", roles: [] } });

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/roles"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    await expect(desk.text()).resolves.toContain("Create Role");
  });

  it("uses custom auth admin roles for Worker notification inbox inspection", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "desk-admin@example.com", roles: ["Desk Admin"], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        adminRoles: ["Desk Admin"]
      }
    });
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/notifications?user=owner%40example.com"),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { userId: "owner@example.com", notifications: [] }
    });
  });

  it("can validate account roles against the Worker role catalog", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        validateRolesWithCatalog: true,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1"])
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    await worker.fetch!(
      cfRequest("http://localhost/api/roles/User", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );

    const invalid = await worker.fetch!(
      cfRequest("http://localhost/api/users/ghost%40example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret-123", roles: ["Ghost"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        issues: [{ field: "roles", code: "role_not_found" }]
      }
    });

    const valid = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(valid.status).toBe(201);
    await expect(valid.json()).resolves.toMatchObject({ data: { roles: ["User"] } });
  });

  it("can sync Cloudflare Access accounts through Worker auth composition", async () => {
    const signing = await createJwtSigner();
    const worker = createCloudFrappeWorker<CloudFrappeAccessAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "guest", roles: ["Guest"], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-created", "provider-linked"]),
        clock: fixedClock(now),
        cloudflareAccess: {
          teamDomain: (env) => env.CF_ACCESS_TEAM_DOMAIN,
          audience: (env) => env.CF_ACCESS_AUD,
          now: () => 1_000,
          fetchJwks: async () => signing.jwks,
          tenantId: () => "acme",
          roles: () => [SYSTEM_MANAGER_ROLE]
        }
      }
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace(),
      SESSION_SECRET: "edge-secret",
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "desk"
    };
    const token = await signing.sign({
      iss: "https://team.cloudflareaccess.com",
      aud: "desk",
      exp: 2_000,
      nbf: 900,
      sub: "access-subject-1",
      email: "OWNER@EXAMPLE.COM"
    });
    const headers = { "cf-access-jwt-assertion": token };

    const me = await worker.fetch!(cfRequest("http://localhost/api/auth/me", { headers }), env, fakeExecutionContext());
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      data: {
        id: "owner@example.com",
        email: "owner@example.com",
        roles: [SYSTEM_MANAGER_ROLE],
        tenantId: "acme"
      }
    });

    const account = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", { headers }),
      env,
      fakeExecutionContext()
    );
    expect(account.status).toBe(200);
    await expect(account.json()).resolves.toMatchObject({
      data: {
        userId: "owner@example.com",
        version: 2,
        email: "owner@example.com",
        emailVerifiedAt: now,
        providers: [
          {
            provider: "cloudflare-access",
            subject: "access-subject-1"
          }
        ]
      }
    });
  });

  it("prefers Cloudflare Access identity over a conflicting signed session", async () => {
    const signing = await createJwtSigner();
    const staleCookie = await createSignedSessionCookie(
      { id: "stale@example.com", roles: ["User"], tenantId: "acme", email: "stale@example.com" },
      {
        secret: "edge-secret",
        maxAgeSeconds: 60,
        accountVersion: 0,
        secure: false
      }
    );
    const worker = createCloudFrappeWorker<CloudFrappeAccessAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "guest", roles: ["Guest"], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        revalidateSignedSessions: true,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-created", "provider-linked"]),
        clock: fixedClock(now),
        cloudflareAccess: {
          teamDomain: (env) => env.CF_ACCESS_TEAM_DOMAIN,
          audience: (env) => env.CF_ACCESS_AUD,
          now: () => 1_000,
          fetchJwks: async () => signing.jwks,
          tenantId: () => "acme",
          roles: () => [SYSTEM_MANAGER_ROLE]
        }
      }
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace(),
      SESSION_SECRET: "edge-secret",
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "desk"
    };
    const token = await signing.sign({
      iss: "https://team.cloudflareaccess.com",
      aud: "desk",
      exp: 2_000,
      nbf: 900,
      sub: "access-subject-1",
      email: "OWNER@EXAMPLE.COM"
    });

    const me = await worker.fetch!(
      cfRequest("http://localhost/api/auth/me", {
        headers: {
          cookie: staleCookie,
          "cf-access-jwt-assertion": token
        }
      }),
      env,
      fakeExecutionContext()
    );

    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      data: {
        id: "owner@example.com",
        roles: [SYSTEM_MANAGER_ROLE],
        tenantId: "acme"
      }
    });
  });

  it("supports env-backed signed-session actor resolvers in the Worker factory", async () => {
    const cookie = await createSignedSessionCookie(owner, {
      secret: "edge-secret",
      maxAgeSeconds: 60,
      secure: false
    });
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: (request, env) => signedSessionActorResolver({ secret: env.SESSION_SECRET })(request)
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/meta/doctypes/Note", { headers: { cookie } }),
      { DB: fakeD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" },
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { name: "Note" } });
  });

  it("mounts optional account auth routes in the Worker factory", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => owner,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/auth/logout", { method: "POST" }),
      { DB: fakeD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" },
      fakeExecutionContext()
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("cf_frappe_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("mounts account recovery auth routes with Worker auth configuration", async () => {
    const recovery = createInMemoryAccountRecoveryNotifier();
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        recovery,
        ids: deterministicIds(["account-1", "reset-request-1"]),
        recoveryTokens: deterministicIds(["reset-token-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com", password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    const response = await worker.fetch!(
      cfRequest("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { accepted: true } });
    expect(recovery.passwordResetMessages).toEqual([
      {
        tenantId: "acme",
        userId: "owner@example.com",
        email: "owner@example.com",
        token: "tok_reset-token-1",
        expiresAt: "2026-01-01T01:00:00.000Z"
      }
    ]);
  });

  it("mounts user profile API routes with Worker auth configuration", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "profile-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const profile = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/profile", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ fullName: "Ada Lovelace", expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );

    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({
      data: {
        userId: "owner@example.com",
        version: 1,
        profile: { fullName: "Ada Lovelace" }
      }
    });
  });

  it("revalidates signed account sessions before profile routes", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        revalidateSignedSessions: true,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "profile-1", "roles-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    const login = await worker.fetch!(
      cfRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    const profile = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ fullName: "Ada Lovelace", expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(profile.status).toBe(200);
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/roles", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ roles: ["Task Manager"], expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );

    const stale = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/profile", { headers: { cookie } }),
      env,
      fakeExecutionContext()
    );

    expect(stale.status).toBe(403);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });

  it("mounts auth-backed Desk user account administration in the Worker factory", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    const empty = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/users"),
      env,
      fakeExecutionContext()
    );
    expect(empty.status).toBe(200);
    await expect(empty.text()).resolves.toContain("Create User");

    const created = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/users", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          user: "worker@example.com",
          password: "secret-123",
          roles: "User",
          enabled: "true",
          expectedVersion: "0"
        })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/users?user=worker%40example.com");

    const loaded = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/users?user=worker%40example.com"),
      env,
      fakeExecutionContext()
    );
    expect(loaded.status).toBe(200);
    const html = await loaded.text();
    expect(html).toContain("worker@example.com");
    expect(html).toContain('action="/desk/admin/users/disable"');
    expect(html).not.toContain("hash:secret-123");
  });

  it("logs in and revalidates account sessions through Worker auth configuration", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        revalidateSignedSessions: true,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "roles-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const login = await worker.fetch!(
      cfRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(login.status).toBe(200);
    expect(cookie).toContain("cf_frappe_session=");

    const me = await worker.fetch!(
      cfRequest("http://localhost/api/auth/me", { headers: { cookie } }),
      env,
      fakeExecutionContext()
    );
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ data: { id: "owner@example.com", roles: ["User"] } });

    const changed = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/roles", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ roles: ["Task Manager"], expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(changed.status).toBe(200);

    const stale = await worker.fetch!(
      cfRequest("http://localhost/api/auth/me", { headers: { cookie } }),
      env,
      fakeExecutionContext()
    );
    expect(stale.status).toBe(403);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });

  it("revalidates signed account sessions before realtime websocket subscriptions", async () => {
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        revalidateSignedSessions: true,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "password-1"]),
        clock: fixedClock(now)
      },
      realtime: {
        namespace: () => fakeRealtimeNamespace(fetches)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    const login = await worker.fetch!(
      cfRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/password", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-456", expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );

    const stale = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=user:acme:owner%40example.com", {
        headers: { cookie, upgrade: "websocket" }
      }),
      env,
      fakeExecutionContext()
    );

    expect(stale.status).toBe(403);
    expect(fetches).toHaveLength(0);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });
});

interface CloudFrappeAuthTestEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
  readonly SESSION_SECRET: string;
}

interface CloudFrappeAccessAuthTestEnv extends CloudFrappeAuthTestEnv {
  readonly CF_ACCESS_TEAM_DOMAIN: string;
  readonly CF_ACCESS_AUD: string;
}

function fakeNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact() {
          throw new Error("Command path should not be used in this test");
        },
        tryTransact() {
          throw new Error("Command path should not be used in this test");
        }
      };
    }
  };
}

function fakeTransactingNamespace(calls: AggregateCoordinatorCommand[]): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      const transact = (command: AggregateCoordinatorCommand) => {
        calls.push(command);
        const name = "name" in command ? command.name : "My Note";
        return Promise.resolve({
          tenantId: "acme",
          doctype: command.doctype,
          name,
          version: command.kind === "share" ? 2 : 3,
          docstatus: "draft" as const,
          data: { title: name },
          createdAt: now,
          updatedAt: now
        });
      };
      return {
        transact,
        async tryTransact(command: AggregateCoordinatorCommand) {
          return { ok: true as const, snapshot: await transact(command) };
        }
      };
    }
  };
}

function fakeRealtimeNamespace(fetches: Request[]): RealtimeHubNamespace {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        presence() {
          return Promise.resolve({ topic: "", connections: [] });
        },
        publish() {
          return Promise.resolve(0);
        },
        replay() {
          return Promise.resolve({ topic: "", events: [], nextCursor: null });
        },
        fetch(request: Request) {
          fetches.push(request);
          return Promise.resolve(new Response(null, { status: 101 }));
        }
      };
    }
  };
}

function cfRequest(url: string, init?: RequestInit): Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0] {
  return new Request(url, init) as unknown as Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0];
}

function fakeD1(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (sql.includes("FROM cf_frappe_documents")) {
            return { results: [] };
          }
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true };
        }
      };
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

function fakeDocumentD1(name: string): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return {
            tenant_id: "acme",
            doctype: "Note",
            name,
            version: 1,
            docstatus: "draft",
            data_json: JSON.stringify({
              title: name,
              created_by: "owner@example.com",
              priority: "Medium"
            }),
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z"
          };
        },
        async run() {
          return { success: true };
        }
      };
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

function fakeDataPatchD1(): D1Database {
  const rows = new Map<string, MutableDataPatchRow>();
  return {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
          if (sql.includes("FROM cf_frappe_documents")) {
            return { results: [] };
          }
          if (!sql.includes("FROM cf_frappe_data_patches")) {
            return { results: [] };
          }
          const ordered = [...rows.values()].sort((left, right) => left.id.localeCompare(right.id));
          return {
            results: sql.includes("WHERE status = 'applied'")
              ? ordered.filter((row) => row.status === "applied")
              : ordered
          };
        },
        async first() {
          if (!sql.includes("FROM cf_frappe_data_patches")) {
            return null;
          }
          return rows.get(String(this.params[0] ?? "")) ?? null;
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO cf_frappe_data_patches")) {
            const [id, checksum, claimId, claimedAt] = this.params;
            const rowId = String(id);
            if (!rows.has(rowId)) {
              rows.set(rowId, {
                id: rowId,
                checksum: String(checksum),
                status: "pending",
                claim_id: String(claimId),
                claimed_at: String(claimedAt),
                applied_at: null,
                failed_at: null,
                error: null,
                result_json: null,
                result_present: 0
              });
            }
          }
          if (sql.includes("SET status = 'applied'")) {
            const [appliedAt, resultJson, resultPresent, id, checksum, claimId] = this.params;
            const row = rows.get(String(id));
            if (row && row.checksum === checksum && row.claim_id === claimId && row.status === "pending") {
              row.status = "applied";
              row.applied_at = String(appliedAt);
              row.result_json = resultJson === null ? null : String(resultJson);
              row.result_present = Number(resultPresent);
              row.failed_at = null;
              row.error = null;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes("SET status = 'failed'")) {
            const [failedAt, error, id, checksum, claimId] = this.params;
            const row = rows.get(String(id));
            if (row && row.checksum === checksum && row.claim_id === claimId && row.status === "pending") {
              row.status = "failed";
              row.failed_at = String(failedAt);
              row.error = String(error);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes("DELETE FROM cf_frappe_data_patches")) {
            const [id, checksum, claimId, failedAt, error] = this.params;
            const row = rows.get(String(id));
            if (
              row &&
              row.checksum === checksum &&
              row.status === "failed" &&
              row.claim_id === claimId &&
              row.failed_at === failedAt &&
              row.error === error
            ) {
              rows.delete(String(id));
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          return { success: true };
        }
      };
      return statement;
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

interface MutableDataPatchRow {
  readonly id: string;
  readonly checksum: string;
  status: string;
  readonly claim_id: string | null;
  readonly claimed_at: string | null;
  applied_at: string | null;
  failed_at: string | null;
  error: string | null;
  result_json: string | null;
  result_present: number;
}

function fakeEventD1(): D1Database {
  const events: Array<{
    readonly id: string;
    readonly tenant_id: string;
    readonly stream: string;
    readonly sequence: number;
    readonly type: string;
    readonly doctype: string;
    readonly document_name: string;
    readonly actor_id: string;
    readonly occurred_at: string;
    readonly payload_json: string;
    readonly metadata_json: string;
  }> = [];
  return {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
          if (!sql.includes("FROM cf_frappe_events")) {
            return { results: [] };
          }
          const stream = String(this.params[0] ?? "");
          const maxSequence = sql.includes("sequence <= ?") ? Number(this.params[1]) : undefined;
          const limit = sql.includes("LIMIT ?") ? Number(this.params.at(-1)) : undefined;
          const ordered = events
            .filter((event) => event.stream === stream)
            .filter((event) => maxSequence === undefined || event.sequence <= maxSequence)
            .sort((left, right) => sql.includes("ORDER BY sequence DESC") ? right.sequence - left.sequence : left.sequence - right.sequence);
          return { results: limit === undefined ? ordered : ordered.slice(0, limit) };
        },
        async first() {
          if (sql.includes("COALESCE(MAX(sequence), 0)")) {
            const stream = String(this.params[0] ?? "");
            return {
              version: events
                .filter((event) => event.stream === stream)
                .reduce((version, event) => Math.max(version, event.sequence), 0)
            };
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO cf_frappe_events")) {
            const [
              id,
              tenantId,
              stream,
              sequence,
              type,
              doctype,
              documentName,
              actorId,
              occurredAt,
              payloadJson,
              metadataJson
            ] = this.params;
            events.push({
              id: String(id),
              tenant_id: String(tenantId),
              stream: String(stream),
              sequence: Number(sequence),
              type: String(type),
              doctype: String(doctype),
              document_name: String(documentName),
              actor_id: String(actorId),
              occurred_at: String(occurredAt),
              payload_json: String(payloadJson),
              metadata_json: String(metadataJson)
            });
          }
          return { success: true };
        }
      };
      return statement;
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

interface JwtSigner {
  readonly jwks: CloudflareAccessJwks;
  sign(claims: CloudflareAccessJwtClaims): Promise<string>;
}

async function createJwtSigner(kid = "test-key"): Promise<JwtSigner> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid,
    alg: "RS256",
    use: "sig"
  };
  return {
    jwks: { keys: [publicJwk] },
    async sign(claims) {
      const header = { alg: "RS256", typ: "JWT", kid };
      const headerPart = base64UrlJson(header);
      const payloadPart = base64UrlJson(claims);
      const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        keyPair.privateKey,
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      );
      return `${headerPart}.${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
    }
  };
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function deterministicPasswords(): PasswordHasher {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hash:${password}`;
    }
  };
}

function fakeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
