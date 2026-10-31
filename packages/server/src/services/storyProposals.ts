// A setup run proposes story items (propose_story_items). They are saved as "pending" and only the person
// can confirm them. A run cannot know ids yet, so it labels each item with a tempId and nests an
// achievement under its experience with parentTempId; this file turns the labels into real ids.
// Spec: ARCHITECTURE.md section 9 (propose_story_items).
import type { ProposedStoryItem, ProposeStoryItemsOutput, StoryItem, StoryItemKind } from "@jobgoblin/schemas";
import { insertStoryItem, newId } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange } from "./changes";
import { failed, succeeded, type Outcome } from "./serviceError";

const MAX_ITEMS_PER_CALL = 300;
const PARENT_KINDS: readonly StoryItemKind[] = ["experience", "project"];

export function proposeStoryItems(ctx: ServerContext, items: ProposedStoryItem[]): Outcome<ProposeStoryItemsOutput> {
  const problems = findProblems(items);
  if (problems.length > 0) return failed(problems);

  const idByTempId = new Map(items.map((item) => [item.tempId, newId()]));
  const now = ctx.now().toISOString();

  const created = ctx.db.transaction(() => {
    const result: ProposeStoryItemsOutput["created"] = [];
    // Parents first, because parent_id is a foreign key.
    for (const item of parentsFirst(items)) {
      const id = idByTempId.get(item.tempId) ?? newId();
      const parentId = item.parentTempId === null ? null : (idByTempId.get(item.parentTempId) ?? null);
      const storyItem: StoryItem = {
        id,
        kind: item.kind,
        parentId,
        status: "pending",
        data: item.data,
        keywords: item.keywords,
        createdAt: now,
        updatedAt: now,
      };
      insertStoryItem(ctx.db, storyItem);
      result.push({ tempId: item.tempId, id });
    }
    return result;
  });

  announceProfileChange(ctx);
  return succeeded({ created });
}

function parentsFirst(items: readonly ProposedStoryItem[]): ProposedStoryItem[] {
  const parents = items.filter((item) => item.parentTempId === null);
  const children = items.filter((item) => item.parentTempId !== null);
  return [...parents, ...children];
}

function findProblems(items: readonly ProposedStoryItem[]): { code: string; message: string; path: string }[] {
  const problems: { code: string; message: string; path: string }[] = [];
  if (items.length > MAX_ITEMS_PER_CALL) {
    problems.push({ code: "too-many", path: "items", message: `Send at most ${MAX_ITEMS_PER_CALL} items in one call.` });
    return problems;
  }

  const byTempId = new Map<string, ProposedStoryItem>();
  items.forEach((item, index) => {
    if (byTempId.has(item.tempId)) {
      problems.push({ code: "duplicate-temp-id", path: `items[${index}].tempId`, message: `The tempId "${item.tempId}" is used twice.` });
    }
    byTempId.set(item.tempId, item);
  });

  items.forEach((item, index) => {
    const path = `items[${index}].parentTempId`;
    if (item.kind !== "achievement") {
      if (item.parentTempId !== null) {
        problems.push({ code: "wrong-parent", path, message: `A ${item.kind} cannot have a parent. Set parentTempId to null.` });
      }
      return;
    }
    const parent = item.parentTempId === null ? undefined : byTempId.get(item.parentTempId);
    if (parent === undefined || !PARENT_KINDS.includes(parent.kind)) {
      problems.push({
        code: "wrong-parent",
        path,
        message: "An achievement needs parentTempId set to the tempId of an experience or project in the same call.",
      });
    }
  });
  return problems;
}
