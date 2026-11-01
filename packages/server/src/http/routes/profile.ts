// GET /api/profile and PUT /api/profile/:section. The body of a PUT is checked against that section's own
// schema (Profile.shape[section]), so "targets" can never be saved with the shape of "contact".
import { Profile, ProfileSectionName } from "@jobgoblin/schemas";
import { Hono, type Context } from "hono";
import type { ZodType } from "zod";
import type { ServerContext } from "../../context";
import { getProfile, updateProfileSection } from "../../services/profile";
import { notFound } from "../../services/serviceError";
import { parseJsonBody } from "../validation";

export function profileRoutes(ctx: ServerContext): Hono {
  const routes = new Hono();

  routes.get("/profile", (c) => c.json(getProfile(ctx)));

  routes.put("/profile/:section", async (c) => {
    const section = ProfileSectionName.safeParse(c.req.param("section"));
    if (!section.success) throw notFound("part of your profile");
    return c.json(await saveSection(ctx, c, section.data));
  });

  return routes;
}

// The body is checked against the schema of the section named in the address.
async function saveSection<Section extends ProfileSectionName>(ctx: ServerContext, c: Context, section: Section) {
  const sectionSchema = Profile.shape[section] as unknown as ZodType<Profile[Section]>;
  return updateProfileSection(ctx, section, await parseJsonBody(c, sectionSchema));
}
