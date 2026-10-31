// Your story: the experiences, projects, achievements and skills the person confirms, and the
// resume upload that fills it in.
// Routes: GET/POST /api/story, PUT /api/story/:id, POST /api/story/:id/confirm and /reject,
// POST /api/import-resume. Spec: ARCHITECTURE.md sections 5.2 and 11.
import {
  StoryItem,
  type StoryItemData,
  type StoryItemKind,
  type UploadKind,
} from "@jobgoblin/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, arrayOf } from "./client";
import { invalidateProfileData } from "./invalidate";
import { queryKeys } from "./keys";

export function useStory() {
  return useQuery({
    queryKey: queryKeys.story(),
    queryFn: () => apiFetch("/api/story", { schema: arrayOf(StoryItem) }),
  });
}

// Needs: NewStoryItemRequest on api.ts. The architecture lists POST /api/story without a body shape;
// this is the shape the dashboard sends.
export type NewStoryItem = {
  kind: StoryItemKind;
  parentId: string | null;
  data: StoryItemData;
  keywords: string[];
};

// Needs: UpdateStoryItemRequest on api.ts. Same gap for PUT /api/story/:id.
export type StoryItemChanges = {
  data: StoryItemData;
  keywords: string[];
};

export function useAddStoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: NewStoryItem) =>
      apiFetch("/api/story", { method: "POST", json: item, schema: StoryItem }),
    onSuccess: () => invalidateProfileData(queryClient),
  });
}

export function useUpdateStoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { itemId: string; changes: StoryItemChanges }) =>
      apiFetch(`/api/story/${encodeURIComponent(variables.itemId)}`, {
        method: "PUT",
        json: variables.changes,
        schema: StoryItem,
      }),
    onSuccess: () => invalidateProfileData(queryClient),
  });
}

function useStoryItemDecision(decision: "confirm" | "reject") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/story/${encodeURIComponent(itemId)}/${decision}`, { method: "POST", json: {}, schema: StoryItem }),
    onSuccess: () => invalidateProfileData(queryClient),
  });
}

// "Confirm": the item may now appear in resumes and fit scores.
export function useConfirmStoryItem() {
  return useStoryItemDecision("confirm");
}

// "Drop": the item is never used.
export function useRejectStoryItem() {
  return useStoryItemDecision("reject");
}

// Needs: ImportResumeResponse on api.ts. The architecture says the answer is { runId };
// it is read by hand here because the dashboard has no schema for it. The LinkedIn upload may
// start no run, so runId can be null.
function readRunId(data: unknown): { runId: string | null } {
  if (typeof data === "object" && data !== null && "runId" in data) {
    const runId = data.runId;
    if (typeof runId === "string") return { runId };
    if (runId === null) return { runId: null };
  }
  throw new TypeError("Expected { runId }.");
}

// Uploads a resume (or a LinkedIn PDF) as a file. The setup run starts after the resume upload,
// so the LinkedIn file, if there is one, must be uploaded first.
export function useImportResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { file: File; kind: UploadKind }) => {
      const form = new FormData();
      form.append("kind", variables.kind);
      form.append("file", variables.file);
      return apiFetch("/api/import-resume", { method: "POST", form, schema: { parse: readRunId } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.today() }),
  });
}
