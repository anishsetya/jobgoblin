import { describe, expect, it } from "vitest";
import type { ResumeBody, ResumeEntry } from "@jobgoblin/schemas";
import { buildMasterResume } from "./masterResume";
import { diffAgainstMaster } from "./resumeDiff";
import { ALEX, alexRiveraStory } from "./testing/alexRivera";

function aCopyOfTheMaster(): ResumeBody {
  return structuredClone(buildMasterResume(alexRiveraStory()));
}

function northwindEntry(body: ResumeBody): ResumeEntry {
  const northwind = body.sections.experience.find((entry) => entry.src === ALEX.northwind);
  if (northwind === undefined) throw new Error("The test data should have a Northwind entry.");
  return northwind;
}

describe("diffAgainstMaster", () => {
  const master = buildMasterResume(alexRiveraStory());

  it("finds no difference between a resume and itself", () => {
    expect(diffAgainstMaster(aCopyOfTheMaster(), master)).toEqual({ added: [], removed: [], reordered: false, reworded: [] });
  });

  it("lists story items dropped from the resume as removed", () => {
    const tailored = aCopyOfTheMaster();
    const northwind = northwindEntry(tailored);
    northwind.bullets = northwind.bullets.filter((bullet) => bullet.src !== ALEX.onCall);

    const diff = diffAgainstMaster(tailored, master);

    expect(diff.removed).toEqual([ALEX.onCall]);
    expect(diff.added).toEqual([]);
    expect(diff.reordered).toBe(false);
  });

  it("lists story items the master did not have as added", () => {
    const tailored = aCopyOfTheMaster();
    tailored.sections.projects = [{ src: ALEX.ledgerline, bullets: [{ src: ALEX.ledger, text: "Built a ledger library in Go" }] }];
    const masterWithoutProject = { ...master, sections: { ...master.sections, projects: [] } };

    const diff = diffAgainstMaster(tailored, masterWithoutProject);

    expect(diff.added).toEqual([ALEX.ledgerline, ALEX.ledger]);
    expect(diff.removed).toEqual([]);
  });

  it("notices when bullets are in a different order", () => {
    const tailored = aCopyOfTheMaster();
    northwindEntry(tailored).bullets.reverse();

    const diff = diffAgainstMaster(tailored, master);

    expect(diff.reordered).toBe(true);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("notices when whole entries swap places", () => {
    const tailored = aCopyOfTheMaster();
    tailored.sections.experience.reverse();

    expect(diffAgainstMaster(tailored, master).reordered).toBe(true);
  });

  it("does not call adding or removing a part a reorder", () => {
    const tailored = aCopyOfTheMaster();
    northwindEntry(tailored).bullets.splice(1, 1);

    expect(diffAgainstMaster(tailored, master).reordered).toBe(false);
  });

  it("reports a reworded line with the old and the new text", () => {
    const tailored = aCopyOfTheMaster();
    const latencyBullet = northwindEntry(tailored).bullets.find((bullet) => bullet.src === ALEX.latency);
    if (latencyBullet === undefined) throw new Error("The test data should have the latency bullet.");
    latencyBullet.text = "Reduced p95 latency of the orders service by 40% with a Redis read-through cache";

    const diff = diffAgainstMaster(tailored, master);

    expect(diff.reworded).toEqual([
      {
        src: ALEX.latency,
        from: "Cut p95 latency of the orders service 40% by adding a Redis read-through cache",
        to: "Reduced p95 latency of the orders service by 40% with a Redis read-through cache",
      },
    ]);
  });

  it("reports a reworded headline and a reworded skill", () => {
    const tailored = aCopyOfTheMaster();
    tailored.headline = { src: ALEX.headline, text: "Platform-minded backend engineer" };
    tailored.skills = [{ src: ALEX.skillPython, text: "python" }];

    expect(diffAgainstMaster(tailored, master).reworded.map((change) => change.src)).toEqual([ALEX.headline, ALEX.skillPython]);
  });

  it("does not call a change of spacing a rewording", () => {
    const tailored = aCopyOfTheMaster();
    const apiBullet = northwindEntry(tailored).bullets.find((bullet) => bullet.src === ALEX.api);
    if (apiBullet === undefined) throw new Error("The test data should have the API bullet.");
    apiBullet.text = `  ${apiBullet.text.replace(" API ", "  API\n")} `;

    expect(diffAgainstMaster(tailored, master).reworded).toEqual([]);
  });
});

