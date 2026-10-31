// Loads the profile and shows "Loading..." or an error until it arrives, then hands it to its child.
// The forms keep their typing in state that starts from the saved profile, so they must not exist
// until the profile has loaded; this gate is what guarantees that.
import type { ProfileResponse } from "@jobgoblin/schemas";
import type { ReactNode } from "react";
import { useProfile } from "@/api/profile";
import { ErrorNotice } from "./ErrorNotice";
import { LoadingNote } from "./LoadingNote";

export function ProfileGate({ children }: { children: (profileResponse: ProfileResponse) => ReactNode }) {
  const profile = useProfile();

  if (profile.isPending) return <LoadingNote />;
  if (profile.isError) return <ErrorNotice error={profile.error} onRetry={() => void profile.refetch()} />;

  return <>{children(profile.data)}</>;
}
