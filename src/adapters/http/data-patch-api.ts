import { Hono } from "hono";
import type { DataPatchAdminPort, DataPatchApplyOptions } from "../../application/data-patch-service.js";
import type { DataPatchQueueOptions, DataPatchQueuePort } from "../../application/data-patch-jobs.js";
import { badRequest } from "../../core/errors.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject } from "./request.js";

export interface DataPatchApiOptions {
  readonly dataPatches: DataPatchAdminPort;
  readonly dataPatchQueue?: DataPatchQueuePort;
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

  app.post("/api/data-patches/plan", async (c) => {
    const actor = await options.actor(c.req.raw);
    const applyOptions = await dataPatchApplyOptions(c.req.raw, maxJsonBytes);
    const data = await options.dataPatches.planApply(actor, applyOptions);
    return c.json({ data });
  });

  app.post("/api/data-patches/apply", async (c) => {
    const actor = await options.actor(c.req.raw);
    const applyOptions = await dataPatchApplyOptions(c.req.raw, maxJsonBytes);
    const data = await options.dataPatches.apply(actor, applyOptions);
    return c.json({ data }, 201);
  });

  app.post("/api/data-patches/:id/plan", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.dataPatches.planApply(actor, { patchIds: [c.req.param("id")] });
    return c.json({ data });
  });

  app.post("/api/data-patches/:id/apply", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.dataPatches.apply(actor, { patchIds: [c.req.param("id")] });
    return c.json({ data }, 201);
  });

  if (options.dataPatchQueue) {
    app.post("/api/data-patches/enqueue", async (c) => {
      const actor = await options.actor(c.req.raw);
      const enqueueOptions = await dataPatchQueueOptions(c.req.raw, maxJsonBytes);
      const data = await options.dataPatchQueue!.enqueue(actor, enqueueOptions);
      return c.json({ data }, 202);
    });

    app.post("/api/data-patches/:id/enqueue", async (c) => {
      const actor = await options.actor(c.req.raw);
      const enqueueOptions = await dataPatchQueueOptions(c.req.raw, maxJsonBytes, { includePatchIds: false });
      const data = await options.dataPatchQueue!.enqueue(actor, {
        ...enqueueOptions,
        patchIds: [c.req.param("id")]
      });
      return c.json({ data }, 202);
    });
  }

  return app;
}

async function dataPatchApplyOptions(request: Request, maxJsonBytes: number): Promise<DataPatchApplyOptions> {
  const url = new URL(request.url);
  const body = await readJsonObject(request, { allowEmpty: true, maxJsonBytes });
  return dataPatchApplyOptionsFromBody(url, body, { includePatchIds: true });
}

function dataPatchApplyOptionsFromBody(
  url: URL,
  body: Record<string, unknown>,
  options: { readonly includePatchIds: boolean }
): DataPatchApplyOptions {
  const patchIds = options.includePatchIds ? parsePatchIds(body.patchIds) : undefined;
  const limitValue = Object.hasOwn(body, "limit") ? body.limit : url.searchParams.get("limit") ?? undefined;
  const limit = parseApplyLimit(limitValue);
  return {
    ...(patchIds === undefined ? {} : { patchIds }),
    ...(limit === undefined ? {} : { limit })
  };
}

async function dataPatchQueueOptions(
  request: Request,
  maxJsonBytes: number,
  options: { readonly includePatchIds?: boolean } = {}
): Promise<DataPatchQueueOptions> {
  const url = new URL(request.url);
  const body = await readJsonObject(request, { allowEmpty: true, maxJsonBytes });
  const apply = dataPatchApplyOptionsFromBody(url, body, { includePatchIds: options.includePatchIds ?? true });
  const idempotencyKey = parseOptionalNonEmptyString(body.idempotencyKey, "idempotencyKey");
  const delayValue = Object.hasOwn(body, "delaySeconds") ? body.delaySeconds : undefined;
  const delaySeconds = parseDelaySeconds(delayValue);
  return {
    ...apply,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(delaySeconds === undefined ? {} : { delaySeconds })
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

function parseDelaySeconds(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw badRequest("Data patch enqueue delaySeconds must be a non-negative integer");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw badRequest("Data patch enqueue delaySeconds must be a non-negative integer");
  }
  return value;
}

function parseOptionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}
