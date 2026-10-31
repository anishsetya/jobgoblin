// One application: its detail, and every action the person can take on it.
// Routes: GET /api/apps/:id, GET /api/apps/:id/resume.pdf, and POST approve, skip, undo-skip, withdraw,
// request-edit, tailor, ask, status and submitted. Spec: ARCHITECTURE.md sections 8 and 11.
import {
  Application,
  ApplicationDetail,
  Run,
  Submission,
  type StatusChangeRequest,
  type SubmittedRequest,
} from "@jobgoblin/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { saveBlobAs } from "@/lib/download";
import { apiFetch, apiFetchBlob, withQuery } from "./client";
import { invalidateApplication } from "./invalidate";
import { queryKeys } from "./keys";
import { rememberRun } from "./runs";

function applicationPath(applicationId: string, suffix = ""): string {
  return `/api/apps/${encodeURIComponent(applicationId)}${suffix}`;
}

export function useApplication(applicationId: string) {
  return useQuery({
    queryKey: queryKeys.application(applicationId),
    queryFn: () => apiFetch(applicationPath(applicationId), { schema: ApplicationDetail }),
  });
}

// Approve exactly the data sheet the person saw (its hash). If the profile changed since, the
// server refuses with "data-sheet-changed" and the screen reloads the new sheet for another look.
export function useApproveApplication(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dataSheetHash: string) =>
      apiFetch(applicationPath(applicationId, "/approve"), {
        method: "POST",
        json: { dataSheetHash, submitMode: "manual" },
        schema: Application,
      }),
    onSettled: () => invalidateApplication(queryClient, applicationId),
  });
}

// The three simple actions that take no input and return the updated application.
function useApplicationAction(applicationId: string, suffix: string, json: unknown = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(applicationPath(applicationId, suffix), { method: "POST", json, schema: Application }),
    onSuccess: () => invalidateApplication(queryClient, applicationId),
  });
}

export function useSkipApplication(applicationId: string) {
  return useApplicationAction(applicationId, "/skip");
}

export function useUndoSkipApplication(applicationId: string) {
  return useApplicationAction(applicationId, "/undo-skip");
}

export function useWithdrawApplication(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) =>
      apiFetch(applicationPath(applicationId, "/withdraw"), {
        method: "POST",
        json: note === "" ? {} : { note },
        schema: Application,
      }),
    onSuccess: () => invalidateApplication(queryClient, applicationId),
  });
}

// Actions that start a run and return it: Request edit, Tailor and Ask about this application.
function useRunStartingAction<Variables>(
  applicationId: string,
  suffix: string,
  toBody: (variables: Variables) => unknown,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: Variables) =>
      apiFetch(applicationPath(applicationId, suffix), { method: "POST", json: toBody(variables), schema: Run }),
    onSuccess: async (run) => {
      rememberRun(queryClient, run);
      await invalidateApplication(queryClient, applicationId);
    },
  });
}

export function useRequestEdit(applicationId: string) {
  return useRunStartingAction(applicationId, "/request-edit", (note: string) => ({ note }));
}

export function useTailorApplication(applicationId: string) {
  return useRunStartingAction<void>(applicationId, "/tailor", () => ({}));
}

export function useAskAboutApplication(applicationId: string) {
  return useRunStartingAction(applicationId, "/ask", (question: string) => ({ question }));
}

// Status moves by the person (OA, Phone screen, Rejected, ...). The server accepts only the moves
// listed in the detail's allowedStatusMoves, and never Approved or Applied (decision D16).
export function useChangeStatus(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StatusChangeRequest) =>
      apiFetch(applicationPath(applicationId, "/status"), { method: "POST", json: request, schema: Application }),
    onSuccess: () => invalidateApplication(queryClient, applicationId),
  });
}

// "I submitted": records the proof and moves the application to Applied.
export function useMarkSubmitted(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SubmittedRequest) =>
      apiFetch(applicationPath(applicationId, "/submitted"), { method: "POST", json: request, schema: Submission }),
    onSuccess: () => invalidateApplication(queryClient, applicationId),
  });
}

// Fetches the resume PDF and saves it as a file. It is fetched here, not linked, because the
// route needs the session key, which a plain link or an <iframe> cannot send (decision D12).
// `versionId` null means the application's current resume.
export function useDownloadResumePdf(applicationId: string) {
  return useMutation({
    mutationFn: async (variables: { versionId: string | null; fileName: string }) => {
      const path = withQuery(applicationPath(applicationId, "/resume.pdf"), {
        version: variables.versionId ?? undefined,
      });
      const pdf = await apiFetchBlob(path);
      saveBlobAs(pdf, variables.fileName);
    },
  });
}
