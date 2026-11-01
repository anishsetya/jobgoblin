// Proof that an application was sent, and the screening answers written after approval.
// "Applied" means the person gave proof; a filled form is not an application.
// Spec: "Data model and storage" (submissions) and "Application state machine". ARCHITECTURE.md sections 5.7 and 8.5.
import { z } from "zod";
import { ResumeVersionId, Sha256Hex } from "./resume";

// What the person gives as proof that the company received the application.
export const ProofType = z.enum([
  "confirmation-page",
  "pasted-text",
  "screenshot",
  "email-subject",
  "person-saw-it",
]);
export type ProofType = z.infer<typeof ProofType>;

export const Submission = z.object({
  id: z.string(),
  applicationId: z.string(),
  resumeVersion: ResumeVersionId, // the version that was approved
  attachedSha256: Sha256Hex.nullable(), // fingerprint of the file in the upload field; null if not given
  proofType: ProofType,
  proof: z.string(),
  submittedAt: z.iso.datetime(),
});
export type Submission = z.infer<typeof Submission>;

// A screening question and the answer drafted for it. Written by an answers run after approval.
export const Answer = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});
export type Answer = z.infer<typeof Answer>;
