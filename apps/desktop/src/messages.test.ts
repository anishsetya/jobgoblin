import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./messages";

describe("parseServerMessage", () => {
  it("reads a ready message", () => {
    const message = parseServerMessage({ type: "ready", port: 47615, sessionToken: "abc123" });

    expect(message).toEqual({ type: "ready", port: 47615, sessionToken: "abc123" });
  });

  it("refuses a ready message with a bad port or an empty token", () => {
    expect(parseServerMessage({ type: "ready", port: 0, sessionToken: "abc" })).toBeNull();
    expect(parseServerMessage({ type: "ready", port: 70000, sessionToken: "abc" })).toBeNull();
    expect(parseServerMessage({ type: "ready", port: "47615", sessionToken: "abc" })).toBeNull();
    expect(parseServerMessage({ type: "ready", port: 47615, sessionToken: "" })).toBeNull();
  });

  it("reads an open-path message with the person's folder", () => {
    const message = parseServerMessage({ type: "open-path", path: "C:\\Jobs\\Tracker.xlsx", personFolder: "C:\\Jobs" });

    expect(message).toEqual({ type: "open-path", path: "C:\\Jobs\\Tracker.xlsx", personFolder: "C:\\Jobs" });
  });

  it("keeps an open-path message that has no folder, with personFolder null so main can refuse it", () => {
    const message = parseServerMessage({ type: "open-path", path: "C:\\Jobs\\Tracker.xlsx" });

    expect(message).toEqual({ type: "open-path", path: "C:\\Jobs\\Tracker.xlsx", personFolder: null });
  });

  it("ignores messages of other types and values that are not messages", () => {
    expect(parseServerMessage({ type: "hello" })).toBeNull();
    expect(parseServerMessage("ready")).toBeNull();
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage({ type: "open-path", path: 5 })).toBeNull();
  });
});
