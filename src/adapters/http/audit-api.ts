import { Hono } from "hono";
import type { AuditService } from "../../application/audit-service";
import type { ActorResolver } from "./actor";
import { parseOptionalInteger } from "./request";

export interface AuditApiOptions {
  readonly audit: AuditService;
  readonly actor: ActorResolver;
}

export function createAuditApi(options: AuditApiOptions): Hono {
  const app = new Hono();

  app.get("/api/audit/events", async (c) => {
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const tenantId = c.req.query("tenant");
    const doctype = c.req.query("doctype");
    const name = c.req.query("name");
    const actorId = c.req.query("actor_id");
    const kind = c.req.query("kind");
    const since = c.req.query("since");
    const until = c.req.query("until");
    const data = await options.audit.search(actor, {
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(doctype !== undefined ? { doctype } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(actorId !== undefined ? { actorId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
      ...(limit !== undefined ? { limit } : {})
    });
    return c.json({ data });
  });

  return app;
}
