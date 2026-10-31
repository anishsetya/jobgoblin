// "Add to your story": a skill, a headline, or an achievement under one of the person's jobs or projects.
// Things the person adds themselves are theirs to vouch for; they still appear in the list to be edited or dropped.
import type { StoryItem, StoryItemKind } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAddStoryItem } from "@/api/story";
import { summaryOf } from "@/lib/storyGroups";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Select } from "./ui/Select";
import { Textarea } from "./ui/Textarea";

type AddableKind = Extract<StoryItemKind, "skill" | "headline" | "achievement">;
const ADDABLE_KINDS: readonly AddableKind[] = ["skill", "achievement", "headline"];

export function AddStoryItemDialog({ items }: { items: StoryItem[] }) {
  const { t } = useTranslation();
  const addItem = useAddStoryItem();
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<AddableKind>("skill");
  const [text, setText] = useState("");
  const [parentId, setParentId] = useState("");

  // An achievement belongs under a job or project that has not been dropped.
  const parents = items.filter((item) => (item.kind === "experience" || item.kind === "project") && item.status !== "rejected");
  const needsParent = kind === "achievement";
  const canSave = text.trim() !== "" && (!needsParent || parentId !== "");

  function close(): void {
    setIsOpen(false);
    addItem.reset();
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    if (!canSave) return;
    addItem.mutate(
      {
        kind,
        parentId: needsParent ? parentId : null,
        data: { text: text.trim(), tools: [], numbers: [] },
        keywords: [],
      },
      {
        onSuccess: () => {
          setText("");
          close();
        },
      },
    );
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>{t("common:story.add.open")}</Button>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => (open ? setIsOpen(true) : close())}
        title={t("common:story.add.title")}
        description={t("common:story.add.description")}
        footer={
          <>
            <Button onClick={close}>{t("common:actions.cancel")}</Button>
            <Button type="submit" form="add-story-item" variant="accent" disabled={!canSave || addItem.isPending}>
              {t("common:story.add.save")}
            </Button>
          </>
        }
      >
        <form id="add-story-item" onSubmit={save} className="space-y-4">
          <Field label={t("common:story.add.kind")}>
            {(control) => (
              <Select {...control} value={kind} onChange={(event) => setKind(event.target.value as AddableKind)}>
                {ADDABLE_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {t(`common:story.kind.${option}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {needsParent && (
            <Field label={t("common:story.add.parent")}>
              {(control) => (
                <Select {...control} value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">{t("common:story.add.chooseParent")}</option>
                  {parents.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {summaryOf(parent)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t(`common:story.textLabel.${kind}`)}>
            {(control) => <Textarea {...control} rows={3} value={text} onChange={(event) => setText(event.target.value)} />}
          </Field>
          <ErrorNotice error={addItem.error} />
        </form>
      </Dialog>
    </>
  );
}
