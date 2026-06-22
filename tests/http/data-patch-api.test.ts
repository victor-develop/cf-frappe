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
});
