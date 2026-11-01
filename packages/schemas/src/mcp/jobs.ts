// MCP tools about jobs: search_jobs, add_job, mark_seen, get_job. The first three are for hunt runs.
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { HttpUrl, Region } from "../job";

// search_jobs: unseen jobs that passed the code filter. Only reads the database; the feeds were
// fetched by code before the run started.
export const SearchJobsInput = z.object({
  limit: z.number().int().positive().optional().describe("How many jobs to return at most."),
});
export type SearchJobsInput = z.infer<typeof SearchJobsInput>;

export const SearchJobsOutput = z.object({
  jobs: z.array(
    z.object({
      jobId: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string(),
      region: Region,
      snippet: z.string(), // the first 2,000 characters of the posting, wrapped as untrusted data
    }),
  ),
  remaining: z.number().int().nonnegative(), // unseen jobs left after these
});
export type SearchJobsOutput = z.infer<typeof SearchJobsOutput>;

// add_job: add a job the run found on the web. Duplicates are recognised and not added again.
export const AddJobInput = z.object({
  url: HttpUrl.optional().describe("The posting's web link, if there is one."),
  text: z.string().min(1).describe("The full text of the posting."),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().min(1),
});
export type AddJobInput = z.infer<typeof AddJobInput>;

export const AddJobOutput = z.object({
  jobId: z.string(),
  duplicate: z.boolean(), // true when the job was already known
});
export type AddJobOutput = z.infer<typeof AddJobOutput>;

// mark_seen: record that these jobs have been looked at, so they are never shown again.
export const MarkSeenInput = z.object({
  jobIds: z.array(z.string()).min(1),
});
export type MarkSeenInput = z.infer<typeof MarkSeenInput>;

export const MarkSeenOutput = z.object({
  marked: z.number().int().nonnegative(),
});
export type MarkSeenOutput = z.infer<typeof MarkSeenOutput>;

// get_job: one job. The posting text comes back wrapped as <untrusted_job_posting>, so instructions
// hidden inside it are treated as data.
export const GetJobInput = z.object({
  jobId: z.string(),
});
export type GetJobInput = z.infer<typeof GetJobInput>;

export const GetJobOutput = z.object({
  jobId: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  region: Region,
  url: HttpUrl.nullable(),
  text: z.string(), // wrapped
  questions: z.array(z.string()),
});
export type GetJobOutput = z.infer<typeof GetJobOutput>;
