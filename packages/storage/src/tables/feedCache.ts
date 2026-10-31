// Table `feed_cache`: the last response of each feed URL, so the next request can say "only if changed"
// (ETag, Last-Modified) and a recent response is not fetched again for six hours.
// packages/sources decides when to use it; this module only stores and finds entries.
// Spec: ARCHITECTURE.md section 7 (feed_cache).
import type { Database } from "../database";
import { textColumn, textOrNullColumn, type Row } from "../rows";

export type FeedCacheEntry = {
  url: string;
  etag: string | null;
  lastModified: string | null;
  body: string;
  fetchedAt: string;
};

function toFeedCacheEntry(row: Row): FeedCacheEntry {
  return {
    url: textColumn(row, "url"),
    etag: textOrNullColumn(row, "etag"),
    lastModified: textOrNullColumn(row, "last_modified"),
    body: textColumn(row, "body"),
    fetchedAt: textColumn(row, "fetched_at"),
  };
}

export function getFeedCacheEntry(db: Database, url: string): FeedCacheEntry | null {
  const row = db.sqlite.prepare("SELECT * FROM feed_cache WHERE url = ?").get(url);
  return row === undefined ? null : toFeedCacheEntry(row);
}

export function saveFeedCacheEntry(db: Database, entry: FeedCacheEntry): void {
  db.sqlite
    .prepare(
      `INSERT INTO feed_cache (url, etag, last_modified, body, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (url) DO UPDATE SET etag = excluded.etag, last_modified = excluded.last_modified,
                                       body = excluded.body, fetched_at = excluded.fetched_at`,
    )
    .run(entry.url, entry.etag, entry.lastModified, entry.body, entry.fetchedAt);
}

// Forgets responses fetched before `cutoff` (an ISO timestamp), so the cache does not grow forever.
// Returns how many entries were removed.
export function deleteFeedCacheEntriesBefore(db: Database, cutoff: string): number {
  const result = db.sqlite.prepare("DELETE FROM feed_cache WHERE fetched_at < ?").run(cutoff);
  return Number(result.changes);
}
