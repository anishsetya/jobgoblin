// Backups of the person's data: list them, make one now, restore one.
// Routes: GET /api/backups, POST /api/backups, POST /api/backups/:id/restore.
// Spec: PRD S5, ARCHITECTURE.md sections 7 and 11.
import { Backup, SettingsResponse } from "@jobgoblin/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, arrayOf } from "./client";
import { invalidateEverything } from "./invalidate";
import { queryKeys } from "./keys";

export function useBackups() {
  return useQuery({
    queryKey: queryKeys.backups(),
    queryFn: () => apiFetch("/api/backups", { schema: arrayOf(Backup) }),
  });
}

export function useBackUpNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/backups", { method: "POST", json: {}, schema: Backup }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.backups() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings() }),
      ]);
    },
  });
}

// Replaces the current data with the backup. The server saves the current data as a backup first.
// Everything on screen may now be different, so every query is refreshed.
export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) =>
      apiFetch(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
        method: "POST",
        json: {},
        schema: SettingsResponse,
      }),
    onSuccess: () => invalidateEverything(queryClient),
  });
}
