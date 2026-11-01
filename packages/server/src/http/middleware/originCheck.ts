// The Origin check: a browser sends Origin on requests that a web page makes. It must be missing (a program
// or a plain navigation), the server's own address, or the dashboard dev server's address (devOrigin).
// Threat stopped: a website the person visits calling this server with fetch(). No CORS headers are sent, so
// the browser would also refuse to show such a page the answer, but the request itself is stopped here.
// Spec: ARCHITECTURE.md section 11 (originCheck).
import type { MiddlewareHandler } from "hono";
import type { ServerContext } from "../../context";
import { apiError } from "../errorHandler";

export function originCheck(ctx: ServerContext): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !allowedOrigins(ctx).includes(origin.toLowerCase())) {
      return c.json(
        apiError("forbidden-origin", "Jobgoblin does not accept requests from other websites.", "Use Jobgoblin from its own window."),
        403,
      );
    }
    await next();
  };
}

function allowedOrigins(ctx: ServerContext): string[] {
  const own = [`http://127.0.0.1:${ctx.port}`, `http://localhost:${ctx.port}`];
  const dev = ctx.options.devOrigin === null ? [] : [ctx.options.devOrigin.toLowerCase().replace(/\/+$/, "")];
  return [...own, ...dev];
}
