// Settings: GET/PUT /api/settings and POST /api/settings/folder.
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { chooseFolder, getSettingsResponse, updateSettings } from "../../services/settings";
import { PathBody, SettingsChangesBody } from "../requestBodies";
import { parseJsonBody } from "../validation";

export function settingsRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.get("/settings", (c) => c.json(getSettingsResponse(ctx)));
  routes.put("/settings", async (c) => c.json(updateSettings(ctx, await parseJsonBody(c, SettingsChangesBody))));
  routes.post("/settings/folder", async (c) => {
    const { path } = await parseJsonBody(c, PathBody);
    return c.json(chooseFolder(ctx, path));
  });

  return routes;
}
