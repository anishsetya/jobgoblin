// GET /api/today: what needs the person, what is running, what got done today.
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { getToday } from "../../services/today";

export function todayRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();
  routes.get("/today", (c) => c.json(getToday(ctx)));
  return routes;
}
