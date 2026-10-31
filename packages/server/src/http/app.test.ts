import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@jobgoblin/schemas";
import { closeTestContexts, createTestApp, TEST_PORT, TEST_SESSION_TOKEN } from "./testSupport";

afterEach(closeTestContexts);

// Every route the app has under /api, with a made-up id in place of each ":id".
function apiRoutes(app: ReturnType<typeof createTestApp>["app"]): { method: string; path: string }[] {
  const seen = new Set<string>();
  const routes: { method: string; path: string }[] = [];
  for (const route of app.routes) {
    if (route.method === "ALL" || !route.path.startsWith("/api/")) continue;
    const path = route.path.replace(/:[a-zA-Z]+/g, "some-id");
    const key = `${route.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method: route.method, path });
  }
  return routes;
}

describe("authentication on /api", () => {
  it("covers every route in the API table", () => {
    const { app } = createTestApp();

    const routes = apiRoutes(app).map((route) => `${route.method} ${route.path}`);

    expect(routes.length).toBeGreaterThanOrEqual(36);
    expect(routes).toEqual(
      expect.arrayContaining([
        "GET /api/today",
        "POST /api/jobs",
        "GET /api/pipeline",
        "GET /api/apps/some-id",
        "GET /api/apps/some-id/resume.pdf",
        "POST /api/apps/some-id/approve",
        "POST /api/apps/some-id/submitted",
        "POST /api/runs",
        "DELETE /api/runs/some-id",
        "GET /api/events",
        "POST /api/questions/some-id/answer",
        "PUT /api/profile/some-id",
        "POST /api/import-resume",
        "PUT /api/settings",
        "POST /api/backups/some-id/restore",
        "GET /api/export/csv",
        "POST /api/open",
      ]),
    );
  });

  it("answers 401 to every /api route when there is no token", async () => {
    const { app, call } = createTestApp();

    for (const route of apiRoutes(app)) {
      const response = await call(route.path, { method: route.method, token: null });
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
      expect(ApiError.safeParse(await response.json()).success).toBe(true);
    }
  });

  it("answers 401 to every /api route when the token is wrong", async () => {
    const { app, call } = createTestApp();

    for (const route of apiRoutes(app)) {
      const response = await call(route.path, { method: route.method, token: `${TEST_SESSION_TOKEN}x` });
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("answers 401 for an unknown /api path too, so nothing is learned without the token", async () => {
    const { call } = createTestApp();

    expect((await call("/api/does-not-exist", { token: null })).status).toBe(401);
  });

  it("lets the session token through", async () => {
    const { call } = createTestApp();

    expect((await call("/api/today")).status).toBe(200);
  });

  it("refuses a run token on /api", async () => {
    const { ctx, call } = createTestApp();
    const runToken = ctx.runTokens.issue("run-1");

    expect((await call("/api/today", { token: runToken })).status).toBe(401);
  });
});

describe("authentication on /mcp", () => {
  it("refuses the session token", async () => {
    const { call } = createTestApp();

    const response = await call("/mcp", { method: "POST", token: TEST_SESSION_TOKEN });

    expect(response.status).toBe(401);
  });

  it("refuses a request with no token or an unknown one", async () => {
    const { call } = createTestApp();

    expect((await call("/mcp", { method: "POST", token: null })).status).toBe(401);
    expect((await call("/mcp", { method: "POST", token: "unknown" })).status).toBe(401);
    expect((await call("/mcp/anything", { method: "POST", token: TEST_SESSION_TOKEN })).status).toBe(401);
  });

  it("lets a live run's token past the check (the endpoint itself is mounted by the launcher)", async () => {
    const { ctx, call } = createTestApp();
    const runToken = ctx.runTokens.issue("run-1");

    const response = await call("/mcp", { method: "POST", token: runToken });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not-available" });
  });

  it("refuses a run token after the run ended", async () => {
    const { ctx, call } = createTestApp();
    const runToken = ctx.runTokens.issue("run-1");
    ctx.runTokens.revoke("run-1");

    expect((await call("/mcp", { method: "POST", token: runToken })).status).toBe(401);
  });
});

describe("the Host check", () => {
  it("refuses another website's name, even with a valid token", async () => {
    const { call } = createTestApp();

    const response = await call("/api/today", { host: `evil.example.com:${TEST_PORT}` });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden-host" });
  });

  it("refuses a missing Host, a wrong port and a look-alike name", async () => {
    const { call } = createTestApp();

    expect((await call("/api/today", { host: null })).status).toBe(403);
    expect((await call("/api/today", { host: "127.0.0.1:1" })).status).toBe(403);
    expect((await call("/api/today", { host: `127.0.0.1.evil.example:${TEST_PORT}` })).status).toBe(403);
  });

  it("accepts localhost on the right port", async () => {
    const { call } = createTestApp();

    expect((await call("/api/today", { host: `localhost:${TEST_PORT}` })).status).toBe(200);
  });

  it("also protects the dashboard's own files", async () => {
    const { call } = createTestApp();

    expect((await call("/", { token: null, host: "evil.example.com" })).status).toBe(403);
  });
});

describe("the Origin check", () => {
  it("refuses a request from another website", async () => {
    const { call } = createTestApp();

    const response = await call("/api/today", { origin: "https://evil.example.com" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden-origin" });
  });

  it("refuses the opaque origin 'null' that sandboxed pages send", async () => {
    const { call } = createTestApp();

    expect((await call("/api/today", { origin: "null" })).status).toBe(403);
  });

  it("accepts a request with no Origin and one from the server's own address", async () => {
    const { call } = createTestApp();

    expect((await call("/api/today")).status).toBe(200);
    expect((await call("/api/today", { origin: `http://127.0.0.1:${TEST_PORT}` })).status).toBe(200);
    expect((await call("/api/today", { origin: `http://localhost:${TEST_PORT}` })).status).toBe(200);
  });

  it("accepts the dashboard dev server only when it is configured", async () => {
    const { ctx, call } = createTestApp();
    const devOrigin = "http://localhost:5173";

    expect((await call("/api/today", { origin: devOrigin })).status).toBe(403);
    ctx.options.devOrigin = devOrigin;
    expect((await call("/api/today", { origin: devOrigin })).status).toBe(200);
  });
});

describe("the error shape", () => {
  it("answers a refusal from a service with its own plain words", async () => {
    const { call } = createTestApp();

    const response = await call("/api/apps/nope");

    expect(response.status).toBe(404);
    expect(ApiError.parse(await response.json())).toMatchObject({ code: "not-found", message: expect.stringContaining("application") });
  });

  it("answers a body that is not valid JSON with invalid-request", async () => {
    const { call } = createTestApp();

    const response = await call("/api/jobs", { method: "POST", body: "{not json", headers: { "Content-Type": "application/json" } });

    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).code).toBe("invalid-request");
  });

  it("turns a schema failure into invalid-request, with the schema's own plain words", async () => {
    const { call } = createTestApp();

    const response = await call("/api/jobs", { method: "POST", json: { text: "A job", title: "Engineer" } });

    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json())).toMatchObject({ code: "invalid-request", message: expect.stringContaining("Add the company name.") });
  });

  it("answers an unknown /api path with the token as a 404 in the same shape", async () => {
    const { call } = createTestApp();

    const response = await call("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(ApiError.parse(await response.json()).code).toBe("not-found");
  });

  it("maps a move the state machine forbids to 409", async () => {
    const { call } = createTestApp();
    const created = await call("/api/jobs", { method: "POST", json: { company: "Gridline", title: "Engineer", text: "Python. 2 years." } });
    const { applicationId } = (await created.json()) as { applicationId: string };

    const response = await call(`/api/apps/${applicationId}/status`, { method: "POST", json: { to: "Applied" } });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).code).toBe("invalid-transition");
  });

  it("never shows a stack trace or the error text of something unexpected", async () => {
    const { app, ctx, call } = createTestApp();
    app.get("/api/boom", () => {
      throw new Error("secret detail at C:\\Users\\someone\\file.ts");
    });
    ctx.logger.level = "silent";

    const response = await call("/api/boom");

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(ApiError.parse(JSON.parse(text))).toMatchObject({ code: "internal-error" });
    expect(text).not.toContain("secret detail");
    expect(text).not.toContain("at ");
  });

  it("answers a request that is too large with 413", async () => {
    const { call } = createTestApp();

    const response = await call("/api/jobs", { method: "POST", body: new Uint8Array(12 * 1024 * 1024), headers: { "Content-Type": "application/json" } });

    expect(response.status).toBe(413);
    expect(ApiError.parse(await response.json()).code).toBe("too-large");
  });
});

describe("security headers", () => {
  it("are on every answer, including refusals", async () => {
    const { call } = createTestApp();

    for (const response of [await call("/api/today"), await call("/api/today", { token: null }), await call("/api/today", { host: "evil" })]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });
});
