# @jobgoblin/render

Turns a resume into a one-page PDF, reads a PDF back, and reads the text out of a resume the person uploads (PDF or Word). It is a leaf package: it imports only `@jobgoblin/schemas` from the workspace, and it never touches the database, the person's folder or the network.

```ts
import { createResumeRenderer, defaultTemplatesDir, readPdf, extractResumeText, TEMPLATE_VERSION } from "@jobgoblin/render";

const renderer = createResumeRenderer({ templatesDir: defaultTemplatesDir() });
const pdf = await renderer.renderResumePdf({ header, body, storyItems, versionId });
const { pages, text } = await readPdf(pdf);               // the server checks pages === 1 and searches text
const uploaded = await extractResumeText(bytes, "resume.docx");
```

## Read first

1. `templates/t1/resume.typ`: the whole look of the resume, commented for readers who have not seen Typst.
2. `src/resumeView.ts`: the bridge between data and template. It joins a `ResumeBody` with the story items it cites and produces plain strings.
3. `src/renderResume.ts`: how the view reaches Typst, in about 50 lines.
4. `src/readPdf.ts` and `src/extractResumeText.ts`: reading PDFs and Word files.

## How the template gets its data

```
ResumeHeader + ResumeBody + StoryItem[]
      |  buildResumeView            company, title, location and dates come from the cited story item;
      v                              bullets use the body's text; education is copied by code
   ResumeView  --JSON.stringify-->  sys.inputs.resume  --json(bytes(...))-->  resume.typ  -->  PDF bytes
```

The template never receives text as Typst source. It receives one JSON string, decodes it, and prints the values as strings, which Typst shows literally. So `#`, `$`, `*`, `_`, `@`, `<`, `>`, `\` and even hostile text such as `#panic("boom")` or `$ x^2 $` come out exactly as typed. The version id goes into the PDF's Keywords property, and the creation date is left out so the same resume always produces the same bytes.

## Files

| File | What it does |
| --- | --- |
| `src/templates.ts` | `TEMPLATE_VERSION` ("t1"), `defaultTemplatesDir()`, where a template file lives |
| `src/resumeView.ts` | `buildResumeView`: the view model the template prints |
| `src/resumeDates.ts` | "2024-06" to "Jun 2024", ranges such as "Jun 2024 – Present" |
| `src/contactLine.ts` | The contact line: order, empty fields skipped, which items become links |
| `src/renderResume.ts` | `createResumeRenderer`: view to Typst to PDF bytes |
| `src/withOpenPdf.ts` | The one place that opens a PDF with pdf.js (legacy build) and always closes it |
| `src/readPdf.ts` | `readPdf`: page count and text |
| `src/extractResumeText.ts`, `src/resumeFileError.ts` | PDF via pdf.js, `.docx` via mammoth, plain errors for anything else |
| `src/testSupport.ts` | Loads the demo person and builds the full demo body (tests and fixture script only) |
| `scripts/` | Builds `fixtures/resumes/alex-rivera.pdf` and `.docx`; a tiny zip writer and a minimal Word writer |

## The template

US letter, 0.5 in top and bottom margins, 0.6 in side margins, one column, New Computer Modern 11 pt. The name is 26 pt bold and centered, then an optional headline and the contact line with `|` separators. Section titles are bold small caps with a full-width 0.6 pt rule. Each entry has the company in bold with the location on the right, then the title in italics with the dates on the right, then tight bullets. Sections with nothing in them are left out. About 20 single-line bullets across 3 experiences and 2 projects fit on the page; 25 do not.

To change the look, copy `templates/t1` to `templates/t2`, edit it, and change `TEMPLATE_VERSION`. Resume version ids include the template version, so every resume rendered with the new look gets a new id. Keep the old folder so an old version can still be explained.

## How it is tested

`pnpm exec vitest run packages/render` runs three files:

- `renderResume.test.ts` renders real PDFs: the demo resume is exactly one page and contains the name and every bullet; an oversized resume reads back as two or more pages; the version id is in the PDF metadata; the same resume gives the same bytes; special characters and hidden Typst code print literally; a citation to a missing story item is refused.
- `resumeView.test.ts` checks the view model and date formatting without rendering.
- `extractResumeText.test.ts` reads `fixtures/resumes/alex-rivera.pdf` and `.docx`, then the files in `fixtures/resumes/broken/` and checks the code and words of each error: a real password-protected PDF, the demo PDF and Word file cut in half, text files renamed `.pdf` and `.docx`, and a text file named `.png`. The "our side" message is tested by making the PDF reader fail with an error it does not know.

Rebuild the fixtures after changing the story file or the template with `pnpm --filter @jobgoblin/render fixtures`. The story file `fixtures/resumes/alex-rivera.story.json` is edited by hand; the PDF and Word files are generated from it, and so are the broken files (`scripts/buildBrokenResumeFixtures.ts`; the password-protected PDF is written by `scripts/passwordProtectedPdf.ts` with `node:crypto`, and its password is `jobgoblin`).

## Decisions

1. **One JSON input, never string building.** A resume reaches Typst as `sys.inputs.resume` and is decoded with `json(bytes(...))` (Typst 0.14 in this binding). This is the only protection against Typst injection, so the template never uses `eval`.
2. **A view model between data and template.** Facts such as company, title, location and dates are looked up from the cited story item in code, so a run can reword a bullet but cannot change them.
3. **Ligatures are off.** "fi" stays two letters for any program that reads text back out of the PDF (applicant tracking systems, `readPdf`). A side effect is that `--` is printed as two hyphens.
4. **The PDF has no creation date.** The same input gives the same bytes, which makes tests exact and an identical approved resume byte-for-byte identical.
5. **Spacing follows design.yaml, adapted to the new font.** Line spacing is 0.66 em as in the prototype, and the gap between bullets is one line plus the prototype's 0.07 cm. Typst measures a line from the top of a capital letter to the baseline, so a smaller gap would pull descenders into the next bullet.
6. **Entries never split across pages.** A resume that is too long moves a whole entry to page 2 and fails the one-page check, which is what the server needs to see.
7. **Projects print "Name | tools" on one row**, with dates on the right and no second row, as in Jake's resume. Experience and education use two rows.
8. **Section order follows the prototype master:** Experience, Projects, Technical Skills, Education. Skills are one comma-separated line, because a `ResumeBody` holds a flat list of skills.
9. **Links are made clickable only when they look like web addresses** (and the email as `mailto:`). Anything else prints as plain text. Links print without `https://` and `www.`.
10. **pdf.js uses the legacy build and its main-thread reader.** There is no worker setup. pdf.js 6 has no eval switch and generates no code for fonts, so there is nothing to disable. When the server is bundled with tsup, mark `pdfjs-dist` and `@myriaddreamin/typst-ts-node-compiler` as external: the first loads its reader by relative path, the second is a native module.
11. **`extractResumeText` returns an empty string for a scan.** A PDF with no text layer is not an error here; the caller should check for empty text and ask for another file. A file that cannot be read throws `ResumeFileError` with a `code`, a `message` and an `action`, all in plain words meant to be shown as they are. Only what the reader reported is named: `unsupported-type` (not a PDF or `.docx`, including an old `.doc`), `password-protected` (pdf.js `PasswordException`), `damaged` (pdf.js `InvalidPDFException` or `FormatError`, or a zip or Word structure failure from mammoth). Anything else is `read-failed`, whose message says the problem is on our side, because an error we do not recognise is never proof that the file is bad. The reader's own error stays on `error.cause` for the server to log.
12. **The renderer reads its template once, when it is created**, so a wrong `templatesDir` fails at start-up rather than on the first resume.
13. **System fonts are not excluded.** Typst loads the bundled New Computer Modern first. A computer with another copy of that family installed could differ by a hair, and a character the font lacks (for example in a name) falls back to a system font.
14. **The Word fixture is built by our own tiny zip writer** (`scripts/zipWriter.ts`) because no zip library is installed. It writes only three parts and is checked by mammoth in the tests and by .NET's zip reader.
