// POST /api/questions/:id/answer: the person answers a question a run asked.
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { answerQuestion } from "../../services/questions";
import { AnswerBody } from "../requestBodies";
import { parseJsonBody } from "../validation";

export function questionRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.post("/questions/:id/answer", async (c) => {
    const { answer } = await parseJsonBody(c, AnswerBody);
    return c.json(answerQuestion(ctx, c.req.param("id"), answer));
  });

  return routes;
}
