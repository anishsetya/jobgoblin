// The Host check: a request must be addressed to 127.0.0.1:<port> or localhost:<port>.
// Threat stopped: DNS rebinding. A website can point its own name at 127.0.0.1 and then call this server from
// the visitor's browser; such a request carries the website's name in Host and is refused here, whatever
// else it sends. It applies to every request, including the dashboard's own files.
// Spec: ARCHITECTURE.md section 11 (hostCheck).
import type { MiddlewareHandler } from "hono";
import type { ServerContext } from "../../context";
import { apiError } from "../errorHandler";

export function hostCheck(ctx: ServerContext): MiddlewareHandler {
  return async (c, next) => {
    const allowedHosts = [`127.0.0.1:${ctx.port}`, `localhost:${ctx.port}`];
    const host = c.req.header("host");
    if (host === undefined || !allowedHosts.includes(host.toLowerCase())) {
      return c.json(
        apiError("forbidden-host", "Jobgoblin only answers requests sent to this computer.", "Open Jobgoblin from its own window."),
        403,
      );
    }
    await next();
  };
}
