import { afterEach, describe, expect, it } from "vitest";
import type { ProposedStoryItem } from "@jobgoblin/schemas";
import { getStoryItem, listStoryItems } from "@jobgoblin/storage";
import { addStoryItem, confirmStoryItem, editStoryItem, listStory, rejectStoryItem } from "./story";
import { proposeStoryItems } from "./storyProposals";
import { closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

const data = (text: string) => ({ text, tools: [], numbers: [] });

function proposal(overrides: Partial<ProposedStoryItem> & Pick<ProposedStoryItem, "tempId" | "kind">): ProposedStoryItem {
  return { parentTempId: null, data: data("Something"), keywords: [], ...overrides };
}

describe("Your story as the person edits it", () => {
  it("adds an item the person typed as already confirmed", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const item = addStoryItem(ctx, { kind: "skill", parentId: null, data: data("Rust"), keywords: [] });

    expect(item.status).toBe("confirmed");
    expect(listStory(ctx)).toHaveLength(1);
  });

  it("puts an achievement under an experience and refuses one with no parent", () => {
    const ctx = createTestContext();

    const achievement = addStoryItem(ctx, { kind: "achievement", parentId: "exp-northwind", data: data("Cut costs 20%"), keywords: [] });

    expect(achievement.parentId).toBe("exp-northwind");
    expect(() => addStoryItem(ctx, { kind: "achievement", parentId: null, data: data("Floating"), keywords: [] })).toThrowError(
      expect.objectContaining({ code: "wrong-parent" }),
    );
    expect(() => addStoryItem(ctx, { kind: "skill", parentId: "exp-northwind", data: data("Go"), keywords: [] })).toThrowError(
      expect.objectContaining({ code: "wrong-parent" }),
    );
  });

  it("sends an edited item back to pending until it is confirmed again", () => {
    const ctx = createTestContext();

    const edited = editStoryItem(ctx, "ach-northwind-latency", { data: data("Cut latency 45% with a cache"), keywords: ["cache"] });

    expect(edited.status).toBe("pending");
    expect(edited.data.text).toBe("Cut latency 45% with a cache");
    expect(confirmStoryItem(ctx, edited.id).status).toBe("confirmed");
  });

  it("confirms and rejects an item", () => {
    const ctx = createTestContext({ withAlexRivera: false });
    const item = addStoryItem(ctx, { kind: "skill", parentId: null, data: data("Rust"), keywords: [] });

    expect(rejectStoryItem(ctx, item.id).status).toBe("rejected");
    expect(confirmStoryItem(ctx, item.id).status).toBe("confirmed");
  });

  it("says plainly when the item does not exist", () => {
    const ctx = createTestContext();

    expect(() => confirmStoryItem(ctx, "nope")).toThrowError(expect.objectContaining({ code: "not-found" }));
  });
});

describe("proposeStoryItems", () => {
  it("saves pending items and turns tempIds into real ids, parents first", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const outcome = proposeStoryItems(ctx, [
      proposal({ tempId: "a1", kind: "achievement", parentTempId: "e1", data: data("Built the thing") }),
      proposal({ tempId: "e1", kind: "experience", data: data("Engineer at Acme") }),
    ]);

    expect(outcome.ok).toBe(true);
    const created = outcome.ok ? outcome.value.created : [];
    const idOf = (tempId: string) => created.find((entry) => entry.tempId === tempId)?.id ?? "";
    const achievement = getStoryItem(ctx.db, idOf("a1"));
    expect(achievement).toMatchObject({ status: "pending", parentId: idOf("e1"), kind: "achievement" });
    expect(listStoryItems(ctx.db).every((item) => item.status === "pending")).toBe(true);
  });

  it("returns every problem at once and saves nothing", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const outcome = proposeStoryItems(ctx, [
      proposal({ tempId: "x", kind: "skill", parentTempId: "x" }),
      proposal({ tempId: "x", kind: "experience" }),
      proposal({ tempId: "a", kind: "achievement", parentTempId: "missing" }),
    ]);

    const codes = outcome.ok ? [] : outcome.errors.map((error) => error.code);
    expect(codes).toEqual(expect.arrayContaining(["duplicate-temp-id", "wrong-parent"]));
    expect(listStoryItems(ctx.db)).toHaveLength(0);
  });
});
