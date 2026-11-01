// A FeedCache that lives in memory. The server uses the feed_cache table instead; this one is for tests
// and for any caller that does not need the cache to survive a restart.
import type { CachedResponse, FeedCache } from "./types";

export function createMemoryFeedCache(): FeedCache {
  const responses = new Map<string, CachedResponse>();
  return {
    read: (url) => responses.get(url) ?? null,
    write: (url, response) => {
      responses.set(url, response);
    },
  };
}
