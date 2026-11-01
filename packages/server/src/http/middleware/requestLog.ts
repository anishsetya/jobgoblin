// One log line per request: method, path, status and how long it took. Never the query string, the body
// or any header, because those can hold the session token or the person's details.
// Spec: ARCHITECTURE.md section 11 ("Logs redact the Authorization header and profile values").
import type { MiddlewareHandler } from "hono";
import type { ServerContext } from "../../context";

export function requestLog(ctx: ServerContext): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    await next();
    const fields = { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - startedAt };
    if (c.res.status >= 500) ctx.logger.warn(fields, "request");
    else ctx.logger.debug(fields, "request");
  };
}
