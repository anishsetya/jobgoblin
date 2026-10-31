// Turns the HTML in job postings into plain text that people and Claude can read.
// It keeps what carries meaning (paragraph breaks, bullet lists) and drops tags, scripts and styling.
// CSS is never evaluated: text a page hides with styling stays in the result, because posting text is
// untrusted and the server treats all of it as data. Spec: "Job discovery".
import { decodeEntities } from "./entities";

const SCRIPT_AND_STYLE_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

// Tags that start and end a block of text. Each one becomes a blank line.
const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "tr",
  "blockquote", "pre", "section", "article", "header", "footer", "hr",
]);

export function htmlToText(html: string): string {
  // In HTML a line break in the source is just a space; only tags make real breaks. Treating them alike
  // would put a blank line between every list item of a page that has one <li> per source line.
  const compactHtml = html.replace(/\s+/g, " ");
  const withoutHiddenBlocks = compactHtml.replace(SCRIPT_AND_STYLE_BLOCKS, "").replace(HTML_COMMENTS, "");
  // Tags go first and entities second, so a posting that talks about "&lt;div&gt;" keeps those words.
  const withoutTags = withoutHiddenBlocks.replace(TAG, (_tag: string, slash: string, name: string) =>
    textForTag(name, slash === "/"),
  );
  return tidyText(decodeEntities(withoutTags));
}

function textForTag(tagName: string, isClosing: boolean): string {
  const name = tagName.toLowerCase();
  if (name === "br") {
    return "\n";
  }
  if (name === "li") {
    return isClosing ? "" : "\n- ";
  }
  return BLOCK_TAGS.has(name) ? "\n\n" : "";
}

// Also used on text that is already plain: squeezes spaces, trims every line, allows one blank line.
export function tidyText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  return (
    lines
      .join("\n")
      // A bullet whose text sits in its own paragraph ("<li><p>...") should read "- text" on one line.
      .replace(/^-\n+/gm, "- ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
