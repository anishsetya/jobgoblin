// Reading a request: every body and query string is parsed with its zod schema before a service sees it.
// A body that is not valid JSON, or does not match, becomes a ZodError or ServiceError, which the error
// handler turns into the plain-words "invalid-request" answer.
// Spec: code style "Types and validation"; ARCHITECTURE.md section 11.
import type { Context } from "hono";
import type { ZodType } from "zod";
import { invalid } from "../services/serviceError";

// A route with no body at all (a bare POST) is read as {}, so "Skip" needs no payload.
export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const text = await c.req.text();
  if (text.trim() === "") return schema.parse({});

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalid("invalid-request", "Jobgoblin could not read that request.", "Check what you sent and try again.");
  }
  return schema.parse(json);
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  return schema.parse(c.req.query());
}

// "a,b" and repeated ?x=a&x=b both give ["a", "b"]; an empty value gives undefined (no filter).
export function listQueryValue(c: Context, name: string): string[] | undefined {
  const values = c.req.queries(name) ?? [];
  const items = values.flatMap((value) => value.split(",")).map((item) => item.trim()).filter((item) => item !== "");
  return items.length === 0 ? undefined : items;
}
