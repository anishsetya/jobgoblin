// Tests of the view model: how a resume body and the story items it cites become the strings the
// template prints. No PDF is rendered here, so these run in a few milliseconds.
// Spec: ARCHITECTURE.md section 8.1.
import { describe, expect, it } from "vitest";
import type { ResumeBody, ResumeHeader } from "@jobgoblin/schemas";
import { formatDateRange } from "./resumeDates";
import { buildResumeView } from "./resumeView";
import { buildFullBody, loadAlexRivera } from "./testSupport";

const alex = loadAlexRivera();

function viewOf(overrides: { header?: ResumeHeader; body?: ResumeBody } = {}) {
  return buildResumeView({
    header: overrides.header ?? alex.header,
    body: overrides.body ?? buildFullBody(alex.storyItems),
    storyItems: alex.storyItems,
    versionId: "r-test",
  });
}

describe("buildResumeView", () => {
  it("takes company, title, location and dates from the cited experience", () => {
    const view = viewOf();

    expect(view.experience[0]).toMatchObject({
      heading: "Northwind Logistics",
      headingRight: "Austin, TX",
      subheading: "Software Engineer",
      subheadingRight: "Jun 2024 – Present",
    });
  });

  it("uses the body's text for bullets, in the body's order", () => {
    const body = buildFullBody(alex.storyItems);
    const firstEntry = body.sections.experience[0];
    if (firstEntry === undefined) throw new Error("The demo resume needs an experience.");
    const reworded: ResumeBody = {
      ...body,
      sections: {
        ...body.sections,
        experience: [{ ...firstEntry, bullets: [{ src: "ach-northwind-latency", text: "Reworded bullet" }] }],
      },
    };

    const view = viewOf({ body: reworded });

    expect(view.experience[0]?.bullets).toEqual(["Reworded bullet"]);
  });

  it("copies education from the story item named in the body", () => {
    const view = viewOf();

    expect(view.education).toEqual([
      {
        heading: "State University",
        headingNote: "",
        headingRight: "Austin, TX",
        subheading: "B.S. Computer Science",
        subheadingRight: "Aug 2020 – May 2024",
        bullets: [],
      },
    ]);
  });

  it("shows a project's tools after its name", () => {
    const view = viewOf();

    expect(view.projects[0]).toMatchObject({ heading: "Ledgerline", headingNote: "Go", subheading: "" });
  });

  it("leaves out the headline when the body has none", () => {
    const body: ResumeBody = { ...buildFullBody(alex.storyItems), headline: null };

    expect(viewOf({ body }).headline).toBeNull();
  });

  it("builds the contact line in the order location, email, phone, links, skipping empty fields", () => {
    const header: ResumeHeader = { ...alex.header, phone: "", links: ["https://www.github.com/alex/"] };

    const view = viewOf({ header });

    expect(view.contact).toEqual([
      { text: "Austin, TX", url: null },
      { text: "alex.rivera@example.com", url: "mailto:alex.rivera@example.com" },
      { text: "github.com/alex", url: "https://www.github.com/alex/" },
    ]);
  });

  it("prints a link that is not a web address as plain text instead of making it clickable", () => {
    const header: ResumeHeader = { ...alex.header, links: ["javascript:alert(1)", "my portfolio"] };

    const links = viewOf({ header }).contact.slice(-2);

    expect(links).toEqual([
      { text: "javascript:alert(1)", url: null },
      { text: "my portfolio", url: null },
    ]);
  });

  it("puts the version id in the view for the template's PDF metadata", () => {
    expect(viewOf().versionId).toBe("r-test");
  });

  it("throws a clear error when the body cites a story item that was not given", () => {
    const body: ResumeBody = { ...buildFullBody(alex.storyItems), education: [{ src: "edu-missing" }] };

    expect(() => viewOf({ body })).toThrow(/edu-missing/);
  });
});

describe("formatDateRange", () => {
  it.each([
    ["2024-06", "Present", "Jun 2024 – Present"],
    ["2023-05", "2023-08", "May 2023 – Aug 2023"],
    ["2020", "2024", "2020 – 2024"],
    ["2024-06", "2024-06", "Jun 2024"],
    ["2024-06", undefined, "Jun 2024"],
    [undefined, "2024-05", "May 2024"],
    [undefined, undefined, ""],
  ])("turns %s to %s into %s", (start, end, expected) => {
    expect(formatDateRange(start, end)).toBe(expected);
  });
});
