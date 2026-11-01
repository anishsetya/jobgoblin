// Turns story item dates ("2024-06", "2024", "Present") into the text printed on a resume
// ("Jun 2024 – Present"). Story dates are always in one of these shapes (see schemas/story.ts),
// so this file never has to guess at other formats.
// Spec: "Resume pipeline" (the template prints dates from the cited story item).

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EN_DASH = "–";

// "2024-06" -> "Jun 2024"; "2024" -> "2024"; "Present" -> "Present".
export function formatStoryDate(date: string): string {
  const [year, month] = date.split("-");
  if (year === undefined || month === undefined) return date;

  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName === undefined) return date;
  return `${monthName} ${year}`;
}

// "Jun 2024 – Present". With only one end known, prints just that one. With neither, prints nothing.
export function formatDateRange(startDate: string | undefined, endDate: string | undefined): string {
  const start = startDate === undefined ? "" : formatStoryDate(startDate);
  const end = endDate === undefined ? "" : formatStoryDate(endDate);

  if (start === "") return end;
  if (end === "" || end === start) return start;
  return `${start} ${EN_DASH} ${end}`;
}
