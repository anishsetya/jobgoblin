// Settings, the person's folder, finishing setup, opening files, and the CSV and Excel downloads.
// Routes: GET/PUT /api/settings, POST /api/settings/folder, POST /api/setup/finish, POST /api/open,
// GET /api/export/csv and /xlsx. Spec: ARCHITECTURE.md section 11.
import {
  ChooseFolderResponse,
  SettingsResponse,
  type Settings,
} from "@jobgoblin/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { saveBlobAs } from "@/lib/download";
import { apiFetch, apiFetchBlob } from "./client";
import { openPathWithDesktop } from "./desktop";
import { queryKeys } from "./keys";

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => apiFetch("/api/settings", { schema: SettingsResponse }),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Settings>) =>
      apiFetch("/api/settings", { method: "PUT", json: changes, schema: SettingsResponse }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(queryKeys.settings(), settings);
      // Today shows the usage notice and the limits depend on these values.
      await queryClient.invalidateQueries({ queryKey: queryKeys.today() });
    },
  });
}

// Tells the server which folder to keep the person's files in. If the folder already holds
// backups (a new computer, say) they come back so the screen can offer Restore.
export function useChooseFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      apiFetch("/api/settings/folder", { method: "POST", json: { path }, schema: ChooseFolderResponse }),
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKeys.settings(), response.settings);
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups() });
    },
  });
}

// The last step of setup: builds the master resume and marks setup complete.
export function useFinishSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/setup/finish", { method: "POST", json: {}, schema: SettingsResponse }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(queryKeys.settings(), settings);
      await queryClient.invalidateQueries({ queryKey: queryKeys.today() });
    },
  });
}

export type OpenPathResult = { opened: boolean; path: string };

// Needs: OpenPathResponse on api.ts. Read by hand because the dashboard has no schema for it.
function readOpenPathResult(data: unknown): OpenPathResult {
  if (typeof data === "object" && data !== null && "opened" in data && "path" in data) {
    const { opened, path } = data;
    if (typeof opened === "boolean" && typeof path === "string") return { opened, path };
  }
  throw new TypeError("Expected { opened, path }.");
}

// Opens a file or folder inside the person's folder with the computer's own program.
// The desktop app does it through its bridge (which asks the local server itself); in a browser the
// dashboard asks the local server directly. If it cannot be opened, `opened` is false and the
// screen shows the path so the person can find the file themselves.
export function useOpenPath() {
  return useMutation({
    mutationFn: async (path: string): Promise<OpenPathResult> => {
      const desktopResult = await openPathWithDesktop(path);
      if (desktopResult === "opened") return { opened: true, path };
      if (desktopResult === "refused") return { opened: false, path };
      return apiFetch("/api/open", { method: "POST", json: { path }, schema: { parse: readOpenPathResult } });
    },
  });
}

export type ExportFormat = "csv" | "xlsx";

const EXPORT_FILE_NAMES: Record<ExportFormat, string> = {
  csv: "Jobgoblin tracker.csv",
  xlsx: "Jobgoblin tracker.xlsx",
};

// The tracker as a file download. It is fetched, not linked, because the route needs the session key.
export function useDownloadExport() {
  return useMutation({
    mutationFn: async (format: ExportFormat) => {
      const file = await apiFetchBlob(`/api/export/${format}`);
      saveBlobAs(file, EXPORT_FILE_NAMES[format]);
    },
  });
}
