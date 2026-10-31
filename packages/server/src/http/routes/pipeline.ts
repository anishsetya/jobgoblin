// GET /api/pipeline?status=&band=&search=&overdueOnly=1: the Pipeline list.
// status and band may be repeated or comma-separated; a value that is not a real status or band is refused.
import { PipelineQuery } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { listPipeline } from "../../services/pipeline";
import { listQueryValue } from "../validation";

export function pipelineRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.get("/pipeline", (c) => {
    const search = c.req.query("search");
    const query = PipelineQuery.parse({
      status: listQueryValue(c, "status"),
      band: listQueryValue(c, "band"),
      search: search === undefined || search.trim() === "" ? undefined : search,
      overdueOnly: c.req.query("overdueOnly") === "1" ? true : undefined,
    });
    return c.json(listPipeline(ctx, query));
  });

  return routes;
}
