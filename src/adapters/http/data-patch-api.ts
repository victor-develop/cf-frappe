import { Hono } from "hono";
import type { DataPatchAdminPort, DataPatchApplyOptions } from "../../application/data-patch-service.js";
import { badRequest } from "../../core/errors.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject } from "./request.js";

export interface DataPatchApiOptions {
  readonly dataPatches: DataPatchAdminPort;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createDataPatchApi(options: DataPatchApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/data-patches", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.dataPatches.dashboard(actor);
    return c.json({ data });
  });

  app.post("/api/data-patches/apply", async (c) => {
    const actor = await options.actor(c.req.raw);
    const applyOptions = await dataPatchApplyOptions(c.req.raw, maxJsonBytes);
    const data = await options.dataPatches.apply(actor, applyOptions);
    return c.json({ data }, 201);
  });

  app.post("/api/data-patches/:id/apply", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.dataPatches.apply(actor, { patchIds: [c.req.param("id")] });
    return c.json({ data }, 201);
  });

  return app;
}

async function dataPatchApplyOptions(request: Request, maxJsonBytes: number): Promise<DataPatchApplyOptions> {
  const url = new URL(request.url);
  const body = await readJsonObject(request, { allowEmpty: true, maxJsonBytes });
  const patchIds = parsePatchIds(body.patchIds);
  const limitValue = Object.hasOwn(body, "limit") ? body.limit : url.searchParams.get("limit") ?? undefined;
  const limit = parseApplyLimit(limitValue);
  return {
    ...(patchIds === undefined ? {} : { patchIds }),
    ...(limit === undefined ? {} : { limit })
  };
}

function parsePatchIds(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item !== "")) {
    throw badRequest("patchIds must be a non-empty array of data patch ids");
  }
  return value;
}

function parseApplyLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw badRequest("Data patch apply limit must be a positive integer");
  }
  const limit = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Data patch apply limit must be a positive integer");
  }
  return limit;
}
