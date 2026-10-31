// Your story as the person edits it: list, add, edit, confirm, reject. Nothing reaches a resume until the
// person confirms it, and an edited item goes back to pending, because a changed fact must be confirmed again.
// Truthfulness control: only the person can confirm an item; a run can only propose pending ones (storyProposals.ts).
// Spec: ARCHITECTURE.md sections 5.2 and 11 (/api/story).
import type { AddStoryItemRequest, EditStoryItemRequest, StoryItem, StoryItemKind } from "@jobgoblin/schemas";
import {
  getStoryItem,
  insertStoryItem,
  listStoryItems,
  newId,
  setStoryItemStatus,
  updateStoryItem,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange, saveChangesSoon } from "./changes";
import { invalid, notFound } from "./serviceError";

// Achievements hang under an experience or a project; every other kind stands alone.
const PARENT_KINDS: readonly StoryItemKind[] = ["experience", "project"];

export function listStory(ctx: ServerContext): StoryItem[] {
  return listStoryItems(ctx.db);
}

// An item the person types in themselves needs no second look: it is confirmed at once.
export function addStoryItem(ctx: ServerContext, request: AddStoryItemRequest): StoryItem {
  refuseWrongParent(ctx, request.kind, request.parentId);
  const now = ctx.now().toISOString();
  const item: StoryItem = {
    id: newId(),
    kind: request.kind,
    parentId: request.parentId,
    status: "confirmed",
    data: request.data,
    keywords: request.keywords,
    createdAt: now,
    updatedAt: now,
  };
  insertStoryItem(ctx.db, item);
  finishStoryChange(ctx);
  return item;
}

// Editing changes the facts, so the item goes back to pending until the person confirms it again.
export function editStoryItem(
  ctx: ServerContext,
  itemId: string,
  changes: EditStoryItemRequest,
): StoryItem {
  loadItemOrFail(ctx, itemId);
  const updatedAt = ctx.now().toISOString();
  const edited = ctx.db.transaction(() => {
    updateStoryItem(ctx.db, { id: itemId, data: changes.data, keywords: changes.keywords, updatedAt });
    return setStoryItemStatus(ctx.db, { id: itemId, status: "pending", updatedAt });
  });
  finishStoryChange(ctx);
  return edited ?? loadItemOrFail(ctx, itemId);
}

export function confirmStoryItem(ctx: ServerContext, itemId: string): StoryItem {
  return decide(ctx, itemId, "confirmed");
}

export function rejectStoryItem(ctx: ServerContext, itemId: string): StoryItem {
  return decide(ctx, itemId, "rejected");
}

function decide(ctx: ServerContext, itemId: string, status: "confirmed" | "rejected"): StoryItem {
  loadItemOrFail(ctx, itemId);
  const item = setStoryItemStatus(ctx.db, { id: itemId, status, updatedAt: ctx.now().toISOString() });
  finishStoryChange(ctx);
  return item ?? loadItemOrFail(ctx, itemId);
}

function loadItemOrFail(ctx: ServerContext, itemId: string): StoryItem {
  const item = getStoryItem(ctx.db, itemId);
  if (item === null) throw notFound("item in Your story", "Reload Your story and try again.");
  return item;
}

function refuseWrongParent(ctx: ServerContext, kind: StoryItemKind, parentId: string | null): void {
  if (kind !== "achievement") {
    if (parentId !== null) {
      throw invalid("wrong-parent", `A ${kind} does not belong under another item.`, "Leave the parent empty.");
    }
    return;
  }
  const parent = parentId === null ? null : getStoryItem(ctx.db, parentId);
  if (parent === null || !PARENT_KINDS.includes(parent.kind)) {
    throw invalid(
      "wrong-parent",
      "An achievement must belong to an experience or a project.",
      "Choose the experience or project it belongs to.",
    );
  }
}

// Resumes and fits read Your story, so a change here also changes what Review can show.
function finishStoryChange(ctx: ServerContext): void {
  announceProfileChange(ctx);
  saveChangesSoon(ctx);
}
