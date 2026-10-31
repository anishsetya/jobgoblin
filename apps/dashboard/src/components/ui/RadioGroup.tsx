// A group of radio buttons built from the browser's own inputs, wrapped in a <fieldset> with a
// <legend> so a screen reader announces the question before the options. Arrow keys move between options.
import { useId } from "react";

export type RadioOption = {
  value: string;
  label: string;
  hint?: string;
};

type RadioGroupProps = {
  legend: string;
  options: readonly RadioOption[];
  value: string;
  onChange: (value: string) => void;
};

export function RadioGroup({ legend, options, value, onChange }: RadioGroupProps) {
  const groupName = useId();

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option) => {
        const optionId = `${groupName}-${option.value}`;
        return (
          <div key={option.value} className="flex items-start gap-2">
            <input
              id={optionId}
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
            <label htmlFor={optionId} className="text-sm">
              {option.label}
              {option.hint !== undefined && <span className="block text-xs text-muted">{option.hint}</span>}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}
