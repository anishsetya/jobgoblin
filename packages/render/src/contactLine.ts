// Builds the contact line under the name: location, email, phone, then links, each with the
// address it should open when clicked. Empty fields are left out so the line never shows "|  |".
// Spec: "Resume pipeline" (code fills the header from the contact section; a run never writes it).
import type { ResumeHeader } from "@jobgoblin/schemas";

// `url` is null when the text should not be clickable (a location, a phone number, odd input).
export type ContactItem = { text: string; url: string | null };

// A web address the person typed: an optional http(s):// start, a dotted host, an optional path.
// Anything else (a handle, a sentence) is printed as plain text instead of becoming a link.
const WEB_ADDRESS = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildContactItems(header: ResumeHeader): ContactItem[] {
  const items: ContactItem[] = [];

  addPlainText(items, header.location);
  addEmail(items, header.email);
  addPlainText(items, header.phone);
  for (const link of header.links) addLink(items, link);

  return items;
}

function addPlainText(items: ContactItem[], value: string): void {
  const text = value.trim();
  if (text !== "") items.push({ text, url: null });
}

function addEmail(items: ContactItem[], value: string): void {
  const text = value.trim();
  if (text === "") return;
  items.push({ text, url: EMAIL_ADDRESS.test(text) ? `mailto:${text}` : null });
}

// "https://www.github.com/alex/" is printed as "github.com/alex" and opens the full address.
function addLink(items: ContactItem[], value: string): void {
  const typed = value.trim();
  if (typed === "") return;
  if (!WEB_ADDRESS.test(typed)) {
    items.push({ text: typed, url: null });
    return;
  }

  const hasScheme = /^https?:\/\//i.test(typed);
  const url = hasScheme ? typed : `https://${typed}`;
  const text = typed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
  items.push({ text, url });
}
