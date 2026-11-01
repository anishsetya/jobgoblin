// Server-sent events: GET /api/events keeps a response open and writes one "data: <json>" block per event,
// and a ": ping" comment every 15 seconds so a quiet connection is not closed on the way. When the browser
// goes away, the listener is removed and the timer stopped, so nothing leaks.
// The dashboard reads this with fetch, not EventSource, because EventSource cannot send the Authorization
// header (decision D5).
// Spec: ARCHITECTURE.md section 5.10 (wire format) and decision D5.
import type { ServerEvent } from "@jobgoblin/schemas";
import type { EventBus } from "../bus";

export const PING_EVERY_MS = 15_000;

export function formatEvent(event: ServerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const PING_COMMENT = ": ping\n\n";
// Sent at once, so the browser gets its response headers without waiting for the first event.
export const CONNECTED_COMMENT = ": connected\n\n";

export function serverEventResponse(bus: EventBus, signal: AbortSignal, pingEveryMs: number = PING_EVERY_MS): Response {
  const encoder = new TextEncoder();
  let stopListening: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function cleanUp(): void {
    stopListening?.();
    stopListening = null;
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanUp(); // the stream is already closed
        }
      };

      send(CONNECTED_COMMENT);
      stopListening = bus.subscribe((event) => send(formatEvent(event)));
      pingTimer = setInterval(() => send(PING_COMMENT), pingEveryMs);
      pingTimer.unref();

      signal.addEventListener(
        "abort",
        () => {
          cleanUp();
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
        { once: true },
      );
    },
    cancel: cleanUp,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
