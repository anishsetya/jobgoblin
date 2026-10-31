// Every failed request becomes one shape, { code, message, action }, in plain words with no blame and never a
// stack trace. A refusal a service chose (ServiceError) keeps its own words; a request that does not match
// its schema becomes "invalid-request"; rule and storage errors are mapped to sensible codes; anything
// unexpected is logged in full (to the log file only) and shown as a calm "something went wrong".
// Spec: ARCHITECTURE.md section 11 (errorHandler); code style "Errors".
import { CoreError } from "@jobgoblin/core";
import type { ApiError } from "@jobgoblin/schemas";
import { StorageError } from "@jobgoblin/storage";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { ServerContext } from "../context";
import { ServiceError, type ServiceErrorKind } from "../services/serviceError";

export type DescribedError = { status: ContentfulStatusCode; body: ApiError };

const STATUS_OF_KIND: Record<ServiceErrorKind, ContentfulStatusCode> = {
  "not-found": 404,
  conflict: 409,
  invalid: 400,
  unavailable: 409,
};

export function apiError(code: string, message: string, action: string): ApiError {
  return { code, message, action };
}

export const INTERNAL_ERROR = apiError(
  "internal-error",
  "Something went wrong inside Jobgoblin.",
  "Try again. If it keeps happening, restart Jobgoblin.",
);

// Pure: turns any thrown value into the status and body to send. `isUnexpected` tells the caller to log it.
export function describeError(error: unknown): DescribedError & { isUnexpected: boolean } {
  const known = describeKnownError(error);
  return known === null ? { status: 500, body: INTERNAL_ERROR, isUnexpected: true } : { ...known, isUnexpected: false };
}

function describeKnownError(error: unknown): DescribedError | null {
  if (error instanceof ServiceError) {
    return { status: STATUS_OF_KIND[error.kind], body: apiError(error.code, error.message, error.action) };
  }
  if (error instanceof ZodError) return { status: 400, body: describeZodError(error) };
  if (error instanceof HTTPException) return describeHttpException(error);
  if (error instanceof CoreError) return describeCoreError(error);
  if (error instanceof StorageError) return describeStorageError(error);
  return null;
}

function describeZodError(error: ZodError): ApiError {
  const issue = error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? "" : `"${issue.path.join(".")}": `;
  // Messages we wrote ourselves in the schemas ("Add the company name.") are plain words; zod's own are not.
  const detail = issue !== undefined && issue.code === "custom" ? issue.message : "This is not a valid value.";
  return apiError("invalid-request", `${where}${detail}`.trim(), "Check what you entered and try again.");
}

function describeHttpException(error: HTTPException): DescribedError {
  if (error.status === 413) {
    return { status: 413, body: apiError("too-large", "That is larger than Jobgoblin accepts.", "Choose a smaller file.") };
  }
  return { status: 400, body: apiError("invalid-request", "Jobgoblin could not read that request.", "Check what you sent and try again.") };
}

function describeCoreError(error: CoreError): DescribedError {
  if (error.code === "invalid-transition") {
    return {
      status: 409,
      body: apiError("invalid-transition", "That change is not allowed from where this application is now.", "Reload the page and look at the buttons it offers."),
    };
  }
  return { status: 400, body: apiError("invalid-request", "Jobgoblin could not use that value.", "Check what you entered and try again.") };
}

function describeStorageError(error: StorageError): DescribedError {
  switch (error.code) {
    case "stale-status":
      return {
        status: 409,
        body: apiError("stale-status", "This application changed while you were looking at it.", "Reload the page and try again."),
      };
    case "database-too-new":
      return { status: 409, body: apiError("database-too-new", error.message, "Install the newest Jobgoblin.") };
    case "no-person-folder":
      return { status: 409, body: apiError("no-person-folder", error.message, "Open Settings and choose a folder.") };
    case "backup-not-found":
      return { status: 404, body: apiError("backup-not-found", error.message, "Choose another backup.") };
    case "invalid-backup-id":
      return { status: 400, body: apiError("invalid-backup-id", "That is not a Jobgoblin backup.", "Choose a backup from the list.") };
    case "path-outside-folder":
      return { status: 400, body: apiError("path-outside-folder", "That is outside your Jobgoblin folder.", "Choose a file from that folder.") };
    case "not-found":
      return { status: 404, body: apiError("not-found", "Jobgoblin can't find that.", "Reload the page and try again.") };
    case "approved-file-conflict":
      return { status: 409, body: apiError("approved-file-conflict", "An approved resume file is already there and is different.", "Move the old file away, then try again.") };
    default:
      return { status: 500, body: INTERNAL_ERROR };
  }
}

// Hono calls this for anything a route throws. The log line holds the error and where it happened, never
// a request body or header (those can hold personal details or the token).
export function createErrorHandler(ctx: ServerContext): ErrorHandler {
  return (error, c) => {
    const described = describeError(error);
    if (described.isUnexpected) {
      ctx.logger.error({ err: error, method: c.req.method, path: c.req.path }, "A request failed unexpectedly.");
    }
    return c.json(described.body, described.status);
  };
}
