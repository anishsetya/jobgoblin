// The Application screen: one application's whole story. See ApplicationDetailContent for the screen itself.
// Spec: PRD "Screens: Application detail", ARCHITECTURE.md section 12 (/apps/:id).
import { ApplicationGate } from "@/components/ApplicationGate";
import { ApplicationDetailContent } from "./application/ApplicationDetailContent";

export function ApplicationDetailScreen({ applicationId }: { applicationId: string }) {
  return (
    <ApplicationGate applicationId={applicationId}>
      {(detail) => <ApplicationDetailContent detail={detail} />}
    </ApplicationGate>
  );
}
