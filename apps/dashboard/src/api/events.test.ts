// The live updates stream on its own: a stand-in plays the server's GET /api/events, and the test records the
// callbacks that tell every screen whether Jobgoblin can be reached. Timers are faked, so the waits between
// tries take no time.
import type { ServerEvent } from "@jobgoblin/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblem, networkProblem } from "./client";
import { subscribeToServerEvents, type OpenEventStream, type ServerEventHandlers } from "./events";

const encoder = new TextEncoder();

function eventBytes(event: ServerEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

// The server's answer while it is up: these events, then nothing until the page stops listening.
function aStreamThatStaysOpen(signal: AbortSignal, events: ServerEvent[] = []): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(eventBytes(event));
      signal.addEventListener("abort", () => controller.error(new DOMException("Stopped listening.", "AbortError")));
    },
  });
  return new Response(body);
}

// What an open stream does when Jobgoblin stops.
function aStreamThatBreaks(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new TypeError("network error"));
    },
  });
  return new Response(body);
}

function aRefusedKey(): ApiProblem {
  return new ApiProblem(
    { code: "unauthorized", message: "Jobgoblin did not recognise this request.", action: "Close Jobgoblin and open it again." },
    401,
  );
}

function recordCallbacks(): { calls: string[]; handlers: ServerEventHandlers } {
  const calls: string[] = [];
  return {
    calls,
    handlers: {
      onEvent: (event) => calls.push(`event ${event.type}`),
      onConnected: () => calls.push("connected"),
      onDisconnected: () => calls.push("disconnected"),
      onRefused: () => calls.push("refused"),
    },
  };
}

// Lets the listening loop run until it waits: for the stream, or for its next try.
async function letItRun(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("subscribeToServerEvents", () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("says it is connected when the stream opens, and passes on each event", async () => {
    const { calls, handlers } = recordCallbacks();
    const openStream: OpenEventStream = async (signal) => aStreamThatStaysOpen(signal, [{ type: "needs-you.changed" }]);

    stop = subscribeToServerEvents(handlers, openStream);
    await letItRun();

    expect(calls).toEqual(["connected", "event needs-you.changed"]);
  });

  it("says it is disconnected each time it cannot connect, keeps trying, and says connected once Jobgoblin is back", async () => {
    const { calls, handlers } = recordCallbacks();
    const openStream = vi
      .fn<OpenEventStream>()
      .mockRejectedValueOnce(networkProblem())
      .mockRejectedValueOnce(networkProblem())
      .mockImplementation(async (signal) => aStreamThatStaysOpen(signal));

    stop = subscribeToServerEvents(handlers, openStream);
    await letItRun();
    expect(calls).toEqual(["disconnected"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual(["disconnected", "disconnected"]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toEqual(["disconnected", "disconnected", "connected"]);
    expect(openStream).toHaveBeenCalledTimes(3);
  });

  it("says nothing about a stream that dropped when the next try connects, so a short break shows nothing", async () => {
    const { calls, handlers } = recordCallbacks();
    const openStream = vi
      .fn<OpenEventStream>()
      .mockResolvedValueOnce(aStreamThatBreaks())
      .mockImplementation(async (signal) => aStreamThatStaysOpen(signal));

    stop = subscribeToServerEvents(handlers, openStream);
    await letItRun();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(calls).toEqual(["connected", "connected"]);
  });

  it("says it is disconnected when a stream that dropped cannot connect again", async () => {
    const { calls, handlers } = recordCallbacks();
    const openStream = vi.fn<OpenEventStream>().mockResolvedValueOnce(aStreamThatBreaks()).mockRejectedValue(networkProblem());

    stop = subscribeToServerEvents(handlers, openStream);
    await letItRun();
    expect(calls).toEqual(["connected"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual(["connected", "disconnected"]);
  });

  it("says once that the key was refused, and stops trying, since waiting will not help", async () => {
    const { calls, handlers } = recordCallbacks();
    const openStream = vi.fn<OpenEventStream>().mockRejectedValue(aRefusedKey());

    stop = subscribeToServerEvents(handlers, openStream);
    await letItRun();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(calls).toEqual(["refused"]);
    expect(openStream).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the page stops listening on purpose", async () => {
    const { calls, handlers } = recordCallbacks();
    const openStream = vi.fn<OpenEventStream>(async (signal) => aStreamThatStaysOpen(signal));

    stop = subscribeToServerEvents(handlers, openStream);
    await letItRun();
    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(calls).toEqual(["connected"]);
    expect(openStream).toHaveBeenCalledTimes(1);
  });
});
