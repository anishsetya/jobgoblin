// A small reader for RSS 2.0 feeds, which is all We Work Remotely sends. It is not a general XML parser:
// it finds <item> blocks and the text of their child tags, and understands XML escapes and CDATA.
// Spec: "Job discovery" (We Work Remotely).
import { decodeEntities } from "./entities";

const ITEM = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
const CDATA = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;

// The text between <item> and </item> for every item in the feed.
export function readRssItems(xml: string): string[] {
  const items: string[] = [];
  for (const match of xml.matchAll(ITEM)) {
    items.push(match[1] ?? "");
  }
  return items;
}

// The text of one child tag, such as "title", or "" when the tag is missing or empty.
// For escaped HTML inside a tag the result is the HTML itself; htmlToText turns that into text.
export function readXmlText(xml: string, tagName: string): string {
  const tag = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`);
  const match = tag.exec(xml);
  const content = (match?.[1] ?? "").trim();
  const cdata = CDATA.exec(content);
  // CDATA is already raw text. Anything else has XML escapes (&amp;, &lt;) to undo.
  return cdata !== null ? (cdata[1] ?? "") : decodeEntities(content);
}
