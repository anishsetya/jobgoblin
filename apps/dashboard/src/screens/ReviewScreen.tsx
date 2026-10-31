// Review: one application at a time, with everything needed to decide. See ReviewContent for the screen itself.
// Spec: PRD "Screens: Review", ARCHITECTURE.md section 12 (/review/:id).
import { ApplicationGate } from "@/components/ApplicationGate";
import { ReviewContent } from "./review/ReviewContent";

export function ReviewScreen({ applicationId }: { applicationId: string }) {
  return <ApplicationGate applicationId={applicationId}>{(detail) => <ReviewContent detail={detail} />}</ApplicationGate>;
}
