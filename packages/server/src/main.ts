// The server as a program. Electron's main process starts it in a utilityProcess; a developer starts it
// with `pnpm --filter @jobgoblin/server dev`.
//   Outside Electron: prints one line, JOBGOBLIN_READY {"port":...,"url":"http://127.0.0.1:...#token=..."}, and
//   stops on Ctrl+C or SIGTERM.
//   Inside a utilityProcess: posts { type: "ready", port, sessionToken } to Electron (and prints nothing
//   secret), and stops, then exits 0, when main sends { type: "shutdown" }.
// Spec: ARCHITECTURE.md section 11 (server entry) and apps/desktop/README.md "Messages with the server".
import { getDesktopPort, isShutdownMessage } from "./services/desktopPort";
import { readStartOptions } from "./startOptions";
import { startServer, type RunningServer } from "./startServer";

async function run(): Promise<void> {
  const options = readStartOptions(process.env, process.argv.slice(2));
  const server = await startServer(options);
  const desktop = getDesktopPort();

  if (desktop === null) {
    console.log(`JOBGOBLIN_READY ${JSON.stringify({ port: server.port, url: server.url })}`);
    stopOnSignals(server);
    return;
  }

  desktop.postMessage({ type: "ready", port: server.port, sessionToken: server.sessionToken });
  desktop.on("message", (event) => {
    if (isShutdownMessage(event.data)) void stopAndExit(server);
  });
}

function stopOnSignals(server: RunningServer): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void stopAndExit(server));
  }
}

async function stopAndExit(server: RunningServer): Promise<void> {
  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    console.error("Jobgoblin's server could not stop cleanly.", error);
    process.exit(1);
  }
}

run().catch((error: unknown) => {
  // Printed in plain words for the person (or the developer) starting the server; it holds no secrets.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
