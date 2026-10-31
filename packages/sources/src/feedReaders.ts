// The two ways a feed client can get a response: from the network (politely, with a cache) or from a
// saved file in the fixtures folder. Feed clients only see a FeedReader, so they work the same way in
// the real app and in demos and tests. Spec: "Job discovery"; ARCHITECTURE.md section 11 (JOBGOBLIN_FEED_FIXTURES).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPoliteFetcher } from "./politeFetch";
import type { FeedCache, FeedReader } from "./types";

export type FeedReaderOptions = {
  cache: FeedCache;
  fixturesDir: string | null;
  now: () => Date;
};

// A fixtures folder means "never touch the network", so the choice is made once, here.
export function createFeedReader(options: FeedReaderOptions): FeedReader {
  if (options.fixturesDir !== null) {
    return createSavedFileReader(options.fixturesDir);
  }
  return createNetworkReader(options);
}

function createNetworkReader(options: FeedReaderOptions): FeedReader {
  const fetcher = createPoliteFetcher({ cache: options.cache, now: options.now });
  return {
    readsSavedFiles: false,
    read: (request) => fetcher.fetchText(request.url),
  };
}

export function createSavedFileReader(fixturesDir: string): FeedReader {
  const root = path.resolve(fixturesDir);
  return {
    readsSavedFiles: true,
    async read(request) {
      const filePath = path.resolve(root, request.fixtureFile);
      // A slug comes from a company list, which the person can edit; it must not be able to read other files.
      if (!isInsideFolder(root, filePath)) {
        throw new Error(`The saved file "${request.fixtureFile}" is outside the fixtures folder.`);
      }
      return readFileOrNull(filePath);
    },
  };
}

function isInsideFolder(folder: string, filePath: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// A feed with no saved file simply has no postings in this demo. Any other problem is a real error.
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (isMissing) {
      return null;
    }
    throw error;
  }
}
