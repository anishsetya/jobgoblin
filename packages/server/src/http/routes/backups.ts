// Backups: GET /api/backups, POST /api/backups (back up now), POST /api/backups/:id/restore.
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { backupNow, listBackups, restoreBackup } from "../../services/backups";

export function backupRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.get("/backups", (c) => c.json(listBackups(ctx)));
  routes.post("/backups", (c) => c.json(backupNow(ctx)));
  routes.post("/backups/:id/restore", (c) => c.json(restoreBackup(ctx, c.req.param("id"))));

  return routes;
}
