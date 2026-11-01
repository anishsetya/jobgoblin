// Waiting for the server to finish its background work. The dashboard shows progress, but a test often
// just needs "the hunt, the tailoring that follows it and everything queued behind it are done".
// Spec: ARCHITECTURE.md section 10 (runner) and section 11 (GET /api/today).
import type { TestServer } from "./server";

type TodayRun = { id: string; kind: string; status: string };
type Today = { running: TodayRun[]; needsYou: { kind: string; title: string }[] };

const POLL_MS = 400;
// A run ends, then the server queues the next one (hunt -> tailor). One quiet poll is not proof that all is done.
const QUIET_POLLS_NEEDED = 3;

export async function waitUntilNoRunIsActive(server: TestServer, timeoutMs = 90_000): Promise<Today> {
  const deadline = Date.now() + timeoutMs;
  let quietPolls = 0;
  let latest: Today = { running: [], needsYou: [] };

  while (Date.now() < deadline) {
    latest = await server.api<Today>("/api/today");
    const isBusy = latest.running.some((run) => run.status === "queued" || run.status === "running");
    quietPolls = isBusy ? 0 : quietPolls + 1;
    if (quietPolls >= QUIET_POLLS_NEEDED) return latest;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`A run was still queued or running after ${timeoutMs / 1000} s.\n${JSON.stringify(latest.running)}\n${server.output()}`);
}
