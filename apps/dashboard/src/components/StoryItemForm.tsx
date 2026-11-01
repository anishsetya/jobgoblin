// Edit one item of Your story in place. Which fields appear depends on the kind of item: a job has a title,
// company, place and dates; an achievement has its text, tools and numbers. The text is checked with the
// shared StoryItemData schema before it is sent, so a badly written date is flagged next to its box.
import { StoryItemData, type StoryItem, type StoryItemKind } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateStoryItem } from "@/api/story";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";

type Draft = {
  text: string;
  title: string;
  organization: string;
  location: string;
  startDate: string;
  endDate: string;
  tools: string; // typed as "Python, Redis" and stored as a list
  numbers: string;
};
type DraftField = keyof Draft;

// The fields shown besides the text, for each kind of item.
const EXTRA_FIELDS: Record<StoryItemKind, readonly DraftField[]> = {
  experience: ["title", "organization", "location", "startDate", "endDate", "tools"],
  project: ["title", "startDate", "endDate", "tools"],
  education: ["title", "organization", "location", "startDate", "endDate"],
  achievement: ["tools", "numbers"],
  skill: [],
  headline: [],
};

function draftFrom(item: StoryItem): Draft {
  const { data } = item;
  return {
    text: data.text,
    title: data.title ?? "",
    organization: data.organization ?? "",
    location: data.location ?? "",
    startDate: data.startDate ?? "",
    endDate: data.endDate ?? "",
    tools: data.tools.join(", "),
    numbers: data.numbers.join(", "),
  };
}

function blankToUndefined(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

type StoryItemFormProps = {
  item: StoryItem;
  onDone: () => void;
};

export function StoryItemForm({ item, onDone }: StoryItemFormProps) {
  const { t } = useTranslation();
  const updateItem = useUpdateStoryItem();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(item));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});

  function setField(field: DraftField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    const parsed = StoryItemData.safeParse({
      text: draft.text.trim(),
      title: blankToUndefined(draft.title),
      organization: blankToUndefined(draft.organization),
      location: blankToUndefined(draft.location),
      startDate: blankToUndefined(draft.startDate),
      endDate: blankToUndefined(draft.endDate),
      tools: splitList(draft.tools),
      numbers: splitList(draft.numbers),
    });

    if (!parsed.success) {
      const errors: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    updateItem.mutate({ itemId: item.id, changes: { data: parsed.data, keywords: item.keywords } }, { onSuccess: onDone });
  }

  function renderField(field: DraftField) {
    const hint = field === "startDate" || field === "endDate" ? t(`common:story.form.hint.${field}`) : undefined;
    const isList = field === "tools" || field === "numbers";
    return (
      <Field
        key={field}
        label={t(`common:story.form.${field}`)}
        hint={isList ? t("common:story.form.hint.list") : hint}
        error={fieldErrors[field]}
      >
        {(control) => (
          <Input {...control} value={draft[field]} onChange={(event) => setField(field, event.target.value)} />
        )}
      </Field>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Field label={t(`common:story.textLabel.${item.kind}`)} error={fieldErrors.text}>
        {(control) => (
          <Textarea {...control} rows={3} value={draft.text} onChange={(event) => setField("text", event.target.value)} />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">{EXTRA_FIELDS[item.kind].map(renderField)}</div>
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="small" disabled={updateItem.isPending}>
          {t("common:actions.save")}
        </Button>
        <Button size="small" variant="ghost" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
      </div>
      <ErrorNotice error={updateItem.error} />
    </form>
  );
}
