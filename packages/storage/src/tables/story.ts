// Table `story_items`: Your story, everything the person has confirmed about themselves.
// Only confirmed items may reach a resume; this module just stores and finds them.
// Spec: ARCHITECTURE.md sections 5.2 and 7.
import { StoryItem, StoryItemData, type StoryItemStatus } from "@jobgoblin/schemas";
import type { Database } from "../database";
import { jsonColumn, placeholders, toJson, type Row } from "../rows";

function toStoryItem(row: Row): StoryItem {
  return StoryItem.parse({
    id: row.id,
    kind: row.kind,
    parentId: row.parent_id,
    status: row.status,
    data: jsonColumn(row, "data"),
    keywords: jsonColumn(row, "keywords"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// Insert a parent (experience or project) before its achievements: parent_id is a foreign key.
export function insertStoryItem(db: Database, item: StoryItem): void {
  const valid = StoryItem.parse(item);
  db.sqlite
    .prepare(
      `INSERT INTO story_items (id, kind, parent_id, status, data, keywords, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(valid.id, valid.kind, valid.parentId, valid.status, toJson(valid.data), toJson(valid.keywords), valid.createdAt, valid.updatedAt);
}

export function getStoryItem(db: Database, id: string): StoryItem | null {
  const row = db.sqlite.prepare("SELECT * FROM story_items WHERE id = ?").get(id);
  return row === undefined ? null : toStoryItem(row);
}

// Oldest first, which keeps a parent ahead of the achievements that were proposed with it.
export function listStoryItems(db: Database): StoryItem[] {
  const rows = db.sqlite.prepare("SELECT * FROM story_items ORDER BY created_at, rowid").all();
  return rows.map(toStoryItem);
}

export function listStoryItemsByStatus(db: Database, status: StoryItemStatus): StoryItem[] {
  const rows = db.sqlite
    .prepare("SELECT * FROM story_items WHERE status = ? ORDER BY created_at, rowid")
    .all(status);
  return rows.map(toStoryItem);
}

// For screens that show only the items a resume cites or a fit matched. Unknown ids are simply absent.
export function listStoryItemsByIds(db: Database, ids: readonly string[]): StoryItem[] {
  if (ids.length === 0) return [];
  const rows = db.sqlite
    .prepare(`SELECT * FROM story_items WHERE id IN (${placeholders(ids)}) ORDER BY created_at, rowid`)
    .all(...ids);
  return rows.map(toStoryItem);
}

export type StoryItemEdit = { id: string; data: StoryItemData; keywords: string[]; updatedAt: string };

// The person edits the words of an item. Returns the updated item, or null when there is no such item.
// Kind, parent and status do not change here: confirming or dropping goes through setStoryItemStatus.
export function updateStoryItem(db: Database, edit: StoryItemEdit): StoryItem | null {
  const validData = StoryItemData.parse(edit.data);
  db.sqlite
    .prepare("UPDATE story_items SET data = ?, keywords = ?, updated_at = ? WHERE id = ?")
    .run(toJson(validData), toJson(edit.keywords), edit.updatedAt, edit.id);
  return getStoryItem(db, edit.id);
}

export type StoryItemStatusChange = { id: string; status: StoryItemStatus; updatedAt: string };

export function setStoryItemStatus(db: Database, change: StoryItemStatusChange): StoryItem | null {
  db.sqlite
    .prepare("UPDATE story_items SET status = ?, updated_at = ? WHERE id = ?")
    .run(change.status, change.updatedAt, change.id);
  return getStoryItem(db, change.id);
}
