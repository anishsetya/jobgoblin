// Runs: POST /api/runs (Find jobs), POST /api/runs/:id/retry and /dismiss, DELETE /api/runs/:id (cancel).
import { StartRunRequest } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { cancelRun, dismissRun, retryRun, startHunt } from "../../services/runs";
import { parseJsonBody } from "../validation";

export function runRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.post("/runs", async (c) => {
    await parseJsonBody(c, StartRunRequest); // only { kind: "hunt" } is accepted
    return c.json(startHunt(ctx));
  });
  routes.post("/runs/:id/retry", (c) => c.json(retryRun(ctx, c.req.param("id"))));
  routes.post("/runs/:id/dismiss", (c) => c.json(dismissRun(ctx, c.req.param("id"))));
  routes.delete("/runs/:id", async (c) => c.json(await cancelRun(ctx, c.req.param("id"))));

  return routes;
}
