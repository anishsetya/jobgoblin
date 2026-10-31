// Loads one application's detail and shows "Loading..." or an error until it arrives, then hands it to its
// child. Review, Open application and the Application screen all start from the same detail response.
import type { ApplicationDetail } from "@jobgoblin/schemas";
import type { ReactNode } from "react";
import { useApplication } from "@/api/applications";
import { ErrorNotice } from "./ErrorNotice";
import { LoadingNote } from "./LoadingNote";

type ApplicationGateProps = {
  applicationId: string;
  children: (detail: ApplicationDetail) => ReactNode;
};

export function ApplicationGate({ applicationId, children }: ApplicationGateProps) {
  const detail = useApplication(applicationId);

  if (detail.isPending) return <LoadingNote />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />;

  return <>{children(detail.data)}</>;
}
