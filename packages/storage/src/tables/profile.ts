// Table `profile`: the person's facts and form answers, one row per section.
// Sections that were never saved come back as the schema's defaults ("TODO" for every missing value).
// Spec: ARCHITECTURE.md sections 5.3 and 7.
import { Profile, type ProfileSectionName } from "@jobgoblin/schemas";
import type { Database } from "../database";
import { jsonColumn, toJson } from "../rows";

export function getProfile(db: Database): Profile {
  const rows = db.sqlite.prepare("SELECT section, data FROM profile").all();

  const savedSections: Record<string, unknown> = {};
  for (const row of rows) {
    savedSections[String(row.section)] = jsonColumn(row, "data");
  }
  // Profile.parse fills every section that has no row with its defaults.
  return Profile.parse(savedSections);
}

export function getProfileSection<Section extends ProfileSectionName>(db: Database, section: Section): Profile[Section] {
  return getProfile(db)[section];
}

export function saveProfileSection<Section extends ProfileSectionName>(
  db: Database,
  section: Section,
  data: Profile[Section],
  updatedAt: string,
): void {
  // Parse before writing, so a row that could not be read back never gets in.
  const validData = Profile.shape[section].parse(data);

  db.sqlite
    .prepare(
      `INSERT INTO profile (section, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (section) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(section, toJson(validData), updatedAt);
}
