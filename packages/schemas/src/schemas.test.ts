// Focused checks on the shared contracts: the lists that must stay in step with each other
// (statuses, tools, run kinds), and the rules that protect truthfulness and the person's private data.
import { describe, expect, it } from "vitest";
import {
  AddJobRequest,
  ApplicationStatus,
  Backup,
  CAP_STATUSES,
  DataSheetField,
  HistoryEvent,
  MCP_TOOL_NAMES,
  PERSONAL_SECTIONS,
  Profile,
  ResumeBody,
  RUN_KIND_SETTINGS,
  RUN_KIND_TOOLS,
  RunKind,
  SaveProfileSectionInput,
  StartRunRequest,
  STATUS_GROUPS,
  StoryItemData,
  TERMINAL_STATUSES,
  TODO,
} from "./index";
import type { McpToolName } from "./index";

// A resume body that follows every rule: each part names the story item it comes from.
function aResumeBody(experience: unknown = [anExperienceEntry()]): unknown {
  return {
    headline: { src: "headline-1", text: "Backend engineer who builds reliable APIs" },
    sections: { experience, projects: [] },
    skills: [{ src: "skill-1", text: "Python" }],
    education: [{ src: "education-1" }],
  };
}

function anExperienceEntry(): unknown {
  return {
    src: "experience-1",
    bullets: [{ src: "achievement-1", text: "Built a shipment-tracking API in Python" }],
  };
}

function runKindsThatMayCall(toolName: McpToolName): string[] {
  return RunKind.options.filter((runKind) => RUN_KIND_TOOLS[runKind].includes(toolName));
}

describe("application statuses", () => {
  it("puts every status in exactly one Pipeline column", () => {
    const columnsPerStatus = ApplicationStatus.options.map(
      (status) => STATUS_GROUPS.filter((group) => group.statuses.includes(status)).length,
    );

    expect(columnsPerStatus).toEqual(columnsPerStatus.map(() => 1));
  });

  it("counts an application toward a company's cap only from Tailored onwards, and never once closed", () => {
    const closedButCounted = CAP_STATUSES.filter((status) => TERMINAL_STATUSES.includes(status));

    expect(CAP_STATUSES).toContain("Tailored");
    expect(CAP_STATUSES).toContain("Offer");
    expect(CAP_STATUSES).not.toContain("Found");
    expect(CAP_STATUSES).not.toContain("Scored");
    expect(CAP_STATUSES).not.toContain("Long shot");
    expect(closedButCounted).toEqual([]);
  });
});

describe("MCP tools", () => {
  it("only gives run kinds tools that exist", () => {
    for (const runKind of RunKind.options) {
      for (const toolName of RUN_KIND_TOOLS[runKind]) {
        expect(MCP_TOOL_NAMES).toContain(toolName);
      }
    }
  });

  it("lets only paste, tailor and answers runs ask the person a question", () => {
    expect(runKindsThatMayCall("ask_person")).toEqual(["paste", "tailor", "answers"]);
  });

  it("lets every run kind read the profile and lets no run kind update a status", () => {
    expect(runKindsThatMayCall("get_profile")).toEqual(RunKind.options);
    expect(runKindsThatMayCall("update_status")).toEqual([]);
  });

  it("gives every other tool to at least one run kind", () => {
    const toolsNobodyUses = MCP_TOOL_NAMES.filter((toolName) => runKindsThatMayCall(toolName).length === 0);

    expect(toolsNobodyUses).toEqual(["update_status"]);
  });

  it("keeps the paste run from adding jobs, so it can only score the one it was given", () => {
    expect(RUN_KIND_TOOLS.paste).not.toContain("add_job");
    expect(RUN_KIND_TOOLS.paste).toContain("record_fit");
  });

  it("refuses to let a run save a personal profile section or the banned terms", () => {
    for (const section of [...PERSONAL_SECTIONS, "rules"]) {
      const result = SaveProfileSectionInput.safeParse({ section, data: {} });

      expect(result.success).toBe(false);
    }
    for (const section of ["employment", "workAuthorization", "targets"]) {
      expect(SaveProfileSectionInput.safeParse({ section, data: {} }).success).toBe(true);
    }
  });
});

describe("runs", () => {
  it("starts only a hunt from the generic runs route", () => {
    expect(StartRunRequest.safeParse({ kind: "hunt" }).success).toBe(true);
    expect(StartRunRequest.safeParse({ kind: "tailor", applicationIds: ["a1"] }).success).toBe(false);
  });

  it("gives only the hunt run built-in tools: web search, web fetch and its screener subagent", () => {
    expect(RUN_KIND_SETTINGS.hunt.builtInTools).toEqual(["WebSearch", "WebFetch", "Agent"]);
    for (const runKind of RunKind.options.filter((kind) => kind !== "hunt")) {
      expect(RUN_KIND_SETTINGS[runKind].builtInTools).toEqual([]);
    }
  });
});

describe("resume body", () => {
  it("accepts a resume where every part names its story item", () => {
    const result = ResumeBody.safeParse(aResumeBody());

    expect(result.success).toBe(true);
  });

  it("refuses a bullet that does not name its story item", () => {
    const bulletWithoutSource = { text: "Built a shipment-tracking API in Python" };
    const body = aResumeBody([{ src: "experience-1", bullets: [bulletWithoutSource] }]);

    const result = ResumeBody.safeParse(body);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["sections", "experience", 0, "bullets", 0, "src"]);
  });
});

describe("profile", () => {
  it("starts a new profile with every value to fill in marked TODO, EEO declined and 4 years allowed", () => {
    const profile = Profile.parse({});

    expect(profile.contact.email).toBe(TODO);
    expect(profile.compensation.expectedBase).toBe(TODO);
    expect(profile.eeo.gender).toBe("Decline to self-identify");
    expect(profile.targets.maxYearsRequired).toBe(4);
  });

  it("starts the targets with the default hard skip and flags", () => {
    const targets = Profile.parse({}).targets;

    expect(targets.hardSkips).toEqual(["An active security clearance is required"]);
    expect(targets.flags).toEqual(["Relocation required", "Graduation-year window"]);
  });

  it("gives each new profile its own lists, so editing one cannot change the next", () => {
    const first = Profile.parse({});
    first.targets.flags.push("Visa sponsorship offered");

    const second = Profile.parse({});

    expect(second.targets.flags).not.toContain("Visa sponsorship offered");
  });
});

describe("data sheet", () => {
  it("refuses a field whose key is not one of them", () => {
    const field = { label: "Social security number", value: "123", personal: true, required: false, missing: false };

    expect(DataSheetField.safeParse({ ...field, key: "email" }).success).toBe(true);
    expect(DataSheetField.safeParse({ ...field, key: "socialSecurityNumber" }).success).toBe(false);
  });
});

describe("adding a job", () => {
  it("needs a link or some text", () => {
    expect(AddJobRequest.safeParse({}).success).toBe(false);
    expect(AddJobRequest.safeParse({ url: "https://example.com/jobs/1" }).success).toBe(true);
  });

  it("accepts pasted text when it comes with a company and a title", () => {
    const result = AddJobRequest.safeParse({ text: "Backend role...", company: "Acme", title: "Backend Engineer" });

    expect(result.success).toBe(true);
  });

  it("asks for the company and the title, each at its own field, when text comes without them", () => {
    const result = AddJobRequest.safeParse({ text: "Backend role..." });

    const fieldsWithProblems = result.error?.issues.map((issue) => issue.path.join("."));
    expect(fieldsWithProblems).toEqual(["company", "title"]);
  });
});

describe("shapes of values", () => {
  it("refuses a story date written in words", () => {
    const result = StoryItemData.safeParse({ text: "Built an API", startDate: "June 2024" });

    expect(result.success).toBe(false);
  });

  it("accepts timestamps in UTC and refuses ones with an offset, so they sort as text", () => {
    const backup = { id: "2026-10-31 14-05.jobgoblin-backup", sizeBytes: 1024 };

    const inUtc = Backup.safeParse({ ...backup, createdAt: "2026-10-31T14:05:00.000Z" });
    const withOffset = Backup.safeParse({ ...backup, createdAt: "2026-10-31T19:35:00+05:30" });

    expect(inUtc.success).toBe(true);
    expect(withOffset.success).toBe(false);
  });

  it("accepts a known kind of history event and refuses any other", () => {
    const event = {
      id: "e1",
      ts: "2026-10-31T14:05:00.000Z",
      actor: "person",
      applicationId: "a1",
      from: null,
      to: null,
      detail: null,
    };

    expect(HistoryEvent.safeParse({ ...event, type: "approved" }).success).toBe(true);
    expect(HistoryEvent.safeParse({ ...event, type: "something-else" }).success).toBe(false);
  });
});
