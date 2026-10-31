// Table `settings`: the person's settings, one JSON value per key. A key with no row has the
// default that the Settings schema gives it, so a fresh install needs no rows at all.
// The Claude command is deliberately not a setting (decision D21).
// Spec: ARCHITECTURE.md sections 5.9 and 7.
import { Settings } from "@jobgoblin/schemas";
import { atomically, type Database } from "../database";
import { jsonColumn, toJson } from "../rows";

type SettingKey = keyof Settings;

// Every setting, with defaults for the ones never saved.
export function getSettings(db: Database): Settings {
  const rows = db.sqlite.prepare("SELECT key, value FROM settings").all();
  const saved: Record<string, unknown> = {};
  for (const row of rows) {
    saved[String(row.key)] = jsonColumn(row, "value");
  }
  // Settings.parse applies the defaults and drops any key that is not a setting.
  return Settings.parse(saved);
}

export function getSetting<Key extends SettingKey>(db: Database, key: Key): Settings[Key] {
  return getSettings(db)[key];
}

export function setSetting<Key extends SettingKey>(db: Database, key: Key, value: Settings[Key]): void {
  // Each setting is checked against its own schema, so a value of the wrong kind never reaches the table.
  const validValue = Settings.shape[key].parse(value);
  db.sqlite
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, toJson(validValue));
}

// Saves several settings at once. A setting left out is not touched.
export function setSettings(db: Database, changes: Partial<Settings>): void {
  atomically(db, () => {
    // Walk the schema's own keys, so a stray key in `changes` is ignored rather than stored.
    for (const key of Object.keys(Settings.shape) as SettingKey[]) {
      const value = changes[key];
      if (value === undefined) continue;
      setSetting(db, key, value);
    }
  });
}
