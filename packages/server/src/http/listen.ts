// Binding the server's port. Always 127.0.0.1: a website, or another computer on the network, must never
// be able to reach this server. The default port is fixed so the dashboard dev server can find it; when it is
// taken (or Windows has reserved it for Hyper-V: EACCES) the next 20 ports are tried. Port 0 asks the system
// for any free port, which is what tests use.
// Spec: ARCHITECTURE.md decision D14.
import type { Server } from "node:http";

export const BIND_ADDRESS = "127.0.0.1";
export const DEFAULT_PORT = 47615;
const FALLBACK_PORT_COUNT = 20;
const PORT_UNAVAILABLE_CODES = ["EADDRINUSE", "EACCES"];

// Resolves with the port that is now listening.
export async function listenOnFreePort(server: Server, firstPort: number): Promise<number> {
  const attempts = firstPort === 0 ? 1 : FALLBACK_PORT_COUNT + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await listenOnce(server, firstPort === 0 ? 0 : firstPort + attempt);
    } catch (error) {
      if (!isPortUnavailable(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(`No free port was found from ${firstPort} to ${firstPort + FALLBACK_PORT_COUNT}.`, { cause: lastError });
}

function listenOnce(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The server did not report its port."));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, BIND_ADDRESS);
  });
}

function isPortUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && PORT_UNAVAILABLE_CODES.includes(String(error.code));
}
