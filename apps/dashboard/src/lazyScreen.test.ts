// Loading a screen's file, without React: a file that cannot be fetched says "Jobgoblin could not be reached",
// and its failure is kept only until the person tries again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblem } from "@/api/client";
import { forgetFailedScreenLoads, screenFile } from "./lazyScreen";

function aFileThatCouldNotBeFetched(): TypeError {
  return new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:47615/assets/PipelineScreen.js");
}

describe("screenFile", () => {
  afterEach(() => {
    forgetFailedScreenLoads();
    vi.restoreAllMocks();
  });

  it("fetches a screen's file once, and keeps it even when failed loads are forgotten", async () => {
    const load = vi.fn(async () => "the screen");
    const file = screenFile(load);

    const first = await file.get();
    forgetFailedScreenLoads();
    const second = await file.get();

    expect([first, second]).toEqual(["the screen", "the screen"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives every render the same promise, so React waits for one load", () => {
    const file = screenFile(async () => "the screen");

    expect(file.get()).toBe(file.get());
  });

  it("turns a file that could not be fetched into the same problem as a request that got no answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = screenFile(() => Promise.reject(aFileThatCouldNotBeFetched()));

    const failure = await file.get().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiProblem);
    expect(failure).toMatchObject({
      code: "network",
      status: 0,
      message: "Jobgoblin could not be reached.",
      action: "Check that Jobgoblin is still open on your computer, then try again.",
    });
  });

  it("does not fetch a failed file again by itself, only once the failure is forgotten", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(aFileThatCouldNotBeFetched()).mockResolvedValue("the screen");
    const file = screenFile(load);

    await expect(file.get()).rejects.toBeInstanceOf(ApiProblem);
    await expect(file.get()).rejects.toBeInstanceOf(ApiProblem);
    expect(load).toHaveBeenCalledTimes(1);

    forgetFailedScreenLoads();

    expect(await file.get()).toBe("the screen");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
