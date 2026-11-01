// Makes the demo person's uploaded resume in both formats: fixtures/resumes/alex-rivera.pdf and
// fixtures/resumes/alex-rivera.docx. Both are built from alex-rivera.story.json, so the content is
// the same as Your story in the other fixtures. Run it again after changing the story file or the template:
//   pnpm --filter @jobgoblin/render fixtures
// Spec: fixtures/README.md ("resumes/: the demo person's resume").
import { writeFileSync } from "node:fs";
import { createResumeRenderer, defaultTemplatesDir, readPdf } from "../src/index";
import { buildResumeView } from "../src/resumeView";
import { buildFullBody, loadAlexRivera, resumeFixturePath } from "../src/testSupport";
import { buildDocx } from "./docxWriter";

// This is Alex's own resume, not one Jobgoblin tailored, so it has no real version id.
const SAMPLE_VERSION_ID = "alex-rivera-sample";

async function main(): Promise<void> {
  const { header, storyItems } = loadAlexRivera();
  const input = { header, body: buildFullBody(storyItems), storyItems, versionId: SAMPLE_VERSION_ID };

  const renderer = createResumeRenderer({ templatesDir: defaultTemplatesDir() });
  const pdf = await renderer.renderResumePdf(input);
  const { pages } = await readPdf(pdf);
  if (pages !== 1) throw new Error(`The demo resume should be one page, but it is ${pages}.`);

  writeFileSync(resumeFixturePath("alex-rivera.pdf"), pdf);
  writeFileSync(resumeFixturePath("alex-rivera.docx"), buildDocx(buildResumeView(input)));
  console.log("Wrote fixtures/resumes/alex-rivera.pdf and alex-rivera.docx");
}

await main();
