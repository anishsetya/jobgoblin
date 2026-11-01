// Shows the usage notice before the first run, then carries on with whatever the person had clicked.
//   const { runAfterNotice, usageNotice } = useUsageNotice();
//   <Button onClick={() => runAfterNotice(startHunt)}>Find jobs</Button>
//   {usageNotice}
// Once the person has read it, the settings remember, and later clicks run straight away.
import { useState, type ReactNode } from "react";
import { useSettings, useUpdateSettings } from "@/api/settings";
import { UsageNotice } from "./UsageNotice";

export function useUsageNotice(): { runAfterNotice: (action: () => void) => void; usageNotice: ReactNode } {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  // The click that is waiting for the person to read the notice.
  const [waitingAction, setWaitingAction] = useState<(() => void) | null>(null);

  function runAfterNotice(action: () => void): void {
    if (settings.data?.usageNoticeSeen === true) {
      action();
      return;
    }
    setWaitingAction(() => action);
  }

  function continueAfterReading(): void {
    const action = waitingAction;
    updateSettings.mutate(
      { usageNoticeSeen: true },
      {
        onSuccess: () => {
          setWaitingAction(null);
          action?.();
        },
      },
    );
  }

  const usageNotice = (
    <UsageNotice
      open={waitingAction !== null}
      onOpenChange={(open) => {
        if (!open) setWaitingAction(null);
      }}
      onContinue={continueAfterReading}
      isWorking={updateSettings.isPending}
    />
  );

  return { runAfterNotice, usageNotice };
}
