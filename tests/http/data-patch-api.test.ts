import {
  createResourceApi,
  DataPatchService,
  defineDataPatch,
  deterministicIds,
  fixedClock,
  InMemoryDataPatchLog,
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
  });
});
