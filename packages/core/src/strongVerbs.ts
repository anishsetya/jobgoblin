// Strong verbs: words that claim leadership or ownership ("led", "owned", "architected").
// A resume line may use one only if the story item it cites uses it too, so "contributed to" in Your story
// can never become "led" on a resume. Used by the truth trace.
// Spec: "Resume pipeline" step 2. ARCHITECTURE.md section 8.2 rule 4.

export type StrongVerb = { verb: string; forms: readonly string[] };

// A verb is listed with its forms in every tense. For words that are also everyday nouns (design, scale,
// launch, direct, head, own) only the verb forms are listed, so "system design" or "at scale" is not
// mistaken for a claim. The bare word "found" is left out because it is mostly the past tense of "find".
export const STRONG_VERBS: readonly StrongVerb[] = [
  { verb: "lead", forms: ["lead", "leads", "led", "leading"] },
  { verb: "own", forms: ["owns", "owned", "owning"] },
  { verb: "build", forms: ["build", "builds", "built", "building"] },
  { verb: "design", forms: ["designed", "designing"] },
  { verb: "launch", forms: ["launched", "launching"] },
  { verb: "manage", forms: ["manage", "manages", "managed", "managing"] },
  { verb: "architect", forms: ["architected", "architecting"] },
  { verb: "found", forms: ["founded", "founding"] },
  { verb: "create", forms: ["create", "creates", "created", "creating"] },
  { verb: "spearhead", forms: ["spearhead", "spearheads", "spearheaded", "spearheading"] },
  { verb: "direct", forms: ["directed", "directing"] },
  { verb: "head", forms: ["headed"] },
  { verb: "drive", forms: ["drive", "drives", "drove", "driven", "driving"] },
  { verb: "establish", forms: ["establish", "establishes", "established", "establishing"] },
  { verb: "pioneer", forms: ["pioneer", "pioneers", "pioneered", "pioneering"] },
  { verb: "mentor", forms: ["mentor", "mentors", "mentored", "mentoring"] },
  { verb: "scale", forms: ["scaled", "scaling"] },
  { verb: "ship", forms: ["ship", "ships", "shipped", "shipping"] },
];

const VERB_FOR_FORM: ReadonlyMap<string, string> = new Map(
  STRONG_VERBS.flatMap((strong) => strong.forms.map((form): [string, string] => [form, strong.verb])),
);

export type VerbUsed = {
  verb: string; // the verb in its base form, such as "lead": two lines use the same verb when this matches
  written: string; // how the text spells it, in lower case, such as "led"
};

// Every strong verb in the text, once each, in the order it first appears.
export function findStrongVerbs(text: string): VerbUsed[] {
  const used = new Map<string, VerbUsed>();
  for (const match of text.matchAll(/[A-Za-z]+/g)) {
    const written = match[0].toLowerCase();
    const verb = VERB_FOR_FORM.get(written);
    if (verb !== undefined && !used.has(verb)) used.set(verb, { verb, written });
  }
  return [...used.values()];
}
