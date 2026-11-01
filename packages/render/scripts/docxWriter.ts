// Builds a minimal, valid Word (.docx) file from a resume view: the same content as the PDF, as a person
// would type it in Word. It only needs three parts: a content-type list, the package relationships, and
// the document itself. Formatting is applied directly to each paragraph (no styles or numbering parts),
// and bullets are "•" characters, which keeps the XML short enough to read.
// Used only to make fixtures/resumes/alex-rivera.docx for the resume import tests.
import { createZip } from "./zipWriter";
import type { ResumeView, ViewEntry } from "../src/resumeView";

type Paragraph = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  centered?: boolean;
  sizeInPoints?: number;
  indented?: boolean; // bullets sit slightly in from the margin
  spaceBeforeInPoints?: number;
};

export function buildDocx(view: ResumeView): Uint8Array {
  const documentXml = buildDocumentXml(paragraphsFromView(view));
  return createZip([
    { name: "[Content_Types].xml", data: utf8(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: utf8(PACKAGE_RELATIONSHIPS_XML) },
    { name: "word/document.xml", data: utf8(documentXml) },
  ]);
}

// ---- Resume view -> paragraphs ---------------------------------------------------------------

function paragraphsFromView(view: ResumeView): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  paragraphs.push({ text: view.fullName, bold: true, centered: true, sizeInPoints: 26 });
  if (view.headline !== null) paragraphs.push({ text: view.headline, centered: true });
  paragraphs.push({ text: view.contact.map((item) => item.text).join(" | "), centered: true });

  addEntries(paragraphs, "EXPERIENCE", view.experience);
  addEntries(paragraphs, "PROJECTS", view.projects);
  if (view.skills.length > 0) {
    paragraphs.push(sectionTitle("TECHNICAL SKILLS"));
    paragraphs.push({ text: view.skills.join(", ") });
  }
  addEntries(paragraphs, "EDUCATION", view.education);

  return paragraphs;
}

function sectionTitle(title: string): Paragraph {
  return { text: title, bold: true, sizeInPoints: 12, spaceBeforeInPoints: 10 };
}

function addEntries(paragraphs: Paragraph[], title: string, entries: ViewEntry[]): void {
  if (entries.length === 0) return;

  paragraphs.push(sectionTitle(title));
  for (const entry of entries) {
    paragraphs.push({ text: joinParts(entry.heading, entry.headingNote, entry.headingRight), bold: true, spaceBeforeInPoints: 4 });
    const secondRow = joinParts(entry.subheading, entry.subheadingRight);
    if (secondRow !== "") paragraphs.push({ text: secondRow, italic: true });
    for (const bullet of entry.bullets) paragraphs.push({ text: `• ${bullet}`, indented: true });
  }
}

// "Northwind Logistics, Austin, TX": the cells of a row, comma separated, empty ones left out.
function joinParts(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(", ");
}

// ---- Paragraphs -> WordprocessingML ----------------------------------------------------------

const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function buildDocumentXml(paragraphs: Paragraph[]): string {
  const body = paragraphs.map(paragraphXml).join("");
  return `${XML_HEADER}<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>${body}</w:body></w:document>`;
}

function paragraphXml(paragraph: Paragraph): string {
  return `<w:p>${paragraphProperties(paragraph)}<w:r>${runProperties(paragraph)}<w:t xml:space="preserve">${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
}

// Paragraph properties: alignment, indent and the space before. Word wants them in this order.
function paragraphProperties(paragraph: Paragraph): string {
  const parts: string[] = [];
  if (paragraph.spaceBeforeInPoints !== undefined) {
    parts.push(`<w:spacing w:before="${paragraph.spaceBeforeInPoints * 20}"/>`); // twentieths of a point
  }
  if (paragraph.indented === true) parts.push('<w:ind w:left="284"/>');
  if (paragraph.centered === true) parts.push('<w:jc w:val="center"/>');
  return parts.length === 0 ? "" : `<w:pPr>${parts.join("")}</w:pPr>`;
}

// Run properties: bold, italic and size. Sizes are in half points.
function runProperties(paragraph: Paragraph): string {
  const parts: string[] = [];
  if (paragraph.bold === true) parts.push("<w:b/>");
  if (paragraph.italic === true) parts.push("<w:i/>");
  if (paragraph.sizeInPoints !== undefined) parts.push(`<w:sz w:val="${paragraph.sizeInPoints * 2}"/>`);
  return parts.length === 0 ? "" : `<w:rPr>${parts.join("")}</w:rPr>`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---- The fixed parts of every .docx ----------------------------------------------------------

const CONTENT_TYPES_XML =
  `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const PACKAGE_RELATIONSHIPS_XML =
  `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";
