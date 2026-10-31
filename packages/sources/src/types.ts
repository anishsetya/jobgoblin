// Types shared by the feed clients: the cache contract the server implements, the "reader" that hides
// whether a response comes from the network or from a saved file, and what the public functions take
// and return. Spec: "Job discovery" (politeness, caching); ARCHITECTURE.md sections 5.4 and 11.
import type { Company, FeedPosting, JobSource } from "@jobgoblin/schemas";

// One saved HTTP response. The server keeps these in the feed_cache table, keyed by URL.
export type CachedResponse = {
  etag: string | null;
  lastModified: string | null;
  body: string;
  fetchedAt: string; // UTC ISO-8601
};

export type FeedCache = {
  read(url: string): CachedResponse | null;
  write(url: string, response: CachedResponse): void;
};

// A feed that could not be read. One failing board never stops the others.
export type FeedFailure = { source: JobSource; slug: string; message: string };

export type FetchFeedsInput = {
  companies: Company[];
  boards: ("hn" | "yc" | "remoteok" | "wwr")[];
  cache: FeedCache;
  fixturesDir: string | null; // when set, nothing touches the network: saved files are read instead
  now?: () => Date;
};

export type FetchFeedsResult = { postings: FeedPosting[]; failures: FeedFailure[] };

export type ReadPostingOptions = { cache: FeedCache; fixturesDir: string | null };

export type ReadPostingResult =
  | { kind: "posting"; posting: FeedPosting }
  | { kind: "needs-text"; reason: "login-only" | "unreadable" };

// What an ATS parser needs besides the response body. companyName is the name the person sees; when it is
// null (a pasted link, where we only know the slug) the parser falls back to the feed's own name.
export type AtsParseContext = { slug: string; companyName: string | null };

// One request a feed client wants answered. The network reader fetches `url`; the saved-file reader
// opens `fixtureFile` (a path inside the fixtures folder, such as "greenhouse/acmecloud.json").
export type FeedRequest = { url: string; fixtureFile: string };

export type FeedReader = {
  // True when responses come from saved files. The Hacker News client needs to know: online it looks up
  // the newest thread first, while the saved thread.json already is the thread.
  readsSavedFiles: boolean;
  // The response text, or null when there is no saved file for this request (never null online).
  read(request: FeedRequest): Promise<string | null>;
};
