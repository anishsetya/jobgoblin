// GET /api/export/csv and /api/export/xlsx: the tracker as a file download.
import { Hono } from "hono";
import type { ServerContext } from "../../context";
import { exportTracker, type ExportFormat } from "../../services/exports";

export function exportRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  for (const format of ["csv", "xlsx"] as const satisfies readonly ExportFormat[]) {
    routes.get(`/export/${format}`, async (c) => {
      const file = await exportTracker(ctx, format);
      return new Response(file.bytes, {
        headers: {
          "Content-Type": file.contentType,
          "Content-Disposition": `attachment; filename="${file.fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    });
  }

  return routes;
}
