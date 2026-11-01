// What a tailored resume changed against the master resume: story items added, removed, moved,
// and reworded. Review highlights the reworded lines (decision D12).
// Spec: "Resume pipeline" (a resume is a selection). ARCHITECTURE.md sections 5.6 and 6.
import type { ResumeBody, ResumeDiff } from "@jobgoblin/schemas";

// One part of a resume that comes from a story item. Entries and education have no text of their own.
type Part = { src: string; text: string | null };

// Every part in reading order: headline, experience, projects, skills, education.
function listParts(body: ResumeBody): Part[] {
  const parts: Part[] = [];
  if (body.headline !== null) parts.push(body.headline);
  for (const entry of [...body.sections.experience, ...body.sections.projects]) {
    parts.push({ src: entry.src, text: null }, ...entry.bullets);
  }
  parts.push(...body.skills);
  for (const school of body.education) parts.push({ src: school.src, text: null });
  return parts;
}

export function diffAgainstMaster(tailored: ResumeBody, master: ResumeBody): ResumeDiff {
  const tailoredParts = listParts(tailored);
  const masterParts = listParts(master);
  const tailoredIds = tailoredParts.map((part) => part.src);
  const masterIds = masterParts.map((part) => part.src);

  return {
    added: tailoredIds.filter((id) => !masterIds.includes(id)),
    removed: masterIds.filter((id) => !tailoredIds.includes(id)),
    reordered: isReordered(tailoredIds, masterIds),
    reworded: findReworded(tailoredParts, masterParts),
  };
}

// Looks only at the parts both resumes have, so adding or removing a part is not a reorder.
function isReordered(tailoredIds: readonly string[], masterIds: readonly string[]): boolean {
  const sharedInTailoredOrder = tailoredIds.filter((id) => masterIds.includes(id));
  const sharedInMasterOrder = masterIds.filter((id) => tailoredIds.includes(id));
  return sharedInTailoredOrder.join("\n") !== sharedInMasterOrder.join("\n");
}

function findReworded(tailoredParts: readonly Part[], masterParts: readonly Part[]): ResumeDiff["reworded"] {
  const masterTextById = new Map<string, string>();
  for (const part of masterParts) {
    if (part.text !== null) masterTextById.set(part.src, part.text);
  }

  const reworded: ResumeDiff["reworded"] = [];
  for (const part of tailoredParts) {
    const from = masterTextById.get(part.src);
    if (from === undefined || part.text === null) continue;
    if (squashSpaces(from) !== squashSpaces(part.text)) reworded.push({ src: part.src, from, to: part.text });
  }
  return reworded;
}

// Extra spaces or line breaks are not a rewording.
function squashSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
