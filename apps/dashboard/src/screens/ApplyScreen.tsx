// Open application: where the person submits an approved application on the company's own site.
// See ApplyContent for the screen itself. Spec: PRD "Screens: Open application", ARCHITECTURE.md section 12 (/apply/:id).
import { ApplicationGate } from "@/components/ApplicationGate";
import { ApplyContent } from "./apply/ApplyContent";

export function ApplyScreen({ applicationId }: { applicationId: string }) {
  return <ApplicationGate applicationId={applicationId}>{(detail) => <ApplyContent detail={detail} />}</ApplicationGate>;
}
