// Where the server keeps its data, and the other start options. The point of the demo rule: demo jobs and
// resumes never land in a real person's Jobgoblin folder unless a folder was chosen on purpose.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStartOptions } from "./startOptions";

const DEMO_BOARD = path.resolve("fixtures", "feeds", "demo");

// The folder's own name; on Linux the names are lower case.
function folderName(appDataDir: string): string {
  return path.basename(appDataDir).toLowerCase();
}

describe("readStartOptions", () => {
  it("keeps the data in the Jobgoblin folder when it is not on the demo board", () => {
    const options = readStartOptions({}, []);

    expect(folderName(options.appDataDir)).toBe("jobgoblin");
    expect(options.feedFixturesDir).toBeNull();
  });

  it("keeps demo data in Jobgoblin-demo, next to the real folder, when no folder was chosen", () => {
    const real = readStartOptions({}, []);
    const demo = readStartOptions({ JOBGOBLIN_FEED_FIXTURES: DEMO_BOARD }, []);

    expect(folderName(demo.appDataDir)).toBe("jobgoblin-demo");
    expect(path.dirname(demo.appDataDir)).toBe(path.dirname(real.appDataDir));
    expect(demo.feedFixturesDir).toBe(DEMO_BOARD);
  });

  it("treats --feed-fixtures like the variable", () => {
    expect(folderName(readStartOptions({}, ["--feed-fixtures", DEMO_BOARD]).appDataDir)).toBe("jobgoblin-demo");
  });

  it("uses a folder that was chosen, even on the demo board", () => {
    const chosen = path.resolve("my-demo-data");

    expect(readStartOptions({ JOBGOBLIN_FEED_FIXTURES: DEMO_BOARD, JOBGOBLIN_APP_DATA: chosen }, []).appDataDir).toBe(chosen);
    expect(readStartOptions({ JOBGOBLIN_FEED_FIXTURES: DEMO_BOARD }, ["--app-data", chosen]).appDataDir).toBe(chosen);
  });

  it("treats an empty JOBGOBLIN_APP_DATA as not set, instead of using the current folder", () => {
    const options = readStartOptions({ JOBGOBLIN_APP_DATA: "", JOBGOBLIN_FEED_FIXTURES: DEMO_BOARD }, []);

    expect(folderName(options.appDataDir)).toBe("jobgoblin-demo");
  });
});
