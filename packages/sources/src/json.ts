// Small helpers for reading feed JSON safely. Feeds are outside our control, so every value is narrowed
// from `unknown` the moment it is read, and a missing or oddly typed field becomes an empty value
// instead of a crash. Spec: "Job discovery"; CODE_STYLE.md "Types and validation".

export type JsonRecord = Record<string, unknown>;

export function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${what} was not valid JSON.`);
  }
}

export function parseJsonObject(body: string, what: string): JsonRecord {
  const record = asRecord(parseJson(body, what));
  if (record === null) {
    throw new Error(`${what} was not a JSON object.`);
  }
  return record;
}

export function parseJsonArray(body: string, what: string): unknown[] {
  const value = parseJson(body, what);
  if (!Array.isArray(value)) {
    throw new Error(`${what} was not a JSON list.`);
  }
  return value;
}

export function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export function readString(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

// Ids arrive as numbers (Greenhouse, YC) or strings (Lever, Ashby). Either way we keep them as text.
export function readIdText(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

export function readNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  return asRecord(record[key]);
}

export function readArray(record: JsonRecord, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

export function readStringArray(record: JsonRecord, key: string): string[] {
  const strings: string[] = [];
  for (const item of readArray(record, key)) {
    if (typeof item === "string") {
      strings.push(item);
    }
  }
  return strings;
}
