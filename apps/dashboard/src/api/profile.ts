// The person's profile: contact details, form answers, targets and banned words.
// Routes: GET /api/profile, PUT /api/profile/:section. Spec: ARCHITECTURE.md sections 5.3 and 11.
import { ProfileResponse, type Profile, type ProfileSectionName } from "@jobgoblin/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { invalidateProfileData } from "./invalidate";
import { queryKeys } from "./keys";

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: () => apiFetch("/api/profile", { schema: ProfileResponse }),
  });
}

// A section name together with data of that section's own type, so "targets" cannot be sent
// with the shape of "contact".
export type SaveProfileSection = {
  [Section in ProfileSectionName]: { section: Section; data: Profile[Section] };
}[ProfileSectionName];

export function useSaveProfileSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ section, data }: SaveProfileSection) =>
      apiFetch(`/api/profile/${section}`, { method: "PUT", json: data, schema: ProfileResponse }),
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKeys.profile(), response);
      // Data sheets are built from the profile, so open applications may look different now.
      await invalidateProfileData(queryClient);
    },
  });
}
