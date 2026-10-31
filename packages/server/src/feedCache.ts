// The feed cache packages/sources asks for, kept in the feed_cache table. One Greenhouse board is about
// 10 MB of JSON, so each body is gzip-compressed before it is stored (about a tenth of the size).
// The column is TEXT, so the compressed bytes are stored as base64 with a prefix that marks them.
// Spec: ARCHITECTURE.md section 7 (feed_cache); sources README, decision 14.
import { gunzipSync, gzipSync } from "node:zlib";
import type { CachedResponse, FeedCache } from "@jobgoblin/sources";
import { getFeedCacheEntry, saveFeedCacheEntry, type Database } from "@jobgoblin/storage";

// A body that does not start with this was stored uncompressed (an older version, or a test) and is returned as it is.
const COMPRESSED_PREFIX = "gzip-base64:";

// `getDb` is a function because restoring a backup replaces the database while the server keeps running.
export function createFeedCache(getDb: () => Database): FeedCache {
  return {
    read(url): CachedResponse | null {
      const entry = getFeedCacheEntry(getDb(), url);
      if (entry === null) return null;
      return {
        etag: entry.etag,
        lastModified: entry.lastModified,
        body: decompress(entry.body),
        fetchedAt: entry.fetchedAt,
      };
    },

    write(url, response): void {
      saveFeedCacheEntry(getDb(), {
        url,
        etag: response.etag,
        lastModified: response.lastModified,
        body: compress(response.body),
        fetchedAt: response.fetchedAt,
      });
    },
  };
}

function compress(body: string): string {
  return COMPRESSED_PREFIX + gzipSync(Buffer.from(body, "utf8")).toString("base64");
}

function decompress(stored: string): string {
  if (!stored.startsWith(COMPRESSED_PREFIX)) return stored;
  const bytes = Buffer.from(stored.slice(COMPRESSED_PREFIX.length), "base64");
  return gunzipSync(bytes).toString("utf8");
}
