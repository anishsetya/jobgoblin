// CoreError: the one error type packages/core throws.
// A rule failure that a person or a run must see (a banned word, a resume that breaks a limit) is returned
// as a value. A CoreError means the caller made a mistake, such as asking for a status move the table forbids.
// Spec: ARCHITECTURE.md section 6 (rule failures are values; programming or permission mistakes throw).

export type CoreErrorCode =
  | "invalid-transition" // a status move that is not in TRANSITIONS for that actor and via
  | "invalid-input"; // a value the function cannot work with, such as a Date inside JSON to be hashed

export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}
