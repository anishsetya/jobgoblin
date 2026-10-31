// Your story: everything the person has confirmed about themselves (experiences, projects,
// achievements, skills, headlines). A resume is only a selection from it, so truthfulness starts here.
// Spec: "Data model and storage" (story_items) and "Resume pipeline". ARCHITECTURE.md section 5.2.
import { z } from "zod";

export const StoryItemKind = z.enum([
  "experience",
  "project",
  "education",
  "achievement",
  "skill",
  "headline",
]);
export type StoryItemKind = z.infer<typeof StoryItemKind>;

// Nothing reaches a resume until the person confirms it, so a run can only ever propose "pending" items.
export const StoryItemStatus = z.enum(["pending", "confirmed", "rejected"]);
export type StoryItemStatus = z.infer<typeof StoryItemStatus>;

// Dates are "YYYY-MM" or "YYYY" (end dates may also be "Present"). One format keeps the truth trace's
// date comparison exact: it never has to guess that "Jun 2024" and "2024-06" are the same month.
const StartDate = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Write dates as YYYY-MM or YYYY.");
const EndDate = z
  .string()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?|Present)$/, "Write dates as YYYY-MM, YYYY or Present.");

export const StoryItemData = z.object({
  text: z.string().min(1), // the bullet, headline, skill name, or a one-line summary
  title: z.string().optional(), // job title, project name, degree
  organization: z.string().optional(), // company, school
  location: z.string().optional(),
  startDate: StartDate.optional(),
  endDate: EndDate.optional(),
  tools: z.array(z.string()).default([]),
  numbers: z.array(z.string()).default([]), // "40%", "$2M", "500"
});
export type StoryItemData = z.infer<typeof StoryItemData>;

// Achievements point at their experience or project with parentId. Skills and headlines have no parent.
export const StoryItem = z.object({
  id: z.string(),
  kind: StoryItemKind,
  parentId: z.string().nullable(),
  status: StoryItemStatus,
  data: StoryItemData,
  keywords: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoryItem = z.infer<typeof StoryItem>;

// What a setup run sends to propose_story_items: a StoryItem without the fields the server assigns
// (id, parentId, status, timestamps). The run cannot know ids yet, so it nests an achievement under its
// experience with labels instead: give the experience a tempId and the achievement that same tempId as
// its parentTempId, in the same call. The server turns the labels into real ids.
// Proposals are lenient, because they come from a model: keywords and parentTempId may be left out.
export const ProposedStoryItem = StoryItem.omit({
  id: true,
  parentId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  tempId: z
    .string()
    .min(1)
    .describe("A label of your choice, so other items in this call can name this one as their parent."),
  parentTempId: z
    .string()
    .nullable()
    .default(null)
    .describe("tempId of the experience or project this achievement belongs to, or null."),
  keywords: z.array(z.string()).default([]),
});
export type ProposedStoryItem = z.infer<typeof ProposedStoryItem>;

// The documents the person uploads in setup, which Your story is filled from.
export const UploadKind = z.enum(["resume", "linkedin"]);
export type UploadKind = z.infer<typeof UploadKind>;
