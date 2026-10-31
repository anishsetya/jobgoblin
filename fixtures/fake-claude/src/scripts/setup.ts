// The "setup" run, scripted. Claude would read the uploaded resume and propose Your story from it.
// The fake does not read the resume text: it always proposes Alex Rivera's story, so a test never
// depends on how well the resume importer works.
//
// The calls, in order:
//   1. import_resume          read what was uploaded (contact details are already taken out)
//   2. propose_story_items    add every item to Your story as pending; only the person can confirm them
//   3. save_profile_section   fill in the employment details the resume shows
// Spec: ARCHITECTURE.md section 14 (setup).
import { ALEX_RIVERA_PROPOSED_ITEMS } from "../data";
import type { RunScript } from "../session";

// Only values the resume itself shows. Notice period and start date are the person's to type.
const EMPLOYMENT_FROM_RESUME = {
  currentEmployer: "Northwind Logistics",
  currentTitle: "Software Engineer",
  yearsExperience: "2",
};

export const runSetupScript: RunScript = async (session) => {
  await session.callForData("import_resume", {});

  const { created } = await session.callForData("propose_story_items", { items: ALEX_RIVERA_PROPOSED_ITEMS });

  await session.callForData("save_profile_section", { section: "employment", data: EMPLOYMENT_FROM_RESUME });

  return `Proposed ${created.length} items for Your story and filled in your employment details.`;
};
