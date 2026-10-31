// The server-sent events on /api/events. They carry just enough for the dashboard to know what to
// refetch; the data itself always comes from the normal routes.
// Spec: "Local HTTP API and authentication" (GET /api/events). ARCHITECTURE.md section 5.10.
import { z } from "zod";
import { Run } from "./run";
import { ApplicationStatus } from "./status";

export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.updated"), run: Run }),
  z.object({
    type: z.literal("application.updated"),
    applicationId: z.string(),
    status: ApplicationStatus,
  }),
  z.object({ type: z.literal("needs-you.changed") }),
  z.object({ type: z.literal("profile.updated") }),
  z.object({ type: z.literal("backup.done"), at: z.iso.datetime() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
