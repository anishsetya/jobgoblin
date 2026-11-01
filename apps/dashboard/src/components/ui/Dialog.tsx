// A modal dialog on Radix. Radix traps keyboard focus inside while it is open, closes it on Escape,
// and puts focus back where it was when it closes. The title is required because a dialog without
// a name is unusable with a screen reader.
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  // Buttons for the bottom row. Put the main action last.
  footer?: ReactNode;
};

export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  const { t } = useTranslation();

  // Radix warns when a dialog has no description. Setting aria-describedby to undefined says
  // "none on purpose" and silences the warning.
  const withoutDescription = description === undefined ? { "aria-describedby": undefined } : {};

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <RadixDialog.Content
          {...withoutDescription}
          className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-6"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="small" aria-label={t("common:actions.close")}>
                <X aria-hidden="true" className="size-4" />
              </Button>
            </RadixDialog.Close>
          </div>
          {description !== undefined && (
            <RadixDialog.Description className="mb-4 text-sm text-muted">{description}</RadixDialog.Description>
          )}
          {children}
          {footer !== undefined && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
