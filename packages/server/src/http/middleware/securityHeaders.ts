// Headers on every answer that make a browser safer with the dashboard: no sniffing of file types, no
// framing of the dashboard inside another page, no <base> tricks or plug-ins, and no referrer sent out.
// (No Content-Security-Policy for scripts: the dashboard's build decides what it loads, and a wrong policy
// would blank the screen; the dashboard never renders posting text as HTML.)
// Spec: ARCHITECTURE.md section 11 and 12 ("No dangerouslySetInnerHTML anywhere").
import type { MiddlewareHandler } from "hono";

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  };
}
