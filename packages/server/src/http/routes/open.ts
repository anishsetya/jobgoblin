// POST /api/open { path }: open a file or folder inside the person's folder (see services/openPath.ts).
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { openPath } from "../../services/openPath";
import { PathBody } from "../requestBodies";
import { parseJsonBody } from "../validation";

export function openRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.post("/open", async (c) => {
    const { path } = await parseJsonBody(c, PathBody);
    return c.json(openPath(ctx, path));
  });

  return routes;
}
