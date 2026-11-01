// Finds the person's own Claude Code program on disk: every PATH folder first, then the folders the installers
// use. This only looks for a file; it never runs it (claudeCli.ts does that).
// Spec: ARCHITECTURE.md section 10 (Claude Code CLI: detect).
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type SearchInput = { platform: NodeJS.Platform; env: NodeJS.ProcessEnv };

// In order: every PATH folder, then the folders the installers use. Only a real program is accepted:
// `claude.cmd` (what an npm install makes) is never used, because Node cannot start a .cmd file without a shell.
export function findClaudeProgram(input: SearchInput): string | null {
  const fileName = input.platform === "win32" ? "claude.exe" : "claude";

  const candidates = [
    ...pathFolders(input.env).map((folder) => path.join(folder, fileName)),
    ...installerFolders(input).map((folder) => path.join(folder, fileName)),
  ];
  return candidates.find(isFile) ?? null;
}

function pathFolders(env: NodeJS.ProcessEnv): string[] {
  // Windows spells the variable "Path"; a copy of process.env keeps that spelling.
  const pathKey = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const value = pathKey === undefined ? undefined : env[pathKey];
  return (value ?? "").split(path.delimiter).filter((folder) => folder !== "");
}

function installerFolders(input: SearchInput): string[] {
  const home = (input.platform === "win32" ? input.env.USERPROFILE : input.env.HOME) ?? os.homedir();
  const folders = [path.join(home, ".local", "bin")];

  // winget puts a link to the program here, and the running server's PATH does not know about it yet.
  const localAppData = input.env.LOCALAPPDATA;
  if (input.platform === "win32" && localAppData !== undefined) {
    folders.push(path.join(localAppData, "Microsoft", "WinGet", "Links"));
  }
  return folders;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false; // not there, or not readable by us
  }
}
