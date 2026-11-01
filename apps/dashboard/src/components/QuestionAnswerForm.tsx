// The answer box for a question a run asked about one application (PRD R2, decision D17).
// The run carries on with other applications; sending the answer puts this one back in the queue.
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAnswerQuestion } from "@/api/runs";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Textarea } from "./ui/Textarea";

type QuestionAnswerFormProps = {
  questionId: string;
  questionText: string;
};

export function QuestionAnswerForm({ questionId, questionText }: QuestionAnswerFormProps) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState("");
  const answerQuestion = useAnswerQuestion();

  function sendAnswer(event: FormEvent): void {
    event.preventDefault();
    const trimmedAnswer = answer.trim();
    if (trimmedAnswer === "") return;
    answerQuestion.mutate({ questionId, answer: trimmedAnswer }, { onSuccess: () => setAnswer("") });
  }

  return (
    <form onSubmit={sendAnswer} className="mt-3 space-y-3">
      <Field label={questionText}>
        {(control) => <Textarea {...control} rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} />}
      </Field>
      <Button type="submit" size="small" disabled={answer.trim() === "" || answerQuestion.isPending}>
        {t("common:question.send")}
      </Button>
      <ErrorNotice error={answerQuestion.error} />
    </form>
  );
}
