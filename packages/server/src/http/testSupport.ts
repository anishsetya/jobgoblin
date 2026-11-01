// Helpers for the HTTP tests only: an app over a test context, and one function that sends a request the
// way the dashboard does (Host of this server, the session token) unless a test changes a part of it.
import type { Hono } from "hono";
import type { ServerContext } from "../context";
import { closeTestContexts, createTestContext, TEST_PORT, TEST_SESSION_TOKEN } from "../services/testSupport";
import { createApp, type AppEnv } from "./app";

export { closeTestContexts, TEST_PORT, TEST_SESSION_TOKEN };

export type TestApp = { app: Hono<AppEnv>; ctx: ServerContext; call: Caller };

export type CallOptions = {
  method?: string;
  token?: string | null; // null sends no Authorization header; the default is the session token
  host?: string | null; // null sends no Host header
  origin?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: RequestInit["body"];
};

export type Caller = (path: string, options?: CallOptions) => Promise<Response>;

export function createTestApp(contextOptions: Parameters<typeof createTestContext>[0] = {}): TestApp {
  const ctx = createTestContext(contextOptions);
  const app = createApp(ctx);

  const call: Caller = (path, options = {}) => {
    const headers = new Headers(options.headers);
    const token = options.token === undefined ? TEST_SESSION_TOKEN : options.token;
    const host = options.host === undefined ? `127.0.0.1:${TEST_PORT}` : options.host;
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    if (host !== null) headers.set("Host", host);
    if (options.origin !== undefined) headers.set("Origin", options.origin);
    if (options.json !== undefined) headers.set("Content-Type", "application/json");

    return Promise.resolve(
      app.request(`http://127.0.0.1:${TEST_PORT}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      }),
    );
  };
  return { app, ctx, call };
}
