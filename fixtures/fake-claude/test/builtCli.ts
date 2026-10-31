// Where the built fake is, and a check that it is not older than the code it was built from.
// The tests run the bundle (dist/cli.mjs), exactly as the runner does, so a stale bundle would test old
// code and pass or fail for the wrong reason. Build with `pnpm --filter @jobgoblin/fake-claude build`.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUILT_CLI_PATH = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));

// Everything that ends up inside the bundle: the fake's own code and data, and the schemas it bundles.
const SOURCE_FOLDERS = [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../data", import.meta.url)),
  fileURLToPath(new URL("../../../packages/schemas/src", import.meta.url)),
];

export function assertBuiltCliIsCurrent(): void {
  let builtAt: number;
  try {
    builtAt = statSync(BUILT_CLI_PATH).mtimeMs;
  } catch {
    throw new Error("dist/cli.mjs does not exist. Run: pnpm --filter @jobgoblin/fake-claude build");
  }

  const newestSource = newestChange(SOURCE_FOLDERS);
  if (newestSource.modifiedAt > builtAt) {
    throw new Error(
      `dist/cli.mjs is older than ${newestSource.file}. Run: pnpm --filter @jobgoblin/fake-claude build`,
    );
  }
}

function newestChange(folders: string[]): { file: string; modifiedAt: number } {
  let newest = { file: "", modifiedAt: 0 };

  for (const folder of folders) {
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      // Tests are not part of the bundle.
      if (!entry.isFile() || entry.name.endsWith(".test.ts")) continue;

      const file = join(entry.parentPath, entry.name);
      const modifiedAt = statSync(file).mtimeMs;
      if (modifiedAt > newest.modifiedAt) newest = { file, modifiedAt };
    }
  }
  return newest;
}
