// Jobs found in public feeds or pasted by the person, and the companies whose boards are watched.
// A job is only a posting; it becomes an application once a run records a fit for it (decision D9).
// Spec: "Data model and storage" (jobs, companies) and "Job discovery". ARCHITECTURE.md section 5.4.
import { z } from "zod";

// Only web links. A posting link comes from a feed or a run and ends up in a click that opens the
// person's browser, so "javascript:" and "file:" links are refused here, at the boundary.
export const HttpUrl = z.url({ protocol: /^https?$/ });
export type HttpUrl = z.infer<typeof HttpUrl>;

export const Region = z.enum(["US", "IN", "REMOTE", "OTHER"]);
export type Region = z.infer<typeof Region>;

export const JobSource = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "hn",
  "yc",
  "remoteok",
  "wwr",
  "web",
  "pasted",
]);
export type JobSource = z.infer<typeof JobSource>;

export const Job = z.object({
  jobId: z.string(), // "<source>:<slug>:<id>", for example "greenhouse:acmecloud:4012345"
  dedupeKey: z.string(), // the same role reposted with a new id (or on another site) gets the same key
  source: JobSource,
  company: z.string(),
  title: z.string(),
  location: z.string(),
  region: Region,
  url: HttpUrl.nullable(),
  text: z.string(), // the posting. Untrusted: it is shown to runs wrapped as data, never as instructions
  questions: z.array(z.string()), // screening questions, when the feed exposes them
  postedAt: z.iso.datetime().nullable(),
  foundAt: z.iso.datetime(),
  seenAt: z.iso.datetime().nullable(), // when a hunt run first looked at it; null means never shown yet
  filteredReason: z.string().nullable(), // why the code filter dropped it, in plain words; null if it passed
});
export type Job = z.infer<typeof Job>;

// What packages/sources returns for one posting: only what the feed itself says. The server adds the
// rest (dedupe key, region, timestamps, filter result) using the rules in packages/core, so the
// sources package never needs them.
export const FeedPosting = Job.omit({
  dedupeKey: true,
  region: true,
  foundAt: true,
  seenAt: true,
  filteredReason: true,
});
export type FeedPosting = z.infer<typeof FeedPosting>;

// The three feed providers whose public job-board APIs Jobgoblin reads.
export const Ats = z.enum(["greenhouse", "lever", "ashby"]);
export type Ats = z.infer<typeof Ats>;

// Watching: fetched on every hunt. Suggested: found by a run, waiting for the person. Passed: ignored.
export const CompanyStatus = z.enum(["Watching", "Suggested", "Passed"]);
export type CompanyStatus = z.infer<typeof CompanyStatus>;

export const Company = z.object({
  id: z.string(),
  name: z.string(),
  ats: Ats,
  slug: z.string(), // the company's name on its ATS board, for example "acmecloud"
  status: CompanyStatus,
});
export type Company = z.infer<typeof Company>;
