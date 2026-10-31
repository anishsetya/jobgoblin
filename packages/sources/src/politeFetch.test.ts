import { describe, expect, it } from "vitest";
import { createMemoryFeedCache } from "./memoryFeedCache";
import { CACHE_MAX_AGE_MS, createPoliteFetcher, USER_AGENT } from "./politeFetch";
import type { CachedResponse } from "./types";

const START = "2026-10-31T12:00:00.000Z";
const HOUR_MS = 60 * 60 * 1000;

// A clock that only moves when the code under test sleeps or the test says so, so nothing really waits.
// Sleepers wake one at a time, earliest first, and each one gets to run before the next one wakes,
// which is what the real clock would do.
function aFakeClock() {
  const startMs = Date.parse(START);
  let nowMs = startMs;
  const sleepers: { wakeAtMs: number; wake: () => void }[] = [];
  let isWakeScheduled = false;

  function scheduleNextWake(): void {
    if (isWakeScheduled || sleepers.length === 0) {
      return;
    }
    isWakeScheduled = true;
    // A zero-length timer lets everything the last sleeper started finish first.
    setTimeout(() => {
      isWakeScheduled = false;
      sleepers.sort((a, b) => a.wakeAtMs - b.wakeAtMs);
      const next = sleepers.shift();
      if (next !== undefined) {
        nowMs = Math.max(nowMs, next.wakeAtMs);
        next.wake();
      }
      scheduleNextWake();
    }, 0);
  }

  return {
    now: () => new Date(nowMs),
    sleep(milliseconds: number): Promise<void> {
      return new Promise((resolve) => {
        sleepers.push({ wakeAtMs: nowMs + milliseconds, wake: resolve });
        scheduleNextWake();
      });
    },
    advance(milliseconds: number): void {
      nowMs += milliseconds;
    },
    secondsSinceStart: () => (nowMs - startMs) / 1000,
  };
}

type RecordedRequest = { url: string; headers: Record<string, string>; atSeconds: number };
type CannedResponse = { status?: number; body?: string; headers?: Record<string, string> };

// A fetch that answers from a list and remembers when and how it was asked.
function aFakeFetch(clock: ReturnType<typeof aFakeClock>, responses: CannedResponse[] = []) {
  const requests: RecordedRequest[] = [];
  const fetchFunction: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      atSeconds: clock.secondsSinceStart(),
    });
    const canned = responses.shift() ?? {};
    return new Response(canned.status === 304 ? null : (canned.body ?? "ok"), {
      status: canned.status ?? 200,
      headers: canned.headers,
    });
  };
  return { fetchFunction, requests };
}

function aFetcherWith(responses: CannedResponse[] = []) {
  const clock = aFakeClock();
  const cache = createMemoryFeedCache();
  const fake = aFakeFetch(clock, responses);
  const fetcher = createPoliteFetcher({
    cache,
    now: clock.now,
    sleep: clock.sleep,
    fetchFunction: fake.fetchFunction,
  });
  return { clock, cache, fetcher, requests: fake.requests };
}

describe("politeFetch", () => {
  it("makes at most one request a second to the same host", async () => {
    const { fetcher, requests } = aFetcherWith();

    await Promise.all([
      fetcher.fetchText("https://boards.example/a"),
      fetcher.fetchText("https://boards.example/b"),
      fetcher.fetchText("https://boards.example/c"),
    ]);

    expect(requests.map((request) => request.atSeconds)).toEqual([0, 1, 2]);
  });

  it("does not make different hosts wait for each other", async () => {
    const { fetcher, requests } = aFetcherWith();

    await Promise.all([fetcher.fetchText("https://one.example/a"), fetcher.fetchText("https://two.example/a")]);

    expect(requests.map((request) => request.atSeconds)).toEqual([0, 0]);
  });

  it("does not wait at all once the host has been quiet for a second", async () => {
    const { clock, fetcher, requests } = aFetcherWith();

    await fetcher.fetchText("https://boards.example/a");
    clock.advance(1_000);
    await fetcher.fetchText("https://boards.example/b");

    expect(requests.map((request) => request.atSeconds)).toEqual([0, 1]);
  });

  it("introduces itself with the Jobgoblin user agent", async () => {
    const { fetcher, requests } = aFetcherWith();

    await fetcher.fetchText("https://boards.example/a");

    expect(requests[0]?.headers["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toBe("Jobgoblin/0.1 (+https://github.com/anishsetya/jobgoblin)");
  });

  it("saves the body with its ETag and Last-Modified", async () => {
    const { cache, fetcher } = aFetcherWith([
      { body: "board", headers: { ETag: 'W/"v1"', "Last-Modified": "Fri, 30 Oct 2026 08:00:00 GMT" } },
    ]);

    const body = await fetcher.fetchText("https://boards.example/a");

    expect(body).toBe("board");
    expect(cache.read("https://boards.example/a")).toEqual({
      etag: 'W/"v1"',
      lastModified: "Fri, 30 Oct 2026 08:00:00 GMT",
      body: "board",
      fetchedAt: START,
    });
  });

  it("reuses a response younger than 6 hours without any request", async () => {
    const { clock, fetcher, requests } = aFetcherWith([{ body: "first" }, { body: "second" }]);

    await fetcher.fetchText("https://boards.example/a");
    clock.advance(CACHE_MAX_AGE_MS - 1);
    const body = await fetcher.fetchText("https://boards.example/a");

    expect(body).toBe("first");
    expect(requests).toHaveLength(1);
  });

  it("asks again once the saved response is 6 hours old, and sends what it knows", async () => {
    const { clock, fetcher, requests } = aFetcherWith([
      { body: "first", headers: { ETag: '"v1"', "Last-Modified": "Fri, 30 Oct 2026 08:00:00 GMT" } },
      { body: "second", headers: { ETag: '"v2"' } },
    ]);

    await fetcher.fetchText("https://boards.example/a");
    clock.advance(CACHE_MAX_AGE_MS);
    const body = await fetcher.fetchText("https://boards.example/a");

    expect(body).toBe("second");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers["If-None-Match"]).toBe('"v1"');
    expect(requests[1]?.headers["If-Modified-Since"]).toBe("Fri, 30 Oct 2026 08:00:00 GMT");
  });

  it("keeps the saved body when the server says 304, and starts its 6 hours again", async () => {
    const { clock, cache, fetcher, requests } = aFetcherWith([
      { body: "board", headers: { ETag: '"v1"' } },
      { status: 304 },
    ]);

    await fetcher.fetchText("https://boards.example/a");
    clock.advance(7 * HOUR_MS);
    const body = await fetcher.fetchText("https://boards.example/a");
    const saved = cache.read("https://boards.example/a") as CachedResponse;

    expect(body).toBe("board");
    expect(saved.fetchedAt).toBe(clock.now().toISOString());
    clock.advance(5 * HOUR_MS);
    await fetcher.fetchText("https://boards.example/a");
    expect(requests).toHaveLength(2);
  });

  it("does not send conditional headers when nothing is saved", async () => {
    const { fetcher, requests } = aFetcherWith();

    await fetcher.fetchText("https://boards.example/a");

    expect(requests[0]?.headers["If-None-Match"]).toBeUndefined();
    expect(requests[0]?.headers["If-Modified-Since"]).toBeUndefined();
  });

  it("names the host when the server answers with an error", async () => {
    const { cache, fetcher } = aFetcherWith([{ status: 404, body: "not found" }]);

    await expect(fetcher.fetchText("https://boards.example/missing")).rejects.toThrow(
      "boards.example answered HTTP 404.",
    );
    expect(cache.read("https://boards.example/missing")).toBeNull();
  });
});
