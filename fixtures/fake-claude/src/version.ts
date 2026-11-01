// The version the fake pretends to be. It is above the runner's MINIMUM_CLAUDE_VERSION ("2.1.0"), so the
// "update needed" screen never appears just because the fake is installed.
// Spec: ARCHITECTURE.md section 14 (`--version` prints `2.1.99 (Claude Code)`).
export const FAKE_CLAUDE_VERSION = "2.1.99";

// The exact line `claude --version` prints.
export const VERSION_TEXT = `${FAKE_CLAUDE_VERSION} (Claude Code)`;
