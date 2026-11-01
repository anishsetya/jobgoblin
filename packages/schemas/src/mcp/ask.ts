// MCP tools an ask run uses to answer a question about the person's applications: list_ready,
// get_pipeline and get_application. They only read.
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { HistoryEvent } from "../api";
import { Application } from "../application";
import { Band, Fit } from "../fit";
import { HttpUrl } from "../job";
import { ResumeBody } from "../resume";
import { ApplicationStatus } from "../status";
import { Answer } from "../submission";

// list_ready: the applications awaiting the person's approval.
export const ListReadyInput = z.object({});
export type ListReadyInput = z.infer<typeof ListReadyInput>;

export const ListReadyOutput = z.object({
  applications: z.array(
    z.object({
      applicationId: z.string(),
      company: z.string(),
      title: z.string(),
      fitScore: z.number().int().min(0).max(100).nullable(),
      band: Band.nullable(),
    }),
  ),
});
export type ListReadyOutput = z.infer<typeof ListReadyOutput>;

// get_pipeline: counts by status, and one row per application.
export const GetPipelineInput = z.object({});
export type GetPipelineInput = z.infer<typeof GetPipelineInput>;

export const GetPipelineOutput = z.object({
  counts: z.record(ApplicationStatus, z.number().int().nonnegative()), // every status has an entry, zero included
  rows: z.array(
    z.object({
      applicationId: z.string(),
      company: z.string(),
      title: z.string(),
      status: ApplicationStatus,
      fitScore: z.number().int().min(0).max(100).nullable(),
    }),
  ),
});
export type GetPipelineOutput = z.infer<typeof GetPipelineOutput>;

// get_application: one application in full, so an ask run can answer questions about it.
export const GetApplicationInput = z.object({
  applicationId: z.string(),
});
export type GetApplicationInput = z.infer<typeof GetApplicationInput>;

export const GetApplicationOutput = z.object({
  application: Application,
  job: z.object({
    company: z.string(),
    title: z.string(),
    location: z.string(),
    url: HttpUrl.nullable(),
  }),
  fit: Fit.nullable(),
  resume: ResumeBody.nullable(),
  answers: z.array(Answer),
  history: z.array(HistoryEvent),
});
export type GetApplicationOutput = z.infer<typeof GetApplicationOutput>;
