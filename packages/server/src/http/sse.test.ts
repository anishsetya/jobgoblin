import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../bus";
import { CONNECTED_COMMENT, PING_COMMENT, formatEvent, serverEventResponse } from "./sse";
import { closeTestContexts, createTestApp } from "./testSupport";

afterEach(closeTestContexts);

// Reads the next chunk of the stream as text.
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

describe("server-sent events", () => {
  it("frames each event as 'data: <json>' and a blank line", () => {
    expect(formatEvent({ type: "needs-you.changed" })).toBe('data: {"type":"needs-you.changed"}\n\n');
    expect(PING_COMMENT).toBe(": ping\n\n");
  });

  it("opens with a comment, then sends every event in order", async () => {
    const bus = createEventBus();
    const stopper = new AbortController();
    const response = serverEventResponse(bus, stopper.signal);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("no body");

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await readChunk(reader)).toBe(CONNECTED_COMMENT);

    bus.emit({ type: "needs-you.changed" });
    bus.emit({ type: "backup.done", at: "2026-10-31T14:05:00.000Z" });

    expect(await readChunk(reader)).toBe('data: {"type":"needs-you.changed"}\n\n');
    expect(await readChunk(reader)).toBe('data: {"type":"backup.done","at":"2026-10-31T14:05:00.000Z"}\n\n');
    stopper.abort();
  });

  it("sends a ping comment on a quiet connection", async () => {
    const stopper = new AbortController();
    const response = serverEventResponse(createEventBus(), stopper.signal, 10);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    await readChunk(reader);

    expect(await readChunk(reader)).toBe(PING_COMMENT);
    stopper.abort();
  });

  it("stops listening and ends the stream when the browser goes away", async () => {
    const bus = createEventBus();
    let heard = 0;
    const originalSubscribe = bus.subscribe;
    bus.subscribe = (listener) => {
      const stop = originalSubscribe(listener);
      return () => {
        heard += 1; // counts how many times a listener was removed
        stop();
      };
    };
    const stopper = new AbortController();
    const reader = serverEventResponse(bus, stopper.signal).body?.getReader();
    if (reader === undefined) throw new Error("no body");
    await readChunk(reader);

    stopper.abort();

    expect((await reader.read()).done).toBe(true);
    expect(heard).toBe(1);
  });

  it("is served by GET /api/events with the session token", async () => {
    const { ctx, call } = createTestApp();
    const response = await call("/api/events");
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("no body");

    expect(response.status).toBe(200);
    expect(await readChunk(reader)).toBe(CONNECTED_COMMENT);
    ctx.bus.emit({ type: "profile.updated" });
    expect(await readChunk(reader)).toBe('data: {"type":"profile.updated"}\n\n');
    await reader.cancel();
  });
});
