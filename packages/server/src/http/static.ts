// The dashboard's files: apps/dashboard/dist, served at "/" with a fallback to index.html for every page the
// dashboard's router owns (so reloading /pipeline works). No token is needed: the files hold no personal data.
// A request path is decoded and checked so it can never leave the dist folder (path traversal), and a missing
// file with an extension (a script, an image) is a plain 404 instead of the HTML page.
// Threat stopped: reading any file on the computer through the static route.
// Spec: ARCHITECTURE.md section 11 (static.ts) and 3 (resourcesDir).
import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const NOT_BUILT_MESSAGE = "The dashboard has not been built yet. Run: pnpm --filter @jobgoblin/dashboard build";

export function dashboardDirectory(resourcesDir: string): string {
  return path.join(resourcesDir, "apps", "dashboard", "dist");
}

export function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// The file inside `root` that a request path names, or null if the path is unsafe or names no file.
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null; // a broken %-escape
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;

  const parts = decoded.split("/").filter((part) => part !== "");
  if (parts.includes("..")) return null;

  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(root, resolved);
  const isInside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return isInside ? resolved : null;
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Files under /assets have a hash in their name, so they may be cached for ever; index.html never.
function cacheControlFor(requestPath: string, isIndex: boolean): string {
  if (isIndex) return "no-cache";
  return requestPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

export function serveDashboardFile(resourcesDir: string, requestPath: string): Response {
  const root = dashboardDirectory(resourcesDir);
  if (!isFile(path.join(root, "index.html"))) return textResponse(NOT_BUILT_MESSAGE, 404);

  const requested = resolveInside(root, requestPath);
  if (requested === null) return textResponse("Not found.", 404);

  if (isFile(requested)) return fileResponse(requested, cacheControlFor(requestPath, false));

  // Pages of the dashboard's router have no extension; a missing script or image is a real 404.
  const looksLikeAFile = path.extname(requestPath) !== "";
  if (looksLikeAFile) return textResponse("Not found.", 404);
  return fileResponse(path.join(root, "index.html"), cacheControlFor(requestPath, true));
}

function fileResponse(filePath: string, cacheControl: string): Response {
  return new Response(fs.readFileSync(filePath), {
    headers: { "Content-Type": contentTypeOf(filePath), "Cache-Control": cacheControl },
  });
}

function textResponse(text: string, status: 404): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
