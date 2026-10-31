// The public face of @jobgoblin/server for code that starts the server from TypeScript (tests, e2e helpers):
// start it, read its start options, and the context type services take. Re-exports only; no logic lives here.
// The server as a program is main.ts, which tsup bundles into dist/server.mjs.
// Spec: ARCHITECTURE.md section 11 (server entry).
export { readStartOptions } from "./startOptions";
export { startServer, type RunningServer } from "./startServer";
export type { Launcher, QueueRunRequest, RunQueue, ServerContext, StartOptions } from "./context";
