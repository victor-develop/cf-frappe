import { Hono } from "hono";
import type { CalendarService } from "../../application/calendar-service.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger } from "./request.js";

export interface CalendarApiOptions {
  readonly calendars: CalendarService;
  readonly actor: ActorResolver;
}

export function createCalendarApi(options: CalendarApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/calendars", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.calendars.listCalendars(actor) });
  });

  app.get("/api/meta/calendars/:calendar", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.calendars.getCalendar(actor, c.req.param("calendar")) });
  });

  app.get("/api/calendar/:calendar/run", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    return c.json({
      data: await options.calendars.runCalendar(actor, c.req.param("calendar"), {
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
        ...(limit === undefined ? {} : { limit })
      })
    });
  });

  return app;
}
