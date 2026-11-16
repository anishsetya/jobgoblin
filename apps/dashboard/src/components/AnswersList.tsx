// The answers to the form's screening questions, each with a copy button. When there are none to show, one
// sentence says where they stand (not approved yet, being written, waiting on the person's reply, nothing to
// answer, or not written). The server works that out (ApplicationDetail.answersState), so this never guesses
// from an empty list. Used by Open application and the Application page, so both say the same thing.
// Spec: ARCHITECTURE.md sections 5.9 and 12 (/apply/:id and /apps/:id).
import type { Answer, AnswersState } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/CopyButton";

export function AnswersList({ answers, state }: { answers: Answer[]; state: AnswersState }) {
  const { t } = useTranslation();

  // "written" is the only state with answers, so it never needs a sentence of its own.
  if (answers.length === 0) {
    return <p className="text-sm text-muted">{t(`common:answers.state.${state}`)}</p>;
  }

  return (
    <ul className="space-y-5">
      {answers.map((answer) => (
        <li key={answer.question} className="space-y-1">
          <h3 className="text-sm font-medium">{answer.question}</h3>
          <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
          <CopyButton text={answer.answer} label={answer.question} />
        </li>
      ))}
    </ul>
  );
}
