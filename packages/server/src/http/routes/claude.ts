// The person's Claude Code, seen from the dashboard's Connect step:
//   GET  /api/claude/status    is it installed, new enough and signed in with a Claude plan?
//   POST /api/claude/install   run the install command (the dashboard shows it first), then answer with the status
//   POST /api/claude/sign-in   run `claude auth login`, wait for it, answer with the status
// A successful sign-in also starts a queue that was paused because a run found Claude signed out.
// Spec: ARCHITECTURE.md section 10 (Claude Code CLI) and decision D21.
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { createClaudeCli } from "../../runner/claudeCli";

export function claudeRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();
  const claudeCli = createClaudeCli({
    claudeCommand: ctx.options.claudeCommand,
    claudeInstallCommand: ctx.options.claudeInstallCommand,
  });

  routes.get("/status", async (c) => c.json(await claudeCli.status()));
  routes.post("/install", async (c) => c.json(await claudeCli.install()));
  routes.post("/sign-in", async (c) => {
    const status = await claudeCli.signIn();
    if (status.state === "connected") ctx.launcher?.resume();
    return c.json(status);
  });

  return routes;
}
