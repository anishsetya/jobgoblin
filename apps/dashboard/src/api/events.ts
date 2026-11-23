// Reads the server's live updates (GET /api/events) and calls back once per event.
// It uses `fetch` and a stream reader, not the browser's EventSource, because EventSource cannot
// send the Authorization header (decision D5). If the connection drops it waits, then tries again,
// waiting longer after each failure so a stopped server is not asked every second.
// It also says how the connection itself is doing (connected, cannot reach Jobgoblin, key refused),
// which is how every screen learns that Jobgoblin has gone (api/connection.ts).
// Spec: ARCHITECTURE.md sections 2 (D5), 5.10 and 12.
import { ServerEvent } from "@jobgoblin/schemas";
import { ApiProblem, apiRequest } from "./client";

const FIRST_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const HTTP_UNAUTHORIZED = 401;

export type ServerEventHandlers = {
  onEvent(event: ServerEvent): void;
  // Called each time the stream (re)connects. Events sent while it was down are lost,
  // so the caller refreshes its data when this is not the first connection.
  onConnected?(): void;
  // Called each time an attempt to connect fails: Jobgoblin cannot be reached. Listening goes on,
  // so onConnected follows once Jobgoblin answers again. A stream that drops is not reported by
  // itself: only the attempt after it is, so a stream that reconnects at once shows nothing.
  onDisconnected?(): void;
  // Called once when the server refuses this page's key (HTTP 401). Every start of the server makes
  // a new key, so this is what a browser tab opened before a restart gets. Listening stops for good.
  onRefused?(): void;
};

// Opens the event stream. Tests pass their own in place of the real request.
export type OpenEventStream = (signal: AbortSignal) => Promise<Response>;

function openEventStream(signal: AbortSignal): Promise<Response> {
  return apiRequest("/api/events", { headers: { Accept: "text/event-stream" }, signal });
}

// Starts listening. Returns a function that stops listening.
export function subscribeToServerEvents(
  handlers: ServerEventHandlers,
  openStream: OpenEventStream = openEventStream,
): () => void {
  const stopper = new AbortController();
  void keepListening(handlers, openStream, stopper.signal);
  return () => stopper.abort();
}

async function keepListening(handlers: ServerEventHandlers, openStream: OpenEventStream, signal: AbortSignal): Promise<void> {
  let retryDelayMs = FIRST_RETRY_DELAY_MS;

  while (!signal.aborted) {
    let opened = false;
    try {
      await readOneConnection(handlers, openStream, signal, () => {
        opened = true;
        retryDelayMs = FIRST_RETRY_DELAY_MS; // a connection that opened is a healthy one
      });
    } catch (error) {
      if (signal.aborted) return;
      // A refused key will not become valid by waiting; the person must open the page again.
      if (error instanceof ApiProblem && error.status === HTTP_UNAUTHORIZED) {
        handlers.onRefused?.();
        return;
      }
      if (!opened) handlers.onDisconnected?.();
    }

    await waitFor(retryDelayMs, signal);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
  }
}

async function readOneConnection(
  handlers: ServerEventHandlers,
  openStream: OpenEventStream,
  signal: AbortSignal,
  onOpened: () => void,
): Promise<void> {
  const response = await openStream(signal);
  if (response.body === null) return;

  onOpened();
  handlers.onConnected?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;

    // Lines end with \n or \r\n; the buffer is tidied after every chunk so a \r\n split
    // between two chunks is still joined correctly.
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");

    // Each event ends with a blank line. Whatever follows the last blank line is unfinished.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEventBlock(block);
      if (event !== null) handlers.onEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

// One block looks like "data: {...json...}". Lines starting with ":" are comments, such as the
// ": ping" the server sends every 15 seconds to keep the connection open.
function parseEventBlock(block: string): ServerEvent | null {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^ /, ""));
  if (dataLines.length === 0) return null;

  let json: unknown;
  try {
    json = JSON.parse(dataLines.join("\n"));
  } catch {
    console.warn("Ignored a live update that was not valid JSON.");
    return null;
  }

  const parsed = ServerEvent.safeParse(json);
  if (!parsed.success) {
    console.warn("Ignored a live update with an unknown shape.");
    return null;
  }
  return parsed.data;
}

// Waits, but wakes up at once when the caller stops listening.
// (The global setTimeout, not window.setTimeout, so the unit tests can run this outside a browser.)
function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
