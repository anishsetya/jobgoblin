// The switches a test turns on through environment variables, read once at the start of a run.
// They make the fake sign out, hit a usage limit, crash and so on, so every failure path of the runner
// can be exercised without a real Claude plan. The README lists what each one does.
// Spec: ARCHITECTURE.md section 14 (switches through env).

export const FAKE_CLAUDE_MODES = [
  "normal",
  "signed-out",
  "usage-limit",
  "crash",
  "slow",
  "max-turns",
  "extra-tools",
] as const;

export type FakeClaudeMode = (typeof FAKE_CLAUDE_MODES)[number];

export type FakeSettings = {
  mode: FakeClaudeMode;
  askFirst: boolean; // FAKE_CLAUDE_ASK_FIRST=1: ask the person about the first application
  inventBullet: boolean; // FAKE_CLAUDE_INVENT_BULLET=1: first submit a resume with made-up parts
};

function isFakeClaudeMode(value: string): value is FakeClaudeMode {
  return FAKE_CLAUDE_MODES.some((mode) => mode === value);
}

export function readFakeSettings(env: NodeJS.ProcessEnv): FakeSettings {
  const requestedMode = env.FAKE_CLAUDE_MODE ?? "normal";
  if (!isFakeClaudeMode(requestedMode)) {
    // A typo must not silently turn into a normal run: the test would pass for the wrong reason.
    throw new Error(`FAKE_CLAUDE_MODE must be one of: ${FAKE_CLAUDE_MODES.join(", ")}. Got "${requestedMode}".`);
  }

  return {
    mode: requestedMode,
    askFirst: env.FAKE_CLAUDE_ASK_FIRST === "1",
    inventBullet: env.FAKE_CLAUDE_INVENT_BULLET === "1",
  };
}
