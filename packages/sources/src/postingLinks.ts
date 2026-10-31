// Works out what a pasted job link is, without fetching anything: a public Greenhouse, Lever or Ashby
// posting we can read, a site that needs a login (so the person must paste the text), or something else.
// Spec: "Job discovery" (Login-only boards; Paste a job).

export type PostingLink =
  | { kind: "greenhouse"; slug: string; id: string }
  | { kind: "lever"; slug: string; id: string }
  | { kind: "ashby"; slug: string; id: string }
  | { kind: "login-only" }
  | { kind: "unknown" };

// Sites that cannot be read without signing in, or that do not allow automated reading.
// LinkedIn, Wellfound, Work at a Startup, Welcome to the Jungle, Instahyre, Cutshort and Indeed.
const LOGIN_ONLY_DOMAINS = [
  "linkedin.com",
  "wellfound.com",
  "workatastartup.com",
  "welcometothejungle.com",
  "instahyre.com",
  "cutshort.io",
  "indeed.com",
];

const GREENHOUSE_HOSTS = ["boards.greenhouse.io", "job-boards.greenhouse.io"];
const LEVER_HOST = "jobs.lever.co";
const ASHBY_HOST = "jobs.ashbyhq.com";

// A slug or id is placed into a request address and a file name, so only plain characters are accepted.
// No dots: ".." can never get through.
const SAFE_SLUG = /^[A-Za-z0-9_-]+$/;
const GREENHOUSE_ID = /^[0-9]+$/;
const UUID_LIKE_ID = /^[A-Za-z0-9-]+$/;

export function recognizePostingLink(link: string): PostingLink {
  const url = parseWebLink(link);
  if (url === null) {
    return { kind: "unknown" };
  }
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter((part) => part !== "");

  if (isLoginOnlyHost(host)) {
    return { kind: "login-only" };
  }
  if (GREENHOUSE_HOSTS.includes(host)) {
    return recognizeGreenhouse(pathParts);
  }
  if (host === LEVER_HOST) {
    return recognizeLeverOrAshby("lever", pathParts);
  }
  if (host === ASHBY_HOST) {
    return recognizeLeverOrAshby("ashby", pathParts);
  }
  return { kind: "unknown" };
}

function parseWebLink(link: string): URL | null {
  try {
    const url = new URL(link.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

// "www.linkedin.com" and "in.linkedin.com" both belong to linkedin.com.
function isLoginOnlyHost(host: string): boolean {
  return LOGIN_ONLY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// https://boards.greenhouse.io/<slug>/jobs/<id>
function recognizeGreenhouse(pathParts: string[]): PostingLink {
  const [slug, jobsWord, id] = pathParts;
  if (slug === undefined || id === undefined || jobsWord !== "jobs") {
    return { kind: "unknown" };
  }
  if (!SAFE_SLUG.test(slug) || !GREENHOUSE_ID.test(id)) {
    return { kind: "unknown" };
  }
  return { kind: "greenhouse", slug, id };
}

// https://jobs.lever.co/<slug>/<id>   and   https://jobs.ashbyhq.com/<slug>/<id>
// Either may end in "/apply" or "/application", which we ignore.
function recognizeLeverOrAshby(kind: "lever" | "ashby", pathParts: string[]): PostingLink {
  const [slug, id] = pathParts;
  if (slug === undefined || id === undefined) {
    return { kind: "unknown" };
  }
  if (!SAFE_SLUG.test(slug) || !UUID_LIKE_ID.test(id)) {
    return { kind: "unknown" };
  }
  return { kind, slug, id };
}
