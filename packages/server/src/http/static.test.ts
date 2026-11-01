import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentTypeOf, resolveInside, serveDashboardFile } from "./static";
import { closeTestContexts, createTestApp } from "./testSupport";

afterEach(closeTestContexts);

// A resources folder with a built dashboard and, next to it, a file the server must never hand out.
function makeResources(): string {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-static-"));
  const dist = path.join(resources, "apps", "dashboard", "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Jobgoblin</title>");
  fs.writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log('app');");
  fs.writeFileSync(path.join(dist, "assets", "style-abc123.css"), "body{}");
  fs.writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
  fs.writeFileSync(path.join(resources, "secret.txt"), "TOP SECRET");
  fs.writeFileSync(path.join(resources, "apps", "dashboard", "secret.txt"), "TOP SECRET");
  return resources;
}

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function serve(resources: string, requestPath: string) {
  const response = serveDashboardFile(resources, requestPath);
  return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
}

describe("serving the dashboard", () => {
  it("serves index.html at the root with the right type, and never caches it", () => {
    const resources = makeResources();
    made.push(resources);

    const response = serveDashboardFile(resources, "/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves scripts, styles and images with their content types", async () => {
    const resources = makeResources();
    made.push(resources);

    expect(await serve(resources, "/assets/app-abc123.js")).toMatchObject({ status: 200, type: "text/javascript; charset=utf-8", text: "console.log('app');" });
    expect((await serve(resources, "/assets/style-abc123.css")).type).toBe("text/css; charset=utf-8");
    expect((await serve(resources, "/favicon.svg")).type).toBe("image/svg+xml");
  });

  it("lets the browser keep hashed assets for ever", () => {
    const resources = makeResources();
    made.push(resources);

    expect(serveDashboardFile(resources, "/assets/app-abc123.js").headers.get("cache-control")).toContain("immutable");
  });

  it("falls back to index.html for a page of the dashboard's router", async () => {
    const resources = makeResources();
    made.push(resources);

    expect(await serve(resources, "/pipeline")).toMatchObject({ status: 200, type: "text/html; charset=utf-8" });
    expect((await serve(resources, "/review/some-id")).text).toContain("<title>Jobgoblin</title>");
  });

  it("answers 404, not the page, for a missing script or image", async () => {
    const resources = makeResources();
    made.push(resources);

    expect((await serve(resources, "/assets/missing.js")).status).toBe(404);
    expect((await serve(resources, "/logo.png")).status).toBe(404);
  });

  it("says how to build the dashboard when it has not been built", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-empty-"));
    made.push(empty);

    const result = await serve(empty, "/");

    expect(result.status).toBe(404);
    expect(result.text).toContain("pnpm --filter @jobgoblin/dashboard build");
  });
});

describe("path traversal", () => {
  const attempts = [
    "/../secret.txt",
    "/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/%2E%2E/%2E%2E/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%2f..%2f..%2fsecret.txt",
    "/assets/..%5c..%5c..%5csecret.txt",
    "/..%5csecret.txt",
    "/assets/../../secret.txt",
    "/%00",
    "/assets%00/app-abc123.js",
    "/%",
    "/C:/Windows/win.ini",
    "//secret.txt",
  ];

  for (const attempt of attempts) {
    it(`never serves a file outside the dashboard for ${attempt}`, async () => {
      const resources = makeResources();
      made.push(resources);

      const result = await serve(resources, attempt);

      expect(result.text).not.toContain("TOP SECRET");
      expect(result.text).not.toContain("[fonts]");
    });
  }

  it("resolves only paths inside the root", () => {
    const root = path.resolve("C:\\site\\dist");

    expect(resolveInside(root, "/assets/app.js")).toBe(path.join(root, "assets", "app.js"));
    expect(resolveInside(root, "/")).toBe(root);
    expect(resolveInside(root, "/../x")).toBeNull();
    expect(resolveInside(root, "/%2e%2e/x")).toBeNull();
    expect(resolveInside(root, "/a%5cb")).toBeNull();
    expect(resolveInside(root, "/a%00b")).toBeNull();
    expect(resolveInside(root, "/%E0%A4%A")).toBeNull();
  });

  it("is refused through the app too, for a request with no token", async () => {
    const { ctx, call } = createTestApp();
    const resources = makeResources();
    made.push(resources);
    ctx.resourcesDir = resources;

    const response = await call("/..%2fsecret.txt", { token: null });

    expect(await response.text()).not.toContain("TOP SECRET");
  });
});

describe("static files through the app", () => {
  it("need no token", async () => {
    const { ctx, call } = createTestApp();
    const resources = makeResources();
    made.push(resources);
    ctx.resourcesDir = resources;

    const page = await call("/", { token: null });
    const script = await call("/assets/app-abc123.js", { token: null });

    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Jobgoblin");
    expect(script.headers.get("content-type")).toContain("javascript");
  });

  it("serve a page of the router for a plain browser address", async () => {
    const { ctx, call } = createTestApp();
    const resources = makeResources();
    made.push(resources);
    ctx.resourcesDir = resources;

    const response = await call("/pipeline", { token: null });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("do not answer POST", async () => {
    const { call } = createTestApp();

    const response = await call("/pipeline", { method: "POST", token: null });

    expect(response.status).toBe(404);
  });
});

describe("content types", () => {
  it("know the usual web files and fall back to bytes", () => {
    expect(contentTypeOf("a.woff2")).toBe("font/woff2");
    expect(contentTypeOf("a.JSON")).toBe("application/json; charset=utf-8");
    expect(contentTypeOf("a.unknown")).toBe("application/octet-stream");
  });
});
