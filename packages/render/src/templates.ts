// Which resume template is current, and where the template files live on disk.
// The template version goes into every resume version id (decision D18), so changing the template
// layout means bumping this constant and adding a new folder next to t1; old folders stay so an old
// version can still be explained. Resource lookup rules: ARCHITECTURE.md decision D2 and section 8.1.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_VERSION = "t1";

// The Typst file of a template version, inside a templates folder.
export const TEMPLATE_FILE_NAME = "resume.typ";

// The templates folder of this source checkout, for development and tests only. The real app is told
// where its templates are (`resourcesDir` + "packages/render/templates"), because after bundling,
// a path relative to this file no longer points at the source tree.
export function defaultTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "..", "templates");
}

export function templateFilePath(templatesDir: string, templateVersion: string): string {
  return path.join(templatesDir, templateVersion, TEMPLATE_FILE_NAME);
}
