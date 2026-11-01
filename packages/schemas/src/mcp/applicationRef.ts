// A short reference to an application, for the tools that do not need the whole record
// (get_tailoring_context and get_approved). Not exported from the package: it is a detail of those two schemas.
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";

export const ApplicationRef = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
});
