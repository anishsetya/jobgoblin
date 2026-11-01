// Builds the Hono app. A request passes through, in this order:
//   hostCheck -> originCheck -> auth -> route (zod validation) -> errorHandler
// Routes live one file per area in ./routes and call the services; the dashboard's own files come last.
// /api/claude (the person's Claude Code) is one more area under /api; /mcp is the door for Claude Code runs.
// Spec: ARCHITECTURE.md section 11.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ServerContext } from "../context";
import { apiError, createErrorHandler } from "./errorHandler";
import { auth, type AuthVariables } from "./middleware/auth";
import { hostCheck } from "./middleware/hostCheck";
import { originCheck } from "./middleware/originCheck";
import { requestLog } from "./middleware/requestLog";
import { securityHeaders } from "./middleware/securityHeaders";
import { mcpRoutes } from "../mcp/endpoint";
import { applicationRoutes } from "./routes/applications";
import { backupRoutes } from "./routes/backups";
import { claudeRoutes } from "./routes/claude";
import { eventRoutes } from "./routes/events";
import { exportRoutes } from "./routes/export";
import { jobsRoutes } from "./routes/jobs";
import { openRoutes } from "./routes/open";
import { pipelineRoutes } from "./routes/pipeline";
import { profileRoutes } from "./routes/profile";
import { questionRoutes } from "./routes/questions";
import { runRoutes } from "./routes/runs";
import { settingsRoutes } from "./routes/settings";
import { setupRoutes } from "./routes/setup";
import { storyRoutes } from "./routes/story";
import { todayRoutes } from "./routes/today";
import { serveDashboardFile } from "./static";

export type AppEnv = { Variables: Partial<AuthVariables> };

// A resume upload is at most 10 MB; the rest of a multipart request is small.
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;

export function createApp(ctx: ServerContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestLog(ctx), securityHeaders(), hostCheck(ctx), originCheck(ctx), auth(ctx));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => c.json(apiError("too-large", "That is larger than Jobgoblin accepts.", "Choose a smaller file."), 413),
    }),
  );

  mountApi(app, ctx);

  // The door for Claude Code runs. The auth middleware above has already checked the run token and set
  // c.get("runId"); the session token is refused here.
  app.route("/mcp", mcpRoutes(ctx));

  // Anything else: the dashboard's files for a page request, a plain 404 for the rest.
  app.notFound((c) => {
    const isPageRequest = (c.req.method === "GET" || c.req.method === "HEAD") && !c.req.path.startsWith("/api");
    if (isPageRequest) return serveDashboardFile(ctx.resourcesDir, c.req.path);
    return c.json(apiError("not-found", "Jobgoblin does not have that.", "Check the address and try again."), 404);
  });
  app.onError(createErrorHandler(ctx));
  return app;
}

function mountApi(app: Hono<AppEnv>, ctx: ServerContext): void {
  app.route("/api", todayRoutes(ctx));
  app.route("/api", jobsRoutes(ctx));
  app.route("/api", pipelineRoutes(ctx));
  app.route("/api", applicationRoutes(ctx));
  app.route("/api", runRoutes(ctx));
  app.route("/api", eventRoutes(ctx));
  app.route("/api", questionRoutes(ctx));
  app.route("/api", profileRoutes(ctx));
  app.route("/api", storyRoutes(ctx));
  app.route("/api", setupRoutes(ctx));
  app.route("/api", settingsRoutes(ctx));
  app.route("/api", backupRoutes(ctx));
  app.route("/api", exportRoutes(ctx));
  app.route("/api", openRoutes(ctx));
  app.route("/api/claude", claudeRoutes(ctx));
}
