import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovedFileConflictError, PathOutsideFolderError } from "./errors";
import { fileSha256, sha256OfBytes } from "./hash";
import { createPersonFolder } from "./personFolder";
import { makeTempDir, PDF_BYTES, PDF_SHA256, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

const OCTOBER_30 = new Date(2026, 9, 30, 12, 0); // local time, so the name does not depend on the computer's time zone

function aPersonFolder() {
  return createPersonFolder(path.join(makeTempDir(), "Jobgoblin"));
}

describe("the folder layout", () => {
  it("creates the folder with Applications, Resumes, Backups and Exports", () => {
    const folder = aPersonFolder();

    folder.ensureLayout();

    for (const name of ["Applications", "Resumes", "Backups", "Exports"]) {
      expect(fs.statSync(path.join(folder.root, name)).isDirectory()).toBe(true);
    }
  });

  it("can be run again without harm", () => {
    const folder = aPersonFolder();
    folder.ensureLayout();

    expect(() => folder.ensureLayout()).not.toThrow();
  });
});

describe("applicationFolderName", () => {
  it("is the date, the company and the role", () => {
    const folder = aPersonFolder();

    const name = folder.applicationFolderName(OCTOBER_30, "Stripe", "Backend Engineer");

    expect(name).toBe("2026-10-30 Stripe - Backend Engineer");
  });

  it("removes the characters Windows does not allow in a file name", () => {
    const folder = aPersonFolder();

    const name = folder.applicationFolderName(OCTOBER_30, 'Acme: "Cloud"', "AI/ML Engineer <Platform>? | *Team*");

    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name).toBe("2026-10-30 Acme Cloud - AI ML Engineer Platform Team");
  });

  it("never ends with a dot or a space, which Windows silently drops", () => {
    const folder = aPersonFolder();

    const name = folder.applicationFolderName(OCTOBER_30, "Initech Inc.", "Engineer...  ");

    expect(name).toBe("2026-10-30 Initech Inc. - Engineer");
  });

  it("is at most 80 characters", () => {
    const folder = aPersonFolder();
    const veryLongTitle = "Senior Distributed Systems and Platform Reliability Engineer ".repeat(5);

    const name = folder.applicationFolderName(OCTOBER_30, "Stripe", veryLongTitle);

    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.startsWith("2026-10-30 Stripe - Senior Distributed")).toBe(true);
  });

  it("adds (2), (3) when the name is taken, and stays within 80 characters", () => {
    const folder = aPersonFolder();
    folder.ensureLayout();
    const first = folder.applicationFolderName(OCTOBER_30, "Stripe", "Backend Engineer");
    fs.mkdirSync(path.join(folder.root, "Applications", first));

    const second = folder.applicationFolderName(OCTOBER_30, "Stripe", "Backend Engineer");
    fs.mkdirSync(path.join(folder.root, "Applications", second));
    const third = folder.applicationFolderName(OCTOBER_30, "Stripe", "Backend Engineer");

    expect(second).toBe(`${first} (2)`);
    expect(third).toBe(`${first} (3)`);

    const longTitle = "Platform Engineer ".repeat(10);
    const longFirst = folder.applicationFolderName(OCTOBER_30, "Stripe", longTitle);
    fs.mkdirSync(path.join(folder.root, "Applications", longFirst));
    const longSecond = folder.applicationFolderName(OCTOBER_30, "Stripe", longTitle);
    expect(longSecond.endsWith(" (2)")).toBe(true);
    expect(longSecond.length).toBeLessThanOrEqual(80);
  });

  it("gives the path to store with the application, relative to the folder and with forward slashes", () => {
    const folder = aPersonFolder();

    expect(folder.applicationFolderPath("2026-10-30 Stripe - Backend Engineer")).toBe(
      "Applications/2026-10-30 Stripe - Backend Engineer",
    );
  });
});

describe("writing documents", () => {
  it("writes the job description and the answers into the application's folder", () => {
    const folder = aPersonFolder();
    const applicationFolder = folder.applicationFolderPath("2026-10-30 Stripe - Backend Engineer");

    folder.writeJobDescription(applicationFolder, "# Backend Engineer\nBuild APIs.");
    folder.writeAnswers(applicationFolder, "## Why Stripe?\nBecause.");

    const directory = path.join(folder.root, "Applications", "2026-10-30 Stripe - Backend Engineer");
    expect(fs.readFileSync(path.join(directory, "Job description.md"), "utf8")).toBe("# Backend Engineer\nBuild APIs.");
    expect(fs.readFileSync(path.join(directory, "Answers.md"), "utf8")).toBe("## Why Stripe?\nBecause.");
  });

  it("leaves no temporary file behind", () => {
    const folder = aPersonFolder();
    const applicationFolder = folder.applicationFolderPath("2026-10-30 Stripe - Backend Engineer");

    folder.writeAnswers(applicationFolder, "text");

    const files = fs.readdirSync(path.join(folder.root, "Applications", "2026-10-30 Stripe - Backend Engineer"));
    expect(files).toEqual(["Answers.md"]);
  });
});

describe("writeApprovedResume", () => {
  const applicationFolder = "Applications/2026-10-30 Stripe - Backend Engineer";
  const approve = (folder: ReturnType<typeof aPersonFolder>, bytes: Uint8Array, shortId = "r-3fa9c1d2") =>
    folder.writeApprovedResume({ bytes, shortId, folder: applicationFolder, fileName: "Alex Rivera - Resume.pdf" });

  it("writes the file to Resumes and a copy with the same fingerprint into the application's folder", () => {
    const folder = aPersonFolder();

    const written = approve(folder, PDF_BYTES);

    expect(written).toEqual({
      resumePath: "Resumes/r-3fa9c1d2.pdf",
      copyPath: `${applicationFolder}/Alex Rivera - Resume.pdf`,
    });
    expect(fileSha256(folder.absolutePath(written.resumePath))).toBe(PDF_SHA256);
    expect(fileSha256(folder.absolutePath(written.copyPath))).toBe(PDF_SHA256);
  });

  it("accepts the same bytes for a shortId that already exists", () => {
    const folder = aPersonFolder();
    approve(folder, PDF_BYTES);

    const approveAgain = () => approve(folder, PDF_BYTES);

    expect(approveAgain).not.toThrow();
  });

  it("refuses different bytes for a shortId that already exists, and changes neither file", () => {
    const folder = aPersonFolder();
    const written = approve(folder, PDF_BYTES);
    const differentBytes = new TextEncoder().encode("%PDF-1.7 a different resume");

    const replace = () => approve(folder, differentBytes);

    expect(replace).toThrow(ApprovedFileConflictError);
    expect(fileSha256(folder.absolutePath(written.resumePath))).toBe(PDF_SHA256);
    expect(fileSha256(folder.absolutePath(written.copyPath))).toBe(PDF_SHA256);
  });

  it("keeps every approved version in Resumes while the application's folder holds the newest", () => {
    const folder = aPersonFolder();
    const newerBytes = new TextEncoder().encode("%PDF-1.7 the edited resume");
    const older = approve(folder, PDF_BYTES, "r-11111111");

    const newer = approve(folder, newerBytes, "r-22222222");

    expect(fs.existsSync(folder.absolutePath(older.resumePath))).toBe(true);
    expect(fs.existsSync(folder.absolutePath(newer.resumePath))).toBe(true);
    expect(fileSha256(folder.absolutePath(newer.copyPath))).toBe(sha256OfBytes(newerBytes));
  });

  it("keeps a file name from climbing out of the application's folder", () => {
    const folder = aPersonFolder();

    const written = folder.writeApprovedResume({
      bytes: PDF_BYTES,
      shortId: "r-3fa9c1d2",
      folder: applicationFolder,
      fileName: "../../evil.pdf",
    });

    expect(written.copyPath).toBe(`${applicationFolder}/evil.pdf`);
    expect(folder.isInside(folder.absolutePath(written.copyPath))).toBe(true);
  });

  it("refuses a short id that is not a resume short id", () => {
    const folder = aPersonFolder();

    const approveWithBadId = () => approve(folder, PDF_BYTES, "../../evil");

    expect(approveWithBadId).toThrow();
  });
});

describe("paths", () => {
  it("turns a stored relative path into a full path inside the folder", () => {
    const folder = aPersonFolder();

    const fullPath = folder.absolutePath("Applications/2026-10-30 Stripe - Backend Engineer/Answers.md");

    expect(fullPath).toBe(path.join(folder.root, "Applications", "2026-10-30 Stripe - Backend Engineer", "Answers.md"));
  });

  it("refuses a relative path that climbs out of the folder, or a path that is not relative", () => {
    const folder = aPersonFolder();
    const outside = path.join(path.parse(folder.root).root, "Windows", "System32");

    expect(() => folder.absolutePath("../outside.txt")).toThrow(PathOutsideFolderError);
    expect(() => folder.absolutePath("Applications/../../outside.txt")).toThrow(PathOutsideFolderError);
    expect(() => folder.absolutePath(outside)).toThrow(PathOutsideFolderError);
  });

  it("knows what is inside the folder", () => {
    const folder = aPersonFolder();
    const siblingWithSamePrefix = `${folder.root}-evil`;

    expect(folder.isInside(folder.root)).toBe(true);
    expect(folder.isInside(path.join(folder.root, "Applications", "x.pdf"))).toBe(true);
    expect(folder.isInside("Applications/x.pdf")).toBe(true);
    expect(folder.isInside(path.join(folder.root, "..", "elsewhere"))).toBe(false);
    expect(folder.isInside(siblingWithSamePrefix)).toBe(false);
  });
});

describe("isCloudSynced", () => {
  const driveRoot = path.parse(process.cwd()).root;
  const folderAt = (...parts: string[]) => createPersonFolder(path.join(driveRoot, ...parts));

  it.each([
    [["Users", "alex", "Google Drive", "Jobgoblin"]],
    [["My Drive", "Jobgoblin"]],
    [["Users", "alex", "OneDrive - Contoso", "Documents", "Jobgoblin"]],
    [["Users", "alex", "Dropbox", "Jobgoblin"]],
    [["Users", "alex", "iCloud Drive", "Jobgoblin"]],
    [["Users", "alex", "Library", "CloudStorage", "GoogleDrive-alex@example.com", "Jobgoblin"]],
  ])("recognises a synced folder: %j", (parts) => {
    expect(folderAt(...parts).isCloudSynced()).toBe(true);
  });

  it("does not mistake an ordinary Documents folder for a synced one", () => {
    expect(folderAt("Users", "alex", "Documents", "Jobgoblin").isCloudSynced()).toBe(false);
  });
});
