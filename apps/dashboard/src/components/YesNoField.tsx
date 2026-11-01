// A Yes / No answer (work authorization questions). "Choose an answer" stands for a value the person
// has not given yet and is marked in amber, the same way an empty text answer is.
import { useTranslation } from "react-i18next";
import type { YesNoDraft } from "@/lib/answersDraft";
import { Badge } from "./ui/Badge";
import { Field } from "./ui/Field";
import { Select } from "./ui/Select";

type YesNoFieldProps = {
  label: string;
  value: YesNoDraft;
  onChange: (value: YesNoDraft) => void;
};

export function YesNoField({ label, value, onChange }: YesNoFieldProps) {
  const { t } = useTranslation();

  return (
    <Field label={label} badge={value === "todo" ? <Badge tone="amber">{t("profile:answers.needsAnswer")}</Badge> : undefined}>
      {(control) => (
        <Select {...control} value={value} onChange={(event) => onChange(event.target.value as YesNoDraft)}>
          <option value="todo">{t("profile:answers.chooseAnswer")}</option>
          <option value="yes">{t("profile:answers.yes")}</option>
          <option value="no">{t("profile:answers.no")}</option>
        </Select>
      )}
    </Field>
  );
}
