import { Hono } from "hono";
import type { UserNotificationService } from "../../application/user-notification-service.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger, requestMetadata } from "./request.js";

export interface NotificationApiOptions {
  readonly notifications: UserNotificationService;
  readonly actor: ActorResolver;
}

export function createNotificationApi(options: NotificationApiOptions): Hono {
  const app = new Hono();

  app.get("/api/notifications", async (c) => {
    const actor = await options.actor(c.req.raw);
    const userId = c.req.query("user");
    const limit = parseOptionalInteger(c.req.query("limit"));
    const data = await options.notifications.inbox(actor, {
      ...(userId === undefined ? {} : { userId }),
      ...(limit === undefined ? {} : { limit }),
      unreadOnly: truthyQuery(c.req.query("unread")),
      includeDismissed: truthyQuery(c.req.query("include_dismissed"))
    });
    return c.json({ data });
  });

  app.post("/api/notifications/:notificationId/read", async (c) => {
    const actor = await options.actor(c.req.raw);
    const userId = c.req.query("user");
    const data = await options.notifications.markRead(actor, c.req.param("notificationId"), {
      ...(userId === undefined ? {} : { userId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/notifications/:notificationId/dismiss", async (c) => {
    const actor = await options.actor(c.req.raw);
    const userId = c.req.query("user");
    const data = await options.notifications.dismiss(actor, c.req.param("notificationId"), {
      ...(userId === undefined ? {} : { userId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function truthyQuery(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
