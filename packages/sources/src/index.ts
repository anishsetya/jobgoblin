// The public face of @jobgoblin/sources: job feed clients and parsers. No logic lives here.
// Spec: "Job discovery"; ARCHITECTURE.md sections 3 and 5.4.
export { fetchFeeds } from "./fetchFeeds";
export { readPostingFromUrl } from "./readPostingFromUrl";
export { htmlToText } from "./htmlToText";
export { createMemoryFeedCache } from "./memoryFeedCache";
export type {
  CachedResponse,
  FeedCache,
  FeedFailure,
  FetchFeedsInput,
  FetchFeedsResult,
  ReadPostingOptions,
  ReadPostingResult,
} from "./types";
