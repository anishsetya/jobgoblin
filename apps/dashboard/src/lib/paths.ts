// Builds a path inside the person's folder for "Open resume file" and "Open tracker".
// The folder comes from the computer's own chooser, so it already uses that computer's separator;
// the same separator is used for the parts we add. The server checks the result stays inside the folder.

export function joinFolderPath(folder: string, ...parts: string[]): string {
  const separator = folder.includes("\\") ? "\\" : "/";
  const trimmedFolder = folder.replace(/[\\/]+$/, "");
  return [trimmedFolder, ...parts].join(separator);
}
