// A stand-in for packages/server, for checking the Electron shell before the real server exists.
// It speaks the same startup protocol (README: "Messages with the server") and serves one page that
// reports what the preload gave it. It is not part of the product and nothing imports it.
// How to run it: see "Try it with the stand-in server" in apps/desktop/README.md.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const appDataDir = process.env.JOBGOBLIN_APP_DATA;
const personFolder = process.env.STAND_IN_PERSON_FOLDER ?? path.join(appDataDir, "person-folder");
const sessionToken = crypto.randomBytes(16).toString("hex");
const reportPath = path.join(appDataDir, "stand-in-report.json");

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Jobgoblin stand-in</title></head>
<body>
<h1>Jobgoblin stand-in server</h1>
<p id="status">Checking the preload bridge...</p>
<script>
  const bridge = window.jobgoblin;
  const report = {
    hasBridge: typeof bridge === "object" && bridge !== null,
    bridgeKeys: bridge ? Object.keys(bridge).sort() : [],
    sessionToken: bridge ? bridge.sessionToken : null,
    hasNodeAccess: typeof require !== "undefined" || typeof process !== "undefined",
  };
  fetch("/report", { method: "POST", body: JSON.stringify(report) });
  document.getElementById("status").textContent =
    report.hasBridge ? "Bridge present: " + report.bridgeKeys.join(", ") : "No bridge (this is correct for a foreign origin)";
</script>
</body></html>`;

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(PAGE);
    return;
  }
  if (request.method === "POST" && request.url === "/report") {
    readBody(request, (body) => {
      const report = JSON.parse(body);
      report.tokenMatchesServer = report.sessionToken === sessionToken;
      delete report.sessionToken;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      response.writeHead(204).end();
    });
    return;
  }
  if (request.method === "POST" && request.url === "/api/open") {
    if (request.headers.authorization !== `Bearer ${sessionToken}`) {
      response.writeHead(401).end();
      return;
    }
    readBody(request, (body) => {
      const { path: requestedPath } = JSON.parse(body);
      // The real server checks the folder first; the stand-in forwards everything so main's check is what gets tested.
      process.parentPort.postMessage({ type: "open-path", path: requestedPath, personFolder });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ opened: true, path: requestedPath }));
    });
    return;
  }
  response.writeHead(404).end();
});

server.listen(Number(process.env.JOBGOBLIN_PORT ?? 0), "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`stand-in server listening on ${port}`);
  process.parentPort.postMessage({ type: "ready", port, sessionToken });
});

process.parentPort.on("message", (event) => {
  if (event.data?.type !== "shutdown") return;
  console.log("stand-in server got shutdown");
  server.close(() => process.exit(0));
  server.closeAllConnections();
});

function readBody(request, done) {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => done(body));
}
