// Shows whether Claude Code is ready and offers the one button that fixes what is missing: Install
// (or Update), then Sign in. Used in the setup wizard and in Settings. Spec: PRD S2 and S3.
// Jobgoblin never sees the sign-in: Anthropic's own page opens, and this card notices when it is done.
import { useTranslation } from "react-i18next";
import { useClaudeStatus, useInstallClaude, useSignInToClaude } from "@/api/claude";
import { ErrorNotice } from "./ErrorNotice";
import { LoadingNote } from "./LoadingNote";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

type ClaudeConnectionProps = {
  // True in the setup wizard: keep checking until the person has finished signing in.
  recheckUntilConnected?: boolean;
};

export function ClaudeConnection({ recheckUntilConnected = false }: ClaudeConnectionProps) {
  const { t } = useTranslation();
  const status = useClaudeStatus({ recheckUntilConnected });
  const installClaude = useInstallClaude();
  const signInToClaude = useSignInToClaude();

  if (status.isPending) return <LoadingNote />;
  if (status.isError) return <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />;

  const claude = status.data;
  const needsInstall = claude.state === "not-installed" || claude.state === "update-needed";
  const needsSignIn = claude.state === "signed-out";
  const command = needsInstall ? claude.installCommand : claude.signInCommand;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={claude.state === "connected" ? "green" : "amber"}>{t(`common:claude.state.${claude.state}`)}</Badge>
        {claude.version !== null && (
          <span className="text-sm text-muted">{t("common:claude.version", { version: claude.version })}</span>
        )}
        {claude.plan !== null && <span className="text-sm text-muted">{t("common:claude.plan", { plan: claude.plan })}</span>}
      </div>

      <p className="text-sm">{t(`common:claude.explain.${claude.state}`)}</p>

      <div className="flex flex-wrap gap-2">
        {needsInstall && (
          <Button disabled={installClaude.isPending} onClick={() => installClaude.mutate()}>
            {installClaude.isPending
              ? t("common:claude.installing")
              : t(claude.state === "update-needed" ? "common:claude.update" : "common:claude.install")}
          </Button>
        )}
        {needsSignIn && (
          <Button disabled={signInToClaude.isPending} onClick={() => signInToClaude.mutate()}>
            {signInToClaude.isPending ? t("common:claude.signingIn") : t("common:claude.signIn")}
          </Button>
        )}
        <Button variant="ghost" disabled={status.isFetching} onClick={() => void status.refetch()}>
          {t("common:claude.checkAgain")}
        </Button>
      </div>

      {signInToClaude.isSuccess && needsSignIn && (
        <p role="status" className="text-sm text-muted">
          {t("common:claude.finishSignIn")}
        </p>
      )}

      {!claude.state.startsWith("connected") && command !== "" && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("common:claude.showCommand")}</summary>
          <p className="mt-2 text-muted">{t("common:claude.commandNote")}</p>
          <code className="mt-1 block rounded-md bg-surface-muted p-2 font-mono text-xs break-all">{command}</code>
        </details>
      )}

      <ErrorNotice error={installClaude.error ?? signInToClaude.error} />
    </div>
  );
}
