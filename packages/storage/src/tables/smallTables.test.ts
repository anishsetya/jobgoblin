// Round trips for the small tables that have only a few functions each:
// master_resume, uploads, feed_cache, companies, settings.
import { Settings } from "@jobgoblin/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { aResumeBody, openTestDatabase, removeTempDirs, TEST_TIMESTAMP } from "../testSupport";
import { getCompany, insertCompanyIfMissing, listCompanies, setCompanyStatus } from "./companies";
import { deleteFeedCacheEntriesBefore, getFeedCacheEntry, saveFeedCacheEntry } from "./feedCache";
import { getMasterResume, saveMasterResume } from "./masterResume";
import { getSetting, getSettings, setSetting, setSettings } from "./settings";
import { insertUpload, listLatestUploads, listUploads } from "./uploads";

afterEach(removeTempDirs);

describe("master resume", () => {
  it("is empty until setup builds it, then reads back what was saved", () => {
    const db = openTestDatabase();
    expect(getMasterResume(db)).toBeNull();

    saveMasterResume(db, aResumeBody(), TEST_TIMESTAMP);

    expect(getMasterResume(db)).toEqual({ body: aResumeBody(), updatedAt: TEST_TIMESTAMP });
    db.close();
  });

  it("keeps a single row when it is saved again", () => {
    const db = openTestDatabase();
    saveMasterResume(db, aResumeBody(), TEST_TIMESTAMP);
    const withoutHeadline = { ...aResumeBody(), headline: null };

    saveMasterResume(db, withoutHeadline, "2026-11-01T10:00:00.000Z");

    expect(getMasterResume(db)?.body.headline).toBeNull();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS total FROM master_resume").get()?.total).toBe(1);
    db.close();
  });
});

describe("uploads", () => {
  const resumeUpload = { id: "up-1", kind: "resume", fileName: "resume.pdf", redactedText: "{email} Backend engineer", uploadedAt: "2026-10-30T09:00:00.000Z" } as const;
  const linkedinUpload = { id: "up-2", kind: "linkedin", fileName: "profile.pdf", redactedText: "Alex, Austin", uploadedAt: "2026-10-30T09:05:00.000Z" } as const;

  it("saves the text of an upload and reads it back", () => {
    const db = openTestDatabase();

    insertUpload(db, resumeUpload);
    insertUpload(db, linkedinUpload);

    expect(listUploads(db)).toEqual([resumeUpload, linkedinUpload]);
    db.close();
  });

  it("lists only the newest upload of each kind", () => {
    const db = openTestDatabase();
    insertUpload(db, resumeUpload);
    insertUpload(db, linkedinUpload);
    const newerResume = { ...resumeUpload, id: "up-3", fileName: "resume-v2.pdf", uploadedAt: "2026-10-31T08:00:00.000Z" };

    insertUpload(db, newerResume);

    expect(listLatestUploads(db).map((upload) => upload.id).sort()).toEqual(["up-2", "up-3"]);
    db.close();
  });
});

describe("feed cache", () => {
  const entry = { url: "https://boards.example.com/acmecloud", etag: '"abc"', lastModified: null, body: "{}", fetchedAt: TEST_TIMESTAMP };

  it("remembers the last response of a feed", () => {
    const db = openTestDatabase();
    expect(getFeedCacheEntry(db, entry.url)).toBeNull();

    saveFeedCacheEntry(db, entry);

    expect(getFeedCacheEntry(db, entry.url)).toEqual(entry);
    db.close();
  });

  it("replaces the earlier response of the same feed", () => {
    const db = openTestDatabase();
    saveFeedCacheEntry(db, entry);

    saveFeedCacheEntry(db, { ...entry, etag: '"def"', body: "[1]", fetchedAt: "2026-11-01T10:00:00.000Z" });

    expect(getFeedCacheEntry(db, entry.url)).toMatchObject({ etag: '"def"', body: "[1]" });
    db.close();
  });

  it("forgets responses fetched before a cut-off and keeps newer ones", () => {
    const db = openTestDatabase();
    saveFeedCacheEntry(db, { ...entry, url: "https://old.example.com", fetchedAt: "2026-10-01T00:00:00.000Z" });
    saveFeedCacheEntry(db, entry);

    const removed = deleteFeedCacheEntriesBefore(db, "2026-10-15T00:00:00.000Z");

    expect(removed).toBe(1);
    expect(getFeedCacheEntry(db, "https://old.example.com")).toBeNull();
    expect(getFeedCacheEntry(db, entry.url)).not.toBeNull();
    db.close();
  });
});

describe("companies", () => {
  const acme = { id: "co-1", name: "Acme Cloud", ats: "greenhouse", slug: "acmecloud", status: "Watching" } as const;
  const brightpath = { id: "co-2", name: "brightpath", ats: "lever", slug: "brightpath", status: "Suggested" } as const;

  it("saves a company and reads it back", () => {
    const db = openTestDatabase();

    const added = insertCompanyIfMissing(db, acme);

    expect(added).toBe(true);
    expect(getCompany(db, "co-1")).toEqual(acme);
    db.close();
  });

  it("does not add the same company twice, even under a new id", () => {
    const db = openTestDatabase();
    insertCompanyIfMissing(db, acme);

    const sameBoardAgain = insertCompanyIfMissing(db, { ...acme, id: "co-99", status: "Passed" });

    expect(sameBoardAgain).toBe(false);
    expect(listCompanies(db)).toHaveLength(1);
    expect(getCompany(db, "co-1")?.status).toBe("Watching");
    db.close();
  });

  it("lists companies by name, optionally only those with a given status", () => {
    const db = openTestDatabase();
    insertCompanyIfMissing(db, brightpath);
    insertCompanyIfMissing(db, acme);

    expect(listCompanies(db).map((company) => company.id)).toEqual(["co-1", "co-2"]);
    expect(listCompanies(db, "Suggested").map((company) => company.id)).toEqual(["co-2"]);
    db.close();
  });

  it("changes a company's status", () => {
    const db = openTestDatabase();
    insertCompanyIfMissing(db, brightpath);

    const updated = setCompanyStatus(db, "co-2", "Watching");

    expect(updated?.status).toBe("Watching");
    expect(setCompanyStatus(db, "nothing", "Passed")).toBeNull();
    db.close();
  });
});

describe("settings", () => {
  it("gives a fresh install the schema's defaults", () => {
    const db = openTestDatabase();

    expect(getSettings(db)).toEqual(Settings.parse({}));
    expect(getSetting(db, "maxOpenPerCompany")).toBe(3);
    db.close();
  });

  it("saves one setting and keeps the defaults for the rest", () => {
    const db = openTestDatabase();

    setSetting(db, "personFolder", "C:\\Users\\alex\\Documents\\Jobgoblin");

    expect(getSetting(db, "personFolder")).toBe("C:\\Users\\alex\\Documents\\Jobgoblin");
    expect(getSetting(db, "followUpDays")).toBe(7);
    db.close();
  });

  it("saves several settings at once and leaves out the ones not given", () => {
    const db = openTestDatabase();
    setSetting(db, "reapplyDays", 30);

    setSettings(db, { concurrency: 2, setupComplete: true });

    expect(getSettings(db)).toMatchObject({ concurrency: 2, setupComplete: true, reapplyDays: 30 });
    db.close();
  });

  it("refuses a value of the wrong kind", () => {
    const db = openTestDatabase();

    const saveThree = () => setSetting(db, "concurrency", 3 as never);

    expect(saveThree).toThrow();
    expect(getSetting(db, "concurrency")).toBe(1);
    db.close();
  });
});
