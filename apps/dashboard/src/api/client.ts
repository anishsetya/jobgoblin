// The one place the dashboard talks to the local server. `apiFetch` adds the session key, checks the
// answer against its schema, and turns every failure into an `ApiProblem` the screens can show as it is.
// Components never call `fetch` themselves; they use the hooks in this folder, which use this file.
// Spec: ARCHITECTURE.md sections 11 and 12.
import { ApiError } from "@jobgoblin/schemas";
import i18n from "@/i18n";
import { readSessionToken } from "./token";

// What the person sees when a request fails: plain words for what happened and what to do next.
// The server sends both for its own refusals; this file writes them for failures the server never saw.
export class ApiProblem extends Error {
  readonly code: string; // for code to branch on, such as "data-sheet-changed"; never shown
  readonly action: string;
  readonly status: number; // the HTTP status, or 0 when no answer arrived

  constructor({ code, message, action }: ApiError, status: number) {
    super(message);
    this.name = "ApiProblem";
    this.code = code;
    this.action = action;
    this.status = status;
  }
}

// Anything with a zod-style `parse` works, so the hooks pass the schemas from @jobgoblin/schemas as they are.
export type ResponseSchema<T> = { parse(data: unknown): T };

// A schema for a list of things, built from the schema of one thing.
export function arrayOf<T>(itemSchema: ResponseSchema<T>): ResponseSchema<T[]> {
  return {
    parse(data: unknown): T[] {
      if (!Array.isArray(data)) throw new TypeError("Expected a list.");
      return data.map((item) => itemSchema.parse(item));
    },
  };
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type RequestOptions = {
  method?: HttpMethod;
  json?: unknown; // sent as the JSON body
  form?: FormData; // sent as a file upload
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type LocalProblemCode = "network" | "unexpected-response" | "unknown";

function localProblem(code: LocalProblemCode, status: number): ApiProblem {
  return new ApiProblem(
    {
      code,
      message: i18n.t(`common:errors.${code}.message`),
      action: i18n.t(`common:errors.${code}.action`),
    },
    status,
  );
}

function buildHeaders(options: RequestOptions): Headers {
  const headers = new Headers(options.headers);
  const token = readSessionToken();
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  // A file upload sets its own Content-Type, because the boundary between parts must be in it.
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  return headers;
}

async function sendRequest(path: string, options: RequestOptions): Promise<Response> {
  try {
    return await fetch(path, {
      method: options.method ?? "GET",
      headers: buildHeaders(options),
      body: options.json !== undefined ? JSON.stringify(options.json) : options.form,
      signal: options.signal,
    });
  } catch (error) {
    // Cancelling a request on purpose (leaving a screen, closing the event stream) is not a failure.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw localProblem("network", 0);
  }
}

async function problemFromResponse(response: Response): Promise<ApiProblem> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = ApiError.safeParse(body);
  if (parsed.success) return new ApiProblem(parsed.data, response.status);
  return localProblem("unknown", response.status);
}

// Sends a request and returns the raw response, or throws an ApiProblem when the answer is an error.
// The event stream and file downloads use this directly; everything else uses apiFetch.
export async function apiRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const response = await sendRequest(path, options);
  if (!response.ok) throw await problemFromResponse(response);
  return response;
}

// Sends a request and returns the answer, checked against `schema`.
export async function apiFetch<T>(
  path: string,
  options: RequestOptions & { schema: ResponseSchema<T> },
): Promise<T> {
  const response = await apiRequest(path, options);
  const body: unknown = await response.json().catch(() => null);
  try {
    return options.schema.parse(body);
  } catch (error) {
    // The shape check names the field that was wrong, never its value, so this is safe to log.
    console.error(`The answer from ${path} did not have the expected shape.`, error);
    throw localProblem("unexpected-response", response.status);
  }
}

// Fetches a file (a resume PDF, a CSV) as bytes.
export async function apiFetchBlob(path: string): Promise<Blob> {
  const response = await apiRequest(path);
  return response.blob();
}

// Adds ?a=1&b=2 to a path, leaving out parameters that are empty.
export function withQuery(path: string, parameters: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") query.set(name, value);
  }
  const text = query.toString();
  return text === "" ? path : `${path}?${text}`;
}
