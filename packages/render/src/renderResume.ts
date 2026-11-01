// Renders a resume to PDF with Typst, in this process (no command to run, no file written).
// The resume reaches the template as one JSON string in `sys.inputs`, so text from a run or from the
// person can never become Typst markup: the template decodes it and prints it as plain strings.
// Spec: "Resume pipeline" (Render); ARCHITECTURE.md section 8.1 and decision D13.
import { readFileSync } from "node:fs";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { buildResumeView, type ResumeViewInput } from "./resumeView";
import { TEMPLATE_VERSION, templateFilePath } from "./templates";

export type RenderResumeInput = ResumeViewInput;

export type ResumeRenderer = {
  renderResumePdf(input: RenderResumeInput): Promise<Uint8Array>;
};

// `templatesDir` is the folder that holds one subfolder per template version (t1, ...).
// The template is read once here, so a wrong folder fails when the app starts, not on the first resume.
export function createResumeRenderer(options: { templatesDir: string }): ResumeRenderer {
  const templateSource = readTemplate(options.templatesDir);
  const compiler = NodeCompiler.create();

  // Typst compiles synchronously, so this is `async` only to keep the door open for moving the work
  // to a worker thread later without changing any caller.
  async function renderResumePdf(input: RenderResumeInput): Promise<Uint8Array> {
    const view = buildResumeView(input);
    const pdf = compileToPdf(compiler, templateSource, JSON.stringify(view));
    return Uint8Array.from(pdf);
  }

  return { renderResumePdf };
}

function readTemplate(templatesDir: string): string {
  const filePath = templateFilePath(templatesDir, TEMPLATE_VERSION);
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`The resume template was not found at ${filePath}.`, { cause: error });
  }
}

function compileToPdf(compiler: NodeCompiler, templateSource: string, resumeJson: string): Uint8Array {
  try {
    return compiler.pdf({ mainFileContent: templateSource, inputs: { resume: resumeJson } });
  } catch (error) {
    throw new Error(`The resume template failed to compile: ${describeTypstError(error)}`, { cause: error });
  }
}

// Typst's Node binding puts its diagnostic ("0: unknown variable: x") in `code` and leaves `message` empty.
function describeTypstError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
    if (error.message !== "") return error.message;
  }
  return String(error);
}
