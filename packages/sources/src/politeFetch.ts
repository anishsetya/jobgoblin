// The only code in this package that talks to the network, and it is deliberately gentle:
// at most one request a second per host, conditional requests (ETag, Last-Modified), a 6-hour cache
// per URL, and an honest user agent. The clock, the sleep and the fetch function are passed in,
// so tests need no network and no real waiting. Spec: "Job discovery" (Politeness).
import type { CachedResponse, FeedCache } from "./types";

export const USER_AGENT = "Jobgoblin/0.1 (+https://github.com/anishsetya/jobgoblin)";
export const MIN_MS_BETWEEN_REQUESTS_PER_HOST = 1_000;
export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 30_000;

export type PoliteFetcherOptions = {
  cache: FeedCache;
  now: () => Date;
  fetchFunction?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type PoliteFetcher = {
  // The response body for a URL: from the cache when it is under 6 hours old, otherwise from the network.
  fetchText(url: string): Promise<string>;
};

export function createPoliteFetcher(options: PoliteFetcherOptions): PoliteFetcher {
  const { cache, now } = options;
  const fetchFunction = options.fetchFunction ?? globalThis.fetch;
  const sleep = options.sleep ?? sleepForReal;
  // When the next request to each host may start, as epoch milliseconds.
  const nextFreeSlotByHost = new Map<string, number>();

  async function waitForTurn(host: string): Promise<void> {
    const nowMs = now().getTime();
    const startAtMs = Math.max(nowMs, nextFreeSlotByHost.get(host) ?? 0);
    // Reserve the slot before waiting: requests that arrive together queue up one second apart.
    nextFreeSlotByHost.set(host, startAtMs + MIN_MS_BETWEEN_REQUESTS_PER_HOST);
    if (startAtMs > nowMs) {
      await sleep(startAtMs - nowMs);
    }
  }

  async function fetchText(url: string): Promise<string> {
    const cached = cache.read(url);
    if (cached !== null && isFresh(cached, now())) {
      return cached.body;
    }

    const host = new URL(url).host;
    await waitForTurn(host);
    const response = await fetchFunction(url, {
      headers: buildRequestHeaders(cached),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 304 && cached !== null) {
      // Unchanged: keep the body we have and start its 6 hours again.
      cache.write(url, { ...cached, fetchedAt: now().toISOString() });
      return cached.body;
    }
    if (!response.ok) {
      throw new Error(`${host} answered HTTP ${response.status}.`);
    }

    const body = await response.text();
    cache.write(url, {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      body,
      fetchedAt: now().toISOString(),
    });
    return body;
  }

  return { fetchText };
}

function isFresh(cached: CachedResponse, now: Date): boolean {
  const ageMs = now.getTime() - Date.parse(cached.fetchedAt);
  // A date we cannot read gives NaN, which fails both comparisons: the entry counts as stale.
  return ageMs >= 0 && ageMs < CACHE_MAX_AGE_MS;
}

// A stale copy still tells the server what we have, so it can answer "304 Not Modified" without the body.
function buildRequestHeaders(cached: CachedResponse | null): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (cached?.etag) {
    headers["If-None-Match"] = cached.etag;
  }
  if (cached?.lastModified) {
    headers["If-Modified-Since"] = cached.lastModified;
  }
  return headers;
}

function sleepForReal(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
