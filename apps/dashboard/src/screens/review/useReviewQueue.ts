// The queue of applications waiting for review: where the open one sits, and how to move to the
// next or previous one. Used by the Review screen for the J and K keys and for the step that follows
// Approve, Skip or Request edit.
// Spec: PRD "Interaction rules"; dashboard README, decision 9.
import { useNavigate } from "@tanstack/react-router";
import { usePipeline } from "@/api/pipeline";

// The queue the J and K keys walk through.
const AWAITING_REVIEW_QUERY = { status: ["Awaiting approval" as const] };

export type ReviewQueue = {
  // Ids of the applications waiting for review.
  queueIds: string[];
  // Index of the open application in queueIds, or -1 when it is not waiting for review.
  positionInQueue: number;
  // J (step 1) goes to the next waiting application, K (step -1) to the previous one, wrapping around.
  goToNeighbour: (step: 1 | -1) => void;
  // After a decision: carry on with the next waiting application, or go back to Today when none is left.
  goToNextOrToday: () => void;
};

export function useReviewQueue(applicationId: string): ReviewQueue {
  const navigate = useNavigate();
  const queue = usePipeline(AWAITING_REVIEW_QUERY);
  const queueIds = (queue.data ?? []).map((row) => row.id);
  const positionInQueue = queueIds.indexOf(applicationId);

  function goToApplication(id: string): void {
    void navigate({ to: "/review/$id", params: { id } });
  }

  function goToNeighbour(step: 1 | -1): void {
    if (queueIds.length === 0) return;
    const from = startingPosition(positionInQueue, step);
    const target = queueIds[(from + step + queueIds.length) % queueIds.length];
    if (target !== undefined && target !== applicationId) goToApplication(target);
  }

  function goToNextOrToday(): void {
    const next = queueIds.find((id) => id !== applicationId);
    if (next === undefined) {
      void navigate({ to: "/today" });
      return;
    }
    goToApplication(next);
  }

  return { queueIds, positionInQueue, goToNeighbour, goToNextOrToday };
}

// An application that is not in the queue (already decided) starts J at the first entry and K at the last.
function startingPosition(positionInQueue: number, step: 1 | -1): number {
  if (positionInQueue !== -1) return positionInQueue;
  if (step === 1) return -1;
  return 0;
}
