import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPathInsideFolder, isHttpUrl, isSameOrigin } from "./openRules";

describe("isHttpUrl", () => {
  it("accepts http and https links", () => {
    expect(isHttpUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("refuses links that would start another program", () => {
    expect(isHttpUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isHttpUrl("ms-msdt:/id PCWDiagnostic")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  const origin = "http://127.0.0.1:47615";

  it("accepts any page on the server's own origin", () => {
    expect(isSameOrigin("http://127.0.0.1:47615/review/12", origin)).toBe(true);
  });

  it("refuses another port, another host and another scheme", () => {
    expect(isSameOrigin("http://127.0.0.1:47616/", origin)).toBe(false);
    expect(isSameOrigin("http://localhost:47615/", origin)).toBe(false);
    expect(isSameOrigin("https://127.0.0.1:47615/", origin)).toBe(false);
    expect(isSameOrigin("http://127.0.0.1:47615.evil.example/", origin)).toBe(false);
  });
});

describe("findPathInsideFolder", () => {
  let workDir: string;
  let personFolder: string;
  let outsideFolder: string;

  beforeEach(() => {
    // The native realpath, like the fs.promises.realpath the code uses, so both expand an 8.3 short name
    // (C:\Users\RUNNER~1 on GitHub's Windows runners) to the full one. The JS fs.realpathSync keeps it short.
    workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-desktop-")));
    personFolder = path.join(workDir, "Jobgoblin");
    outsideFolder = path.join(workDir, "Elsewhere");
    fs.mkdirSync(path.join(personFolder, "Applications"), { recursive: true });
    fs.mkdirSync(outsideFolder);
    fs.writeFileSync(path.join(personFolder, "Tracker.csv"), "Company\n");
    fs.writeFileSync(path.join(outsideFolder, "secret.txt"), "private\n");
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("returns the real path of a file inside the person's folder", async () => {
    const file = path.join(personFolder, "Tracker.csv");

    expect(await findPathInsideFolder(file, personFolder)).toBe(file);
  });

  it("accepts the person's folder itself", async () => {
    expect(await findPathInsideFolder(personFolder, personFolder)).toBe(personFolder);
  });

  it("refuses a file outside the person's folder", async () => {
    const file = path.join(outsideFolder, "secret.txt");

    expect(await findPathInsideFolder(file, personFolder)).toBeNull();
  });

  it("refuses a path that climbs out of the folder with ..", async () => {
    const sneaky = path.join(personFolder, "Applications", "..", "..", "Elsewhere", "secret.txt");

    expect(await findPathInsideFolder(sneaky, personFolder)).toBeNull();
  });

  it("refuses a sibling folder whose name starts with the person's folder name", async () => {
    const sibling = `${personFolder}-backup`;
    fs.mkdirSync(sibling);

    expect(await findPathInsideFolder(sibling, personFolder)).toBeNull();
  });

  it("refuses a link inside the folder that points outside it", async () => {
    const link = path.join(personFolder, "Applications", "link");
    fs.symlinkSync(outsideFolder, link, "junction");

    expect(await findPathInsideFolder(path.join(link, "secret.txt"), personFolder)).toBeNull();
  });

  it("refuses a path that does not exist", async () => {
    expect(await findPathInsideFolder(path.join(personFolder, "missing.pdf"), personFolder)).toBeNull();
  });

  it("refuses relative paths", async () => {
    expect(await findPathInsideFolder("Tracker.csv", personFolder)).toBeNull();
    expect(await findPathInsideFolder(path.join(personFolder, "Tracker.csv"), "Jobgoblin")).toBeNull();
  });
});
