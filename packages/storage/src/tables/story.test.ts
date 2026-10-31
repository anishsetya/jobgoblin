import { afterEach, describe, expect, it } from "vitest";
import { aStoryItem, openTestDatabase, removeTempDirs } from "../testSupport";
import {
  getStoryItem,
  insertStoryItem,
  listStoryItems,
  listStoryItemsByIds,
  listStoryItemsByStatus,
  setStoryItemStatus,
  updateStoryItem,
} from "./story";

afterEach(removeTempDirs);

function anAchievement(id: string, parentId: string) {
  return aStoryItem({
    id,
    kind: "achievement",
    parentId,
    status: "pending",
    data: { text: "Cut p95 latency 40% with a Redis cache", tools: ["Redis"], numbers: ["40%"] },
  });
}

describe("story items", () => {
  it("saves an experience and its achievement and reads both back unchanged", () => {
    const db = openTestDatabase();
    const experience = aStoryItem({ id: "exp-1" });
    const achievement = anAchievement("ach-1", "exp-1");

    insertStoryItem(db, experience);
    insertStoryItem(db, achievement);

    expect(getStoryItem(db, "exp-1")).toEqual(experience);
    expect(getStoryItem(db, "ach-1")).toEqual(achievement);
    db.close();
  });

  it("returns null for an item that does not exist", () => {
    const db = openTestDatabase();

    expect(getStoryItem(db, "nothing")).toBeNull();
    db.close();
  });

  it("refuses an achievement whose experience has not been saved yet", () => {
    const db = openTestDatabase();

    const insertChildFirst = () => insertStoryItem(db, anAchievement("ach-1", "exp-1"));

    expect(insertChildFirst).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("lists items oldest first, by status, and by id", () => {
    const db = openTestDatabase();
    insertStoryItem(db, aStoryItem({ id: "exp-1", createdAt: "2026-10-30T09:00:00.000Z" }));
    insertStoryItem(db, anAchievement("ach-1", "exp-1"));
    insertStoryItem(db, aStoryItem({ id: "skill-1", kind: "skill", status: "rejected" }));

    expect(listStoryItems(db).map((item) => item.id)).toEqual(["exp-1", "ach-1", "skill-1"]);
    expect(listStoryItemsByStatus(db, "confirmed").map((item) => item.id)).toEqual(["exp-1"]);
    expect(listStoryItemsByIds(db, ["skill-1", "exp-1", "unknown"]).map((item) => item.id)).toEqual(["exp-1", "skill-1"]);
    expect(listStoryItemsByIds(db, [])).toEqual([]);
    db.close();
  });

  it("changes the words of an item without changing its kind or status", () => {
    const db = openTestDatabase();
    insertStoryItem(db, aStoryItem({ id: "exp-1" }));
    insertStoryItem(db, anAchievement("ach-1", "exp-1"));

    const updated = updateStoryItem(db, {
      id: "ach-1",
      data: { text: "Cut p95 latency 40%", tools: [], numbers: ["40%"] },
      keywords: ["latency"],
      updatedAt: "2026-11-01T10:00:00.000Z",
    });

    expect(updated?.data.text).toBe("Cut p95 latency 40%");
    expect(updated?.keywords).toEqual(["latency"]);
    expect(updated?.status).toBe("pending");
    expect(updated?.updatedAt).toBe("2026-11-01T10:00:00.000Z");
    db.close();
  });

  it("confirms an item, and returns null for an item that does not exist", () => {
    const db = openTestDatabase();
    insertStoryItem(db, aStoryItem({ id: "exp-1" }));
    insertStoryItem(db, anAchievement("ach-1", "exp-1"));

    const confirmed = setStoryItemStatus(db, { id: "ach-1", status: "confirmed", updatedAt: "2026-11-01T10:00:00.000Z" });
    const missing = setStoryItemStatus(db, { id: "nothing", status: "confirmed", updatedAt: "2026-11-01T10:00:00.000Z" });

    expect(confirmed?.status).toBe("confirmed");
    expect(missing).toBeNull();
    db.close();
  });
});
