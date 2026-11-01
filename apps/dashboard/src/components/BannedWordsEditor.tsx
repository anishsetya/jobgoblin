// Banned words: terms that must never appear in a resume, an answer or a data sheet. A draft that
// contains one fails with the word named. Spec: PRD P5. The list is one word or phrase per line.
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSaveProfileSection } from "@/api/profile";
import { ErrorNotice } from "./ErrorNotice";
import { LineListField } from "./LineListField";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function BannedWordsEditor({ initialWords }: { initialWords: string[] }) {
  const { t } = useTranslation();
  const saveSection = useSaveProfileSection();
  const [words, setWords] = useState(initialWords);
  const [hasSaved, setHasSaved] = useState(false);

  function save(event: FormEvent): void {
    event.preventDefault();
    saveSection.mutate({ section: "rules", data: { bannedTerms: words } }, { onSuccess: () => setHasSaved(true) });
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title={t("profile:banned.title")} description={t("profile:banned.description")}>
        <LineListField
          label={t("profile:banned.label")}
          hint={t("profile:banned.hint")}
          value={words}
          rows={8}
          onChange={(lines) => {
            setHasSaved(false);
            setWords(lines);
          }}
        />
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={saveSection.isPending}>
          {saveSection.isPending ? t("common:actions.saving") : t("common:actions.save")}
        </Button>
        {hasSaved && (
          <p role="status" className="text-sm text-success">
            {t("profile:banned.saved")}
          </p>
        )}
      </div>
      <ErrorNotice error={saveSection.error} />
    </form>
  );
}
