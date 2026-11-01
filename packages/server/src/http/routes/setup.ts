// Setup: POST /api/import-resume (a multipart upload: "file" and "kind") and POST /api/setup/finish.
import { UploadKind } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { invalid } from "../../services/serviceError";
import { finishSetup, importResume, MAX_UPLOAD_BYTES } from "../../services/setup";

export function setupRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.post("/import-resume", async (c) => {
    const form = await c.req.parseBody();
    const kind = UploadKind.safeParse(form.kind);
    const file = form.file;
    if (!kind.success || !(file instanceof File)) {
      throw invalid("invalid-request", "Choose a PDF or Word file to upload.", "Choose the file again.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw invalid("file-too-large", "That file is larger than 10 MB.", "Choose a smaller PDF or Word file.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return c.json(await importResume(ctx, { fileName: file.name, bytes, kind: kind.data }));
  });

  routes.post("/setup/finish", (c) => c.json(finishSetup(ctx)));

  return routes;
}
