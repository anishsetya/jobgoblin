// "Ask about this application": the person types a question, a run answers it from what Jobgoblin knows about
// this application, and the answer is kept below. Answers are shown as plain text. Spec: PRD "Application detail".
import type { AskResult } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAskAboutApplication } from "@/api/applications";
import { useLiveRun } from "@/api/runs";
import { ErrorNotice } from "@/components/ErrorNotice";
import { RunCard } from "@/components/RunCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Textarea";
import { formatMoment } from "@/lib/format";

type AskCardProps = {
  applicationId: string;
  canAsk: boolean;
  results: AskResult[];
};

export function AskCard({ applicationId, canAsk, results }: AskCardProps) {
  const { t } = useTranslation();
  const ask = useAskAboutApplication(applicationId);
  const [question, setQuestion] = useState("");
  const [askRunId, setAskRunId] = useState<string | null>(null);
  const askRun = useLiveRun(askRunId);

  const newestFirst = [...results].sort((a, b) => b.at.localeCompare(a.at));
  const isAnswering = askRun !== null && (askRun.status === "queued" || askRun.status === "running");

  function send(event: FormEvent): void {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (trimmedQuestion === "") return;
    ask.mutate(trimmedQuestion, {
      onSuccess: (run) => {
        setAskRunId(run.id);
        setQuestion("");
      },
    });
  }

  return (
    <Card title={t("application:ask.title")} description={t("application:ask.description")}>
      <div className="space-y-5">
        <form onSubmit={send} className="space-y-3">
          <Field label={t("application:ask.label")}>
            {(control) => (
              <Textarea {...control} rows={3} disabled={!canAsk} value={question} onChange={(event) => setQuestion(event.target.value)} />
            )}
          </Field>
          <Button type="submit" disabled={!canAsk || question.trim() === "" || ask.isPending || isAnswering}>
            {t("application:ask.send")}
          </Button>
          <ErrorNotice error={ask.error} />
        </form>

        {askRun !== null && isAnswering && <RunCard run={askRun} />}

        {newestFirst.length > 0 && (
          <ul className="space-y-4">
            {newestFirst.map((result) => (
              <li key={`${result.at}-${result.question}`} className="space-y-1">
                <h3 className="text-sm font-medium">{result.question}</h3>
                <p className="text-sm whitespace-pre-wrap">{result.answer}</p>
                <p className="text-xs text-muted">{formatMoment(result.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
