// The experience or project entries of a resume preview: who and where on the first row, the title and
// dates on the second, then the chosen bullets. Everything comes from Your story items, looked up by
// the id each entry cites, so the preview shows exactly what the PDF will say.
import type { ResumeEntry, StoryItem } from "@jobgoblin/schemas";
import { formatStoryDateRange } from "@/lib/format";
import { ResumeText } from "./ResumeText";

type ResumeEntriesProps = {
  entries: ResumeEntry[];
  itemsById: Map<string, StoryItem>;
  rewordedSources: Set<string>;
};

// An experience reads "Company, Location / Job title, dates". A project reads "Project name".
function describeEntry(item: StoryItem | undefined): { first: string; second: string; location: string; dates: string } {
  if (item === undefined) return { first: "", second: "", location: "", dates: "" };
  const { data } = item;
  const isExperience = item.kind === "experience";
  return {
    first: isExperience ? (data.organization ?? data.title ?? data.text) : (data.title ?? data.text),
    second: isExperience ? (data.title ?? "") : "",
    location: data.location ?? "",
    dates: formatStoryDateRange(data.startDate, data.endDate),
  };
}

export function ResumeEntries({ entries, itemsById, rewordedSources }: ResumeEntriesProps) {
  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const { first, second, location, dates } = describeEntry(itemsById.get(entry.src));
        return (
          <div key={entry.src}>
            <div className="flex flex-wrap justify-between gap-x-4">
              <p className="font-semibold">{first}</p>
              <p className="text-muted">{location}</p>
            </div>
            {(second !== "" || dates !== "") && (
              <div className="flex flex-wrap justify-between gap-x-4 italic">
                <p>{second}</p>
                <p className="text-muted">{dates}</p>
              </div>
            )}
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {entry.bullets.map((bullet) => (
                <li key={bullet.src}>
                  <ResumeText text={bullet.text} isReworded={rewordedSources.has(bullet.src)} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
