import { describe, expect, it } from "vitest";
import { buildRunEnvironment, scrubClaudeEnvironment } from "./runEnvironment";

const PERSONS_ENVIRONMENT: NodeJS.ProcessEnv = {
  PATH: "C:\\Windows\\System32",
  USERPROFILE: "C:\\Users\\alex",
  ANTHROPIC_API_KEY: "sk-ant-person",
  ANTHROPIC_AUTH_TOKEN: "token",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  ANTHROPIC_MODEL: "something",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CODE_USE_VERTEX: "1",
  CLAUDE_CONFIG_DIR: "C:\\Users\\alex\\.claude-work",
};

describe("buildRunEnvironment", () => {
  it("removes every ANTHROPIC_ and CLAUDE_CODE_USE_ variable and keeps the rest", () => {
    const environment = buildRunEnvironment(PERSONS_ENVIRONMENT, "token-1");

    expect(Object.keys(environment).sort()).toEqual(["CLAUDE_CONFIG_DIR", "JOBGOBLIN_RUN_TOKEN", "PATH", "USERPROFILE"]);
  });

  it("removes the variables whatever the spelling of their names", () => {
    const environment = buildRunEnvironment(
      { Anthropic_Api_Key: "sk", anthropic_base_url: "http://x", Claude_Code_Use_Bedrock: "1", Path: "C:\\bin" },
      "token-1",
    );

    expect(Object.keys(environment).sort()).toEqual(["JOBGOBLIN_RUN_TOKEN", "Path"]);
  });

  it("adds the run token as JOBGOBLIN_RUN_TOKEN", () => {
    const environment = buildRunEnvironment({}, "token-1");

    expect(environment.JOBGOBLIN_RUN_TOKEN).toBe("token-1");
  });

  it("replaces a run token the person's own environment happened to have, in any spelling", () => {
    const environment = buildRunEnvironment({ jobgoblin_run_token: "old", JOBGOBLIN_RUN_TOKEN: "older" }, "token-1");

    expect(environment).toEqual({ JOBGOBLIN_RUN_TOKEN: "token-1" });
  });

  it("leaves the environment it was given untouched", () => {
    const original = { ...PERSONS_ENVIRONMENT };

    buildRunEnvironment(PERSONS_ENVIRONMENT, "token-1");

    expect(PERSONS_ENVIRONMENT).toEqual(original);
  });

  it("leaves out variables whose value is undefined", () => {
    const environment = buildRunEnvironment({ PATH: "x", EMPTY: undefined }, "token-1");

    expect("EMPTY" in environment).toBe(false);
  });
});

describe("scrubClaudeEnvironment", () => {
  it("is what other claude commands (version, auth status) run with, without a run token", () => {
    const environment = scrubClaudeEnvironment(PERSONS_ENVIRONMENT);

    expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
    expect(environment.JOBGOBLIN_RUN_TOKEN).toBeUndefined();
    expect(environment.PATH).toBe("C:\\Windows\\System32");
  });
});
