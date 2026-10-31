// The person's folder: the readable files Jobgoblin keeps for them (application folders, approved resumes,
// the tracker, backups). Only this package writes there. Paths stored in the database are relative to the
// folder and use "/", so a backup restored on another computer still finds its files.
// Spec: ARCHITECTURE.md section 7 ("Person's folder"); tech spec "Data model and storage" (The person's folder).
import fs from "node:fs";
import path from "node:path";
import { ResumeShortId } from "@jobgoblin/schemas";
import { ApprovedFileConflictError, PathOutsideFolderError } from "./errors";
import { formatLocalDay } from "./localTime";

export const APPLICATIONS_DIR = "Applications";
export const RESUMES_DIR = "Resumes";
export const BACKUPS_DIR = "Backups";
export const EXPORTS_DIR = "Exports";

export const JOB_DESCRIPTION_FILE_NAME = "Job description.md";
export const ANSWERS_FILE_NAME = "Answers.md";

// Long names break backup tools and Windows' 260-character path limit.
const MAX_FOLDER_NAME_LENGTH = 80;

// Folder names that mark a folder a sync tool is watching. Compared in lower case against each part of the path.
// "cloudstorage" is where macOS puts Google Drive, OneDrive and Dropbox.
const CLOUD_FOLDER_MARKERS = ["google drive", "googledrive", "my drive", "onedrive", "dropbox", "icloud", "cloudstorage"];

export type ApprovedResumeFiles = {
  resumePath: string; // Resumes/<shortId>.pdf, relative to the person's folder
  copyPath: string; // the copy inside the application's folder, relative to the person's folder
};

export interface PersonFolder {
  root: string;
  // Creates the folder and its Applications, Resumes, Backups and Exports folders if they are missing.
  ensureLayout(): void;
  // "2026-10-30 Stripe - Backend Engineer": at most 80 characters, safe on Windows and macOS, and
  // " (2)", " (3)" ... added when that name is already taken. Does not create the folder.
  applicationFolderName(date: Date, company: string, title: string): string;
  // The folder's path relative to the person's folder ("Applications/<name>"): what applications.folder stores.
  applicationFolderPath(name: string): string;
  writeJobDescription(folder: string, markdown: string): void;
  writeAnswers(folder: string, markdown: string): void;
  // Writes Resumes/<shortId>.pdf once, then puts a copy named `fileName` into `folder`.
  writeApprovedResume(input: { bytes: Uint8Array; shortId: string; folder: string; fileName: string }): ApprovedResumeFiles;
  // The full path of a path relative to the person's folder. Throws if it would leave the folder.
  absolutePath(relativePath: string): string;
  // True when the path is the person's folder or something inside it.
  isInside(somePath: string): boolean;
  // True when the folder looks like Google Drive, OneDrive, Dropbox or iCloud, which upload every change.
  isCloudSynced(): boolean;
}

export function createPersonFolder(rootPath: string): PersonFolder {
  const root = path.resolve(rootPath);

  function isInside(somePath: string): boolean {
    const relativeToRoot = path.relative(root, path.resolve(root, somePath));
    const goesUp = relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`);
    // On Windows, a path on another drive comes back absolute from path.relative.
    return !goesUp && !path.isAbsolute(relativeToRoot);
  }

  // Security: relative paths come from the database, which a restored backup could have filled with anything.
  // Refuse any that would write or read outside the person's folder.
  function absolutePath(relativePath: string): string {
    const parts = relativePath.split(/[\\/]+/).filter((part) => part !== "");
    const resolved = path.resolve(root, ...parts);
    if (path.isAbsolute(relativePath) || !isInside(resolved)) throw new PathOutsideFolderError(relativePath);
    return resolved;
  }

  function writeTextFile(folder: string, fileName: string, text: string): void {
    writeFileAtomically(absolutePath(`${folder}/${fileName}`), Buffer.from(text, "utf8"));
  }

  return {
    root,

    ensureLayout() {
      for (const directory of ["", APPLICATIONS_DIR, RESUMES_DIR, BACKUPS_DIR, EXPORTS_DIR]) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
      }
    },

    applicationFolderName(date, company, title) {
      const baseName = makeFileSystemSafe(`${formatLocalDay(date)} ${company} - ${title}`);
      for (let attempt = 1; ; attempt += 1) {
        const suffix = attempt === 1 ? "" : ` (${attempt})`;
        const name = shortenName(baseName, MAX_FOLDER_NAME_LENGTH - suffix.length) + suffix;
        if (!fs.existsSync(path.join(root, APPLICATIONS_DIR, name))) return name;
      }
    },

    applicationFolderPath: (name) => `${APPLICATIONS_DIR}/${name}`,

    writeJobDescription: (folder, markdown) => writeTextFile(folder, JOB_DESCRIPTION_FILE_NAME, markdown),
    writeAnswers: (folder, markdown) => writeTextFile(folder, ANSWERS_FILE_NAME, markdown),

    writeApprovedResume({ bytes, shortId, folder, fileName }) {
      const validShortId = ResumeShortId.parse(shortId);
      const resumePath = `${RESUMES_DIR}/${validShortId}.pdf`;
      writeApprovedFileOnce(absolutePath(resumePath), bytes, validShortId);

      // The copy in the application's folder is what the person attaches. A newly approved resume for the
      // same application replaces it, while Resumes/ keeps every version ever approved.
      const copyPath = `${folder.replace(/\\/g, "/")}/${makeFileSystemSafe(fileName)}`;
      writeFileAtomically(absolutePath(copyPath), bytes);
      return { resumePath, copyPath };
    },

    absolutePath,
    isInside,

    isCloudSynced() {
      const folderNames = root.toLowerCase().split(/[\\/]+/);
      return folderNames.some((folderName) => CLOUD_FOLDER_MARKERS.some((marker) => folderName.includes(marker)));
    },
  };
}

// Approved files are written once. The same bytes again are fine (approving twice); different bytes are
// refused, because the fingerprint the person approved must keep describing the file.
function writeApprovedFileOnce(filePath: string, bytes: Uint8Array, shortId: string): void {
  if (fs.existsSync(filePath)) {
    const existingBytes = fs.readFileSync(filePath);
    if (!Buffer.from(bytes).equals(existingBytes)) throw new ApprovedFileConflictError(shortId);
    return;
  }
  writeFileAtomically(filePath, bytes);
}

// Writes to a temporary file in the same folder, then renames it over the target, so a sync tool or a
// crash never leaves half a file behind. Used here and by verifyApprovedFiles; not part of the package's public API.
export function writeFileAtomically(filePath: string, data: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, data);
  fs.renameSync(temporaryPath, filePath);
}

// Removes what Windows does not allow in a file name (< > : " / \ | ? * and control characters),
// and the trailing dots and spaces it silently strips. Each removed character leaves a space, so
// "AI/ML Engineer" becomes "AI ML Engineer", not "AIML Engineer".
export function makeFileSystemSafe(text: string): string {
  const withoutIllegal = text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ");
  const singleSpaced = withoutIllegal.replace(/\s+/g, " ");
  return trimEdges(singleSpaced);
}

function shortenName(name: string, maxLength: number): string {
  // Count characters the way a person does (an emoji is one), so a name is never cut in the middle of one.
  const characters = Array.from(name).slice(0, maxLength).join("");
  return trimEdges(characters);
}

function trimEdges(text: string): string {
  return text.replace(/^[\s.]+/, "").replace(/[\s.-]+$/, "");
}
