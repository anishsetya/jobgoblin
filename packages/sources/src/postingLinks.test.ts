import { describe, expect, it } from "vitest";
import { recognizePostingLink } from "./postingLinks";

describe("recognizePostingLink", () => {
  it.each([
    ["https://boards.greenhouse.io/gridline/jobs/4100", "gridline", "4100"],
    ["https://job-boards.greenhouse.io/anthropic/jobs/5455961008", "anthropic", "5455961008"],
    ["https://boards.greenhouse.io/gridline/jobs/4100/?gh_src=abc#apply", "gridline", "4100"],
  ])("recognizes the Greenhouse link %s", (link, slug, id) => {
    expect(recognizePostingLink(link)).toEqual({ kind: "greenhouse", slug, id });
  });

  it.each([
    ["https://jobs.lever.co/brightpath/7c1d0e02-3f4a-4b5c-8d6e-0000000b0002", "brightpath"],
    ["https://jobs.lever.co/brightpath/7c1d0e02-3f4a-4b5c-8d6e-0000000b0002/apply", "brightpath"],
  ])("recognizes the Lever link %s", (link, slug) => {
    expect(recognizePostingLink(link)).toEqual({ kind: "lever", slug, id: "7c1d0e02-3f4a-4b5c-8d6e-0000000b0002" });
  });

  it.each([
    "https://jobs.ashbyhq.com/copperleaf/9a8b7c03-1d2e-4f3a-8b4c-0000000c0003",
    "https://jobs.ashbyhq.com/copperleaf/9a8b7c03-1d2e-4f3a-8b4c-0000000c0003/application",
  ])("recognizes the Ashby link %s", (link) => {
    expect(recognizePostingLink(link)).toEqual({
      kind: "ashby",
      slug: "copperleaf",
      id: "9a8b7c03-1d2e-4f3a-8b4c-0000000c0003",
    });
  });

  it.each([
    "https://www.linkedin.com/jobs/view/3912345678",
    "https://in.linkedin.com/jobs/view/3912345678",
    "https://wellfound.com/jobs/12345-backend-engineer",
    "https://www.workatastartup.com/jobs/54321",
    "https://www.welcometothejungle.com/en/companies/acme/jobs/backend-engineer",
    "https://www.instahyre.com/job-123456-backend-engineer-at-acme/",
    "https://cutshort.io/job/Backend-Engineer-Bengaluru-Acme-abc123",
    "https://www.indeed.com/viewjob?jk=abcdef0123456789",
    "https://in.indeed.com/viewjob?jk=abcdef0123456789",
  ])("says the login-only site %s needs the text pasted", (link) => {
    expect(recognizePostingLink(link)).toEqual({ kind: "login-only" });
  });

  it("does not mistake a lookalike domain for a login-only site", () => {
    expect(recognizePostingLink("https://notlinkedin.com/jobs/1")).toEqual({ kind: "unknown" });
    expect(recognizePostingLink("https://linkedin.com.evil.example/jobs/1")).toEqual({ kind: "unknown" });
  });

  it.each([
    "https://example.com/careers/backend-engineer",
    "https://boards.greenhouse.io/gridline",
    "https://boards.greenhouse.io/gridline/jobs/not-a-number",
    "https://jobs.lever.co/brightpath",
    "https://boards.greenhouse.io/../jobs/4100",
    "https://boards.greenhouse.io/a.b/jobs/4100",
    "javascript:alert(1)",
    "file:///C:/secrets.txt",
    "not a link at all",
    "",
  ])("does not recognize %s", (link) => {
    expect(recognizePostingLink(link)).toEqual({ kind: "unknown" });
  });
});
