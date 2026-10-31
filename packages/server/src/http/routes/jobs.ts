// POST /api/jobs: add a job from a pasted link or text.
import { AddJobRequest } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { addPastedJob } from "../../services/jobs";
import { parseJsonBody } from "../validation";

export function jobsRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();
  routes.post("/jobs", async (c) => c.json(await addPastedJob(ctx, await parseJsonBody(c, AddJobRequest))));
  return routes;
}
