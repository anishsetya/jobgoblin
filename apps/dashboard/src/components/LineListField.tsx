// A list of short texts typed one per line (roles to avoid, banned words, ...). It is a plain text box,
// which is easier for a non-technical person than adding and removing chips, and it works with a screen reader.
// The box keeps the raw text while the person types (so a new empty line is not swallowed) and reports
// the cleaned-up list to its parent.
import { useState } from "react";
import { Field } from "./ui/Field";
import { Textarea } from "./ui/Textarea";

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

type LineListFieldProps = {
  label: string;
  hint?: string;
  value: string[];
  onChange: (lines: string[]) => void;
  rows?: number;
};

export function LineListField({ label, hint, value, onChange, rows = 4 }: LineListFieldProps) {
  const [text, setText] = useState(() => value.join("\n"));

  return (
    <Field label={label} hint={hint}>
      {(control) => (
        <Textarea
          {...control}
          rows={rows}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseLines(event.target.value));
          }}
        />
      )}
    </Field>
  );
}
