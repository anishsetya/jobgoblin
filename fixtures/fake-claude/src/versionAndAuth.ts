// The two small commands the runner uses besides `-p`: `claude --version` and `claude auth status|login`.
// The app uses them on the "Connect Claude" screen to detect the install, check the version and sign in.
// Spec: ARCHITECTURE.md section 10 (claudeCli.ts) and section 14.
import type { FakeSettings } from "./settings";
import { VERSION_TEXT } from "./version";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1; // the real CLI's code for "not signed in" and for a run that ended in error
export const EXIT_USAGE = 2; // the fake was started in a way it does not support

export function printVersion(): number {
  process.stdout.write(`${VERSION_TEXT}\n`);
  return EXIT_OK;
}

export function runAuthCommand(action: string | null, settings: FakeSettings): number {
  if (action === "status") return printAuthStatus(settings);

  if (action === "login") {
    // The real command opens a browser. The fake has nothing to open and signs nobody in:
    // sign-in state is the FAKE_CLAUDE_MODE of each start.
    process.stdout.write("The fake Claude has no sign-in page. Nothing to do.\n");
    return EXIT_OK;
  }

  process.stderr.write("fake-claude: supported commands are `auth status` and `auth login`\n");
  return EXIT_USAGE;
}

// Prints JSON either way. Signed out it also exits 1, like the real CLI, so the caller must read stdout
// before it looks at the exit code.
function printAuthStatus(settings: FakeSettings): number {
  if (settings.mode === "signed-out") {
    process.stdout.write(`${JSON.stringify({ loggedIn: false, authMethod: "none" })}\n`);
    return EXIT_FAILED;
  }

  process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" })}\n`);
  return EXIT_OK;
}
