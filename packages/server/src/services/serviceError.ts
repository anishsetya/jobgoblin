// How services say "no": a ServiceError for a refusal the person (or the caller) must be told about, and an
// Outcome value for a problem that a Claude run can fix and try again.
// A ServiceError carries the ApiError words ({ code, message, action }); the HTTP error handler turns its
// `kind` into a status code, and the MCP tools turn it into a failed ToolReply.
// Spec: code style "Errors"; ARCHITECTURE.md sections 8 and 9.
import type { ToolError } from "@jobgoblin/schemas";

// not-found    there is no such thing (404)
// conflict     it exists, but is in the wrong state for this (409)
// invalid      what was asked for is not acceptable (400)
// unavailable  something this needs is not set up yet (409)
export type ServiceErrorKind = "not-found" | "conflict" | "invalid" | "unavailable";

export class ServiceError extends Error {
  readonly kind: ServiceErrorKind;
  readonly code: string; // for code to branch on, such as "data-sheet-changed"
  readonly action: string; // what to do next, in plain words

  constructor(kind: ServiceErrorKind, code: string, message: string, action: string) {
    super(message);
    this.name = "ServiceError";
    this.kind = kind;
    this.code = code;
    this.action = action;
  }
}

export function notFound(what: string, action = "Go back and choose again."): ServiceError {
  return new ServiceError("not-found", "not-found", `Jobgoblin can't find that ${what}.`, action);
}

export function conflict(code: string, message: string, action: string): ServiceError {
  return new ServiceError("conflict", code, message, action);
}

export function invalid(code: string, message: string, action: string): ServiceError {
  return new ServiceError("invalid", code, message, action);
}

export function unavailable(code: string, message: string, action: string): ServiceError {
  return new ServiceError("unavailable", code, message, action);
}

// The result of a service a Claude run calls, when the run can fix the problem and try again.
// Failures are values (not exceptions), so a tool can hand every error to the run at once.
export type Outcome<T> = { ok: true; value: T } | { ok: false; errors: ToolError[] };

export function succeeded<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function failed(errors: ToolError[]): Outcome<never> {
  return { ok: false, errors };
}

// A ServiceError as the ToolError a run would see.
export function toToolError(error: ServiceError): ToolError {
  return { code: error.code, message: `${error.message} ${error.action}` };
}
