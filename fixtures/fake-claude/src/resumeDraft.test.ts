import type { ResumeBody } from "@jobgoblin/schemas";
import { describe, expect, it } from "vitest";
import {
  addPartsThatCannotBeTraced,
  dropLastBulletOfFirstEntry,
  dropPartsNamedByErrors,
  putMustHavesFirst,
} from "./resumeDraft";

function aResume(): ResumeBody {
  return {
    headline: { src: "headline-1", text: "Backend engineer" },
    sections: {
      experience: [
        {
          src: "exp-1",
          bullets: [
            { src: "ach-1", text: "Built an API in Python" },
            { src: "ach-2", text: "Contributed to the on-call rotation" },
            { src: "ach-3", text: "Migrated 12 services to Kubernetes" },
          ],
        },
        { src: "exp-2", bullets: [{ src: "ach-4", text: "Wrote tests" }] },
      ],
      projects: [],
    },
    skills: [
      { src: "skill-1", text: "Python" },
      { src: "skill-2", text: "Kubernetes" },
    ],
    education: [{ src: "edu-1" }],
  };
}

const bulletIds = (resume: ResumeBody, entryIndex: number) =>
  resume.sections.experience[entryIndex]?.bullets.map((bullet) => bullet.src);

describe("putMustHavesFirst", () => {
  it("moves bullets and skills that mention a must-have to the front, keeping the rest in order", () => {
    const draft = putMustHavesFirst(aResume(), ["Kubernetes"]);

    expect(bulletIds(draft, 0)).toEqual(["ach-3", "ach-1", "ach-2"]);
    expect(draft.skills.map((skill) => skill.text)).toEqual(["Kubernetes", "Python"]);
  });

  it("changes nothing when no bullet mentions a must-have", () => {
    expect(putMustHavesFirst(aResume(), ["Rust"])).toEqual(aResume());
  });

  it("does not change the resume it was given", () => {
    const master = aResume();
    putMustHavesFirst(master, ["Kubernetes"]);

    expect(master).toEqual(aResume());
  });
});

describe("dropLastBulletOfFirstEntry", () => {
  it("removes the last bullet of the first entry only", () => {
    const draft = dropLastBulletOfFirstEntry(aResume());

    expect(bulletIds(draft, 0)).toEqual(["ach-1", "ach-2"]);
    expect(bulletIds(draft, 1)).toEqual(["ach-4"]);
  });
});

describe("addPartsThatCannotBeTraced", () => {
  it("adds a bullet that cites a missing story item and turns 'Contributed to' into 'Led'", () => {
    const draft = addPartsThatCannotBeTraced(aResume());

    expect(bulletIds(draft, 0)).toEqual(["ach-1", "ach-2", "ach-3", "story-item-that-does-not-exist"]);
    expect(draft.sections.experience[0]?.bullets[1]?.text).toBe("Led the on-call rotation");
  });
});

describe("dropPartsNamedByErrors", () => {
  it("drops each bullet an error points at, even though dropping one shifts the others' indexes", () => {
    const resume = aResume();
    const errors = [
      { code: "untraced", message: "x", path: "sections.experience[0].bullets[0]" },
      { code: "inflated-verb", message: "x", path: "sections.experience[0].bullets[1]" },
    ];

    const { body, droppedCount } = dropPartsNamedByErrors(resume, errors);

    expect(bulletIds(body, 0)).toEqual(["ach-3"]);
    expect(droppedCount).toBe(2);
  });

  it("drops the whole bullet when the path points inside it", () => {
    const errors = [{ code: "changed-fact", message: "x", path: "sections.experience[0].bullets[2].text" }];

    expect(bulletIds(dropPartsNamedByErrors(aResume(), errors).body, 0)).toEqual(["ach-1", "ach-2"]);
  });

  it("drops a skill, a whole entry and the headline", () => {
    const errors = [
      { code: "untraced", message: "x", path: "skills[0]" },
      { code: "untraced", message: "x", path: "sections.experience[1]" },
      { code: "banned", message: "x", path: "headline" },
    ];

    const { body, droppedCount } = dropPartsNamedByErrors(aResume(), errors);

    expect(body.skills.map((skill) => skill.src)).toEqual(["skill-2"]);
    expect(body.sections.experience.map((entry) => entry.src)).toEqual(["exp-1"]);
    expect(body.headline).toBeNull();
    expect(droppedCount).toBe(3);
  });

  it("counts nothing dropped for an error that names no part, such as a page count", () => {
    const errors = [{ code: "pages", message: "The resume is two pages." }];

    expect(dropPartsNamedByErrors(aResume(), errors)).toEqual({ body: aResume(), droppedCount: 0 });
  });

  it("counts a part once when two errors point at it", () => {
    const errors = [
      { code: "untraced", message: "x", path: "sections.experience[0].bullets[0]" },
      { code: "banned", message: "x", path: "sections.experience[0].bullets[0]" },
    ];

    expect(dropPartsNamedByErrors(aResume(), errors).droppedCount).toBe(1);
  });
});
