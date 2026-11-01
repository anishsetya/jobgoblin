// Choosing the folder where the person's files live. In the desktop app a button opens the computer's own
// folder chooser; in a browser (tests, development) there is no chooser, so a text field takes the path.
// Spec: PRD S4. After choosing, the server reports any backups already in that folder (a new computer, say).
import type { ChooseFolderResponse } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { chooseFolder, hasFolderChooser } from "@/api/desktop";
import { useChooseFolder } from "@/api/settings";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";

type FolderChooserProps = {
  currentFolder: string | null;
  onChosen?: (response: ChooseFolderResponse) => void;
};

export function FolderChooser({ currentFolder, onChosen }: FolderChooserProps) {
  const { t } = useTranslation();
  const chooseFolderRequest = useChooseFolder();
  const [typedPath, setTypedPath] = useState("");

  async function pickWithChooser(): Promise<void> {
    const pickedPath = await chooseFolder();
    if (pickedPath === null) return; // the person closed the chooser
    chooseFolderRequest.mutate(pickedPath, { onSuccess: onChosen });
  }

  function submitTypedPath(event: FormEvent): void {
    event.preventDefault();
    const path = typedPath.trim();
    if (path === "") return;
    chooseFolderRequest.mutate(path, { onSuccess: onChosen });
  }

  return (
    <div className="space-y-4">
      {currentFolder !== null && (
        <p className="text-sm">
          {t("common:folder.current")} <span className="font-medium break-all">{currentFolder}</span>
        </p>
      )}

      {hasFolderChooser() ? (
        <Button disabled={chooseFolderRequest.isPending} onClick={() => void pickWithChooser()}>
          {currentFolder === null ? t("common:folder.choose") : t("common:folder.change")}
        </Button>
      ) : (
        <form onSubmit={submitTypedPath} className="flex flex-wrap items-end gap-2">
          <Field label={t("common:folder.pathLabel")} hint={t("common:folder.pathHint")} className="min-w-64 flex-1">
            {(control) => (
              <Input {...control} value={typedPath} onChange={(event) => setTypedPath(event.target.value)} />
            )}
          </Field>
          <Button type="submit" disabled={typedPath.trim() === "" || chooseFolderRequest.isPending}>
            {t("common:folder.use")}
          </Button>
        </form>
      )}

      <ErrorNotice error={chooseFolderRequest.error} />
    </div>
  );
}
