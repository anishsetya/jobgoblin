// One banner at the top of the main area when Jobgoblin cannot be reached, or has refused this page's key,
// so every screen says so as soon as the live updates stream notices, before the person clicks anything.
// It renders nothing while the connection is fine. The frames place it: AppShell, SetupFrame, and the
// full-page error screen. The state comes from api/connection.ts.
// Spec: ARCHITECTURE.md section 12; PRD "Errors say what happened and what to do".
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnectionState } from "@/api/connection";
import { cn } from "@/lib/cn";

export function ConnectionBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const connection = useConnectionState();
  if (connection === "connected") return null;

  return (
    <div
      role="alert"
      data-testid="connection-banner"
      className={cn("flex items-start gap-3 rounded-md border border-line bg-danger-soft p-4 text-sm", className)}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="space-y-1">
        <p className="font-medium text-danger">{t(`common:connection.${connection}.message`)}</p>
        <p className="text-text">{t(`common:connection.${connection}.action`)}</p>
      </div>
    </div>
  );
}
