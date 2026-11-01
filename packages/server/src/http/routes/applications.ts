// One application: its detail, its resume PDF, and every decision the person can make about it.
// GET /api/apps/:id, GET /api/apps/:id/resume.pdf?version=, and POST approve, skip, undo-skip, withdraw,
// request-edit, tailor, ask, status, submitted.
import { ApproveRequest, StatusChangeRequest, SubmittedRequest } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { startAsk } from "../../services/askRuns";
import { approveApplication } from "../../services/approvals";
import { getApplicationDetail } from "../../services/applicationDetail";
import { changeStatus, skipApplication, undoSkip, withdrawApplication } from "../../services/decisions";
import { getResumePdf } from "../../services/resumePdf";
import { markSubmitted } from "../../services/submissions";
import { requestEdit, requestTailor } from "../../services/tailoring";
import { NoteBody, OptionalNoteBody, QuestionBody } from "../requestBodies";
import { parseJsonBody } from "../validation";

export function applicationRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.get("/apps/:id", (c) => c.json(getApplicationDetail(ctx, c.req.param("id"))));

  routes.get("/apps/:id/resume.pdf", async (c) => {
    const file = await getResumePdf(ctx, c.req.param("id"), c.req.query("version") ?? null);
    return new Response(file.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  });

  routes.post("/apps/:id/approve", async (c) => {
    const body = await parseJsonBody(c, ApproveRequest);
    return c.json(await approveApplication(ctx, { ...body, applicationId: c.req.param("id") }));
  });

  routes.post("/apps/:id/skip", (c) => c.json(skipApplication(ctx, c.req.param("id"))));
  routes.post("/apps/:id/undo-skip", (c) => c.json(undoSkip(ctx, c.req.param("id"))));

  routes.post("/apps/:id/withdraw", async (c) => {
    const { note } = await parseJsonBody(c, OptionalNoteBody);
    return c.json(withdrawApplication(ctx, c.req.param("id"), note));
  });

  routes.post("/apps/:id/request-edit", async (c) => {
    const { note } = await parseJsonBody(c, NoteBody);
    return c.json(requestEdit(ctx, c.req.param("id"), note));
  });

  routes.post("/apps/:id/tailor", (c) => c.json(requestTailor(ctx, c.req.param("id"))));

  routes.post("/apps/:id/ask", async (c) => {
    const { question } = await parseJsonBody(c, QuestionBody);
    return c.json(startAsk(ctx, c.req.param("id"), question));
  });

  routes.post("/apps/:id/status", async (c) => {
    const request = await parseJsonBody(c, StatusChangeRequest);
    return c.json(changeStatus(ctx, c.req.param("id"), request));
  });

  routes.post("/apps/:id/submitted", async (c) => {
    const request = await parseJsonBody(c, SubmittedRequest);
    return c.json(markSubmitted(ctx, { ...request, applicationId: c.req.param("id") }));
  });

  return routes;
}
