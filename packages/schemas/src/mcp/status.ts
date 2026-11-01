// The MCP tool update_status. No run kind may call it in the proof of concept (see RUN_KIND_TOOLS in
// toolNames.ts). It is here so the tool list matches the spec and a later run kind that reads replies can use it.
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { ApplicationStatus } from "../status";

export const UpdateStatusInput = z.object({
  applicationId: z.string(),
  to: ApplicationStatus,
});
export type UpdateStatusInput = z.infer<typeof UpdateStatusInput>;

export const UpdateStatusOutput = z.object({
  status: ApplicationStatus,
});
export type UpdateStatusOutput = z.infer<typeof UpdateStatusOutput>;
