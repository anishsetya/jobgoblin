// Your story: GET/POST /api/story, PUT /api/story/:id, POST /api/story/:id/confirm and /reject.
import { AddStoryItemRequest, EditStoryItemRequest } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { addStoryItem, confirmStoryItem, editStoryItem, listStory, rejectStoryItem } from "../../services/story";
import { parseJsonBody } from "../validation";

export function storyRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.get("/story", (c) => c.json(listStory(ctx)));
  routes.post("/story", async (c) => c.json(addStoryItem(ctx, await parseJsonBody(c, AddStoryItemRequest))));
  routes.put("/story/:id", async (c) => {
    return c.json(editStoryItem(ctx, c.req.param("id"), await parseJsonBody(c, EditStoryItemRequest)));
  });
  routes.post("/story/:id/confirm", (c) => c.json(confirmStoryItem(ctx, c.req.param("id"))));
  routes.post("/story/:id/reject", (c) => c.json(rejectStoryItem(ctx, c.req.param("id"))));

  return routes;
}
