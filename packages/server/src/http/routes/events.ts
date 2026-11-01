// GET /api/events: server-sent events (run progress, status changes, new Needs you items).
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { serverEventResponse } from "../sse";

export function eventRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();
  routes.get("/events", (c) => serverEventResponse(ctx.bus, c.req.raw.signal));
  return routes;
}
