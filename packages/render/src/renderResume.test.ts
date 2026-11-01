// Tests of the whole render path: view model -> Typst template -> PDF -> read back with pdf.js.
// They render real PDFs (about 100 ms each) and check what a reader of the PDF would see.
// Spec: ARCHITECTURE.md section 15 (render tests).
import { describe, expect, it } from "vitest";
import type { ResumeBody, StoryItem } from "@jobgoblin/schemas";
import { TEMPLATE_VERSION, createResumeRenderer, defaultTemplatesDir, readPdf } from "./index";
import { buildFullBody, loadAlexRivera } from "./testSupport";
import { withOpenPdf } from "./withOpenPdf";

const VERSION_ID = `r-${"ab".repeat(32)}`;
const renderer = createResumeRenderer({ templatesDir: defaultTemplatesDir() });
const alex = loadAlexRivera();

function anAlexResume(overrides: { body?: ResumeBody; storyItems?: StoryItem[] } = {}) {
  const storyItems = overrides.storyItems ?? alex.storyItems;
  return {
    header: alex.header,
    body: overrides.body ?? buildFullBody(storyItems),
    storyItems,
    versionId: VERSION_ID,
  };
}

// Line breaks and spacing in extracted text depend on layout, so compare with all whitespace removed.
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function allBulletTexts(body: ResumeBody): string[] {
  const entries = [...body.sections.experience, ...body.sections.projects];
  return entries.flatMap((entry) => entry.bullets.map((bullet) => bullet.text));
}

async function readKeywords(pdf: Uint8Array): Promise<string | undefined> {
  return withOpenPdf(pdf, async (document) => {
    const { info } = await document.getMetadata();
    return "Keywords" in info && typeof info.Keywords === "string" ? info.Keywords : undefined;
  });
}

describe("renderResumePdf", () => {
  it("renders the demo resume as exactly one page with the name and every bullet", async () => {
    const input = anAlexResume();

    const pdf = await renderer.renderResumePdf(input);
    const { pages, text } = await readPdf(pdf);

    expect(pages).toBe(1);
    expect(withoutWhitespace(text)).toContain(withoutWhitespace("Alex Rivera"));
    for (const bulletText of allBulletTexts(input.body)) {
      expect(withoutWhitespace(text)).toContain(withoutWhitespace(bulletText));
    }
  });

  it("prints company, title, location and dates from the cited story items", async () => {
    const pdf = await renderer.renderResumePdf(anAlexResume());

    const { text } = await readPdf(pdf);

    expect(text).toContain("Northwind Logistics");
    expect(text).toContain("Software Engineer");
    expect(text).toContain("Jun 2024 \u2013 Present");
    expect(text).toContain("State University");
    expect(text).toContain("Aug 2020 \u2013 May 2024");
  });

  it("prints the contact line with the email and links from the header", async () => {
    const pdf = await renderer.renderResumePdf(anAlexResume());

    const { text } = await readPdf(pdf);

    expect(text).toContain("alex.rivera@example.com");
    expect(text).toContain("+1 555 0100");
    expect(text).toContain("github.com/alexrivera-example");
  });

  it("reads an oversized resume back as two or more pages", async () => {
    const body = buildFullBody(alex.storyItems);
    const firstEntry = body.sections.experience[0];
    const aBullet = firstEntry?.bullets[0];
    if (firstEntry === undefined || aBullet === undefined) throw new Error("The demo resume needs an experience bullet.");
    const oversized: ResumeBody = {
      ...body,
      sections: {
        ...body.sections,
        experience: [{ ...firstEntry, bullets: Array.from({ length: 45 }, () => aBullet) }],
      },
    };

    const pdf = await renderer.renderResumePdf(anAlexResume({ body: oversized }));
    const { pages } = await readPdf(pdf);

    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it("puts the version id in the PDF's Keywords property", async () => {
    const pdf = await renderer.renderResumePdf(anAlexResume());

    const keywords = await readKeywords(pdf);

    expect(keywords).toBe(VERSION_ID);
  });

  it("produces the same bytes every time for the same resume", async () => {
    const first = await renderer.renderResumePdf(anAlexResume());
    const second = await renderer.renderResumePdf(anAlexResume());

    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("prints Typst special characters literally", async () => {
    const hostileText = "Saved $5 on C# and F# *bold* _under_ ask@example.com <tag> back\\slash 50% a~b -- [x] {y}";
    const storyItems = alex.storyItems.map((item) =>
      item.id === "ach-northwind-latency" ? { ...item, data: { ...item.data, text: hostileText } } : item,
    );
    const body = buildFullBody(storyItems);

    const pdf = await renderer.renderResumePdf(anAlexResume({ body, storyItems }));
    const { pages, text } = await readPdf(pdf);

    expect(pages).toBe(1);
    expect(withoutWhitespace(text)).toContain(withoutWhitespace(hostileText));
  });

  it("does not run Typst code or markup hidden in resume text", async () => {
    const attack = '#panic("boom") $ x^2 $ ] #set page(paper: "a4") #import "x.typ": * /* #show: none */ `raw`';
    const storyItems = alex.storyItems.map((item) =>
      item.id === "exp-northwind" ? { ...item, data: { ...item.data, organization: attack } } : item,
    );

    const pdf = await renderer.renderResumePdf(anAlexResume({ storyItems }));
    const { pages, text } = await readPdf(pdf);

    expect(pages).toBe(1);
    expect(withoutWhitespace(text)).toContain(withoutWhitespace(attack));
  });

  it("refuses to render a resume that cites a story item that was not given", async () => {
    const body = buildFullBody(alex.storyItems);
    const storyItemsWithoutNorthwind = alex.storyItems.filter((item) => item.id !== "exp-northwind");

    const render = renderer.renderResumePdf({ ...anAlexResume({ body }), storyItems: storyItemsWithoutNorthwind });

    await expect(render).rejects.toThrow(/exp-northwind/);
  });
});

describe("createResumeRenderer", () => {
  it("fails at once when the templates folder has no template for the current version", () => {
    const createWithWrongFolder = () => createResumeRenderer({ templatesDir: "C:\\no\\such\\templates" });

    expect(createWithWrongFolder).toThrow(/resume template was not found/);
  });

  it("uses the template version that goes into every resume version id", () => {
    expect(TEMPLATE_VERSION).toBe("t1");
  });
});
