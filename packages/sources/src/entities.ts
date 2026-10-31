// Decodes HTML and XML character references such as &amp; and &#x2F;.
// It works in a single pass, so "&amp;lt;" becomes "&lt;" (what the author wrote) and not "<".
// Spec: "Job discovery" (feeds send HTML and XML; runs read text).

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  times: "×",
};

const LAST_CODE_POINT = 0x10ffff;
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;

// Matches "&name;", "&#123;" and "&#x1F;".
const ENTITY_PATTERN = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (reference: string, name: string) => decodeReference(reference, name));
}

// Unknown names are left exactly as written, so nothing is lost.
function decodeReference(reference: string, name: string): string {
  if (name.startsWith("#")) {
    return decodeNumericReference(reference, name);
  }
  return NAMED_ENTITIES[name] ?? reference;
}

function decodeNumericReference(reference: string, name: string): string {
  const isHex = name[1] === "x" || name[1] === "X";
  const codePoint = isHex ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
  if (!isValidCodePoint(codePoint)) {
    return reference;
  }
  return String.fromCodePoint(codePoint);
}

function isValidCodePoint(codePoint: number): boolean {
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > LAST_CODE_POINT) {
    return false;
  }
  const isSurrogate = codePoint >= FIRST_SURROGATE && codePoint <= LAST_SURROGATE;
  return !isSurrogate;
}
