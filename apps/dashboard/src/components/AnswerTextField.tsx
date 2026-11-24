// One text answer on the Form answers screen. A required answer that is still empty is marked
// "Needs your answer" in amber, so every missing value is easy to see (PRD P3). A value the server refused is
// explained under the box in red, and a saved value that looks wrong (an email address with no "@") in amber.
import { useTranslation } from "react-i18next";
import { Badge } from "./ui/Badge";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";

type AnswerTextFieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  // Optional answers (a portfolio link, say) are never marked as missing.
  isRequired?: boolean;
  autoComplete?: string;
  error?: string;
  warning?: string;
};

export function AnswerTextField({ label, hint, value, onChange, isRequired = true, autoComplete, error, warning }: AnswerTextFieldProps) {
  const { t } = useTranslation();
  const isMissing = isRequired && value.trim() === "";

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      warning={warning}
      badge={isMissing ? <Badge tone="amber">{t("profile:answers.needsAnswer")}</Badge> : undefined}
    >
      {(control) => (
        <Input {...control} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}
