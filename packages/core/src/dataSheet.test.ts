import { describe, expect, it } from "vitest";
import { DataSheet, DataSheetKey, Profile } from "@jobgoblin/schemas";
import type { DataSheetField } from "@jobgoblin/schemas";
import {
  buildDataSheet,
  fillPlaceholders,
  hashDataSheet,
  placeholderDataSheet,
  requiredMissing,
} from "./dataSheet";
import { alexRiveraProfile } from "./testing/alexRivera";

const RESUME_VERSION = `r-${"ab".repeat(32)}`;

function alexsSheet(region: "US" | "IN" | "REMOTE" | "OTHER" = "US", profile: Profile = alexRiveraProfile()): DataSheet {
  return buildDataSheet({ applicationId: "app-1", profile, region, resumeVersion: RESUME_VERSION });
}

function fieldNamed(sheet: DataSheet, key: DataSheetKey): DataSheetField {
  const field = sheet.fields.find((candidate) => candidate.key === key);
  if (field === undefined) throw new Error(`The sheet has no ${key} field.`);
  return field;
}

describe("buildDataSheet", () => {
  it("has exactly the 24 keys, once each, in the dashboard's order", () => {
    const keys = alexsSheet().fields.map((field) => field.key);

    expect(keys).toEqual(DataSheetKey.options);
    expect(keys).toHaveLength(24);
  });

  it("produces a sheet the schema accepts, with a plain-English label on every field", () => {
    const sheet = alexsSheet();

    expect(DataSheet.safeParse(sheet).success).toBe(true);
    expect(fieldNamed(sheet, "email").label).toBe("Email address");
    for (const field of sheet.fields) expect(field.label).toMatch(/^[A-Z][A-Za-z ]+$/);
  });

  it("fills the contact details, employment answers and EEO defaults from the profile", () => {
    const sheet = alexsSheet();

    expect(fieldNamed(sheet, "fullName").value).toBe("Alex Rivera");
    expect(fieldNamed(sheet, "email").value).toBe("alex.rivera@example.com");
    expect(fieldNamed(sheet, "phone").value).toBe("+1 555 0100");
    expect(fieldNamed(sheet, "github").value).toBe("github.com/alexrivera-example");
    expect(fieldNamed(sheet, "noticePeriod").value).toBe("2 weeks");
    expect(fieldNamed(sheet, "currentEmployer").value).toBe("Northwind Logistics");
    expect(fieldNamed(sheet, "gender").value).toBe("Decline to self-identify");
  });

  it("splits the full name into first and last name", () => {
    const sheet = alexsSheet();

    expect(fieldNamed(sheet, "firstName").value).toBe("Alex");
    expect(fieldNamed(sheet, "lastName").value).toBe("Rivera");
  });

  it("uses the first and last word of a longer name, and an empty last name for a single name", () => {
    const longName = Profile.parse({ ...alexRiveraProfile(), contact: { ...alexRiveraProfile().contact, fullName: "Mary Jane Watson" } });
    const oneName = Profile.parse({ ...alexRiveraProfile(), contact: { ...alexRiveraProfile().contact, fullName: "Cher" } });

    expect(fieldNamed(alexsSheet("US", longName), "lastName").value).toBe("Watson");
    expect(fieldNamed(alexsSheet("US", oneName), "lastName").value).toBe("");
    expect(alexsSheet("US", oneName).resumeFileName).toBe("Cher - Resume.pdf");
  });

  it('names the resume file "First Last - Resume.pdf" and shows the short resume version', () => {
    const sheet = alexsSheet();

    expect(sheet.resumeFileName).toBe("Alex Rivera - Resume.pdf");
    expect(fieldNamed(sheet, "resumeFileName").value).toBe("Alex Rivera - Resume.pdf");
    expect(fieldNamed(sheet, "resumeVersion").value).toBe("r-abababab");
    expect(sheet.resumeVersion).toBe(RESUME_VERSION);
  });

  it("requires only the full name, email and phone", () => {
    const required = alexsSheet().fields.filter((field) => field.required).map((field) => field.key);

    expect(required).toEqual(["fullName", "email", "phone"]);
  });

  it("marks contact, expected salary, EEO and the file name as personal, and the rest as not", () => {
    const personal = alexsSheet().fields.filter((field) => field.personal).map((field) => field.key);

    expect(personal).toEqual([
      "fullName", "firstName", "lastName", "email", "phone", "location", "linkedin", "github", "portfolio",
      "expectedBase", "gender", "raceEthnicity", "veteranStatus", "disability", "resumeFileName",
    ]);
  });

  it("marks a value that is still TODO or empty as missing", () => {
    const sheet = alexsSheet();

    expect(fieldNamed(sheet, "expectedBase")).toMatchObject({ value: "TODO", missing: true });
    expect(fieldNamed(sheet, "linkedin")).toMatchObject({ value: "", missing: true });
    expect(fieldNamed(sheet, "email").missing).toBe(false);
  });

  it("builds a file name that is safe to save, whatever the name", () => {
    const profile = Profile.parse({ ...alexRiveraProfile(), contact: { ...alexRiveraProfile().contact, fullName: 'Alex Riv/e"ra' } });

    expect(alexsSheet("US", profile).resumeFileName).toBe("Alex Rivera - Resume.pdf");
  });
});

describe("work authorization by region", () => {
  const withIndiaAnswers = Profile.parse({
    ...alexRiveraProfile(),
    workAuthorization: {
      regions: {
        US: { authorized: true, requiresSponsorship: false, willingToRelocate: true },
        IN: { authorized: false, requiresSponsorship: true, willingToRelocate: "TODO" },
      },
    },
  });

  it("answers Yes and No from the job's region", () => {
    const sheet = alexsSheet("US");

    expect(fieldNamed(sheet, "workAuthorized").value).toBe("Yes");
    expect(fieldNamed(sheet, "requiresSponsorship").value).toBe("No");
    expect(fieldNamed(sheet, "willingToRelocate").value).toBe("Yes");
  });

  it("uses the region's own answers when the person has set them up", () => {
    const sheet = alexsSheet("IN", withIndiaAnswers);

    expect(fieldNamed(sheet, "workAuthorized").value).toBe("No");
    expect(fieldNamed(sheet, "requiresSponsorship").value).toBe("Yes");
    expect(fieldNamed(sheet, "willingToRelocate")).toMatchObject({ value: "TODO", missing: true });
    expect(sheet.region).toBe("IN");
  });

  it("falls back to the US answers for a region with none", () => {
    const sheet = alexsSheet("REMOTE");

    expect(fieldNamed(sheet, "workAuthorized").value).toBe("Yes");
    expect(sheet.region).toBe("REMOTE");
  });

  it("shows TODO when the person has no answers for the region or the US", () => {
    const sheet = alexsSheet("US", Profile.parse({}));

    expect(fieldNamed(sheet, "workAuthorized")).toMatchObject({ value: "TODO", missing: true });
  });
});

describe("requiredMissing", () => {
  it("is empty when the name, email and phone are filled in, even if other values are missing", () => {
    expect(requiredMissing(alexsSheet())).toEqual([]);
  });

  it("names every required field that is still TODO", () => {
    const sheet = alexsSheet("US", Profile.parse({}));

    expect(requiredMissing(sheet).map((field) => field.key)).toEqual(["fullName", "email", "phone"]);
  });
});

describe("hashDataSheet", () => {
  it("is the same for the same sheet, built twice", () => {
    expect(hashDataSheet(alexsSheet())).toBe(hashDataSheet(alexsSheet()));
    expect(hashDataSheet(alexsSheet())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any value on the sheet changes", () => {
    const newPhone = Profile.parse({ ...alexRiveraProfile(), contact: { ...alexRiveraProfile().contact, phone: "+1 555 0199" } });

    expect(hashDataSheet(alexsSheet("US", newPhone))).not.toBe(hashDataSheet(alexsSheet()));
  });

  it("changes when the resume version or the region changes", () => {
    const otherResume = buildDataSheet({ applicationId: "app-1", profile: alexRiveraProfile(), region: "US", resumeVersion: `r-${"cd".repeat(32)}` });

    expect(hashDataSheet(otherResume)).not.toBe(hashDataSheet(alexsSheet()));
    expect(hashDataSheet(alexsSheet("REMOTE"))).not.toBe(hashDataSheet(alexsSheet("US")));
  });
});

describe("placeholderDataSheet", () => {
  it("replaces every personal value with its {key} and leaves the rest", () => {
    const placeholders = placeholderDataSheet(alexsSheet());

    expect(fieldNamed(placeholders, "phone").value).toBe("{phone}");
    expect(fieldNamed(placeholders, "expectedBase").value).toBe("{expectedBase}");
    expect(fieldNamed(placeholders, "gender").value).toBe("{gender}");
    expect(fieldNamed(placeholders, "noticePeriod").value).toBe("2 weeks");
    expect(placeholders.resumeFileName).toBe("{resumeFileName}");
  });

  it("leaves no personal value anywhere in the sheet a run would see", () => {
    const text = JSON.stringify(placeholderDataSheet(alexsSheet()));

    for (const secret of ["Alex", "Rivera", "alex.rivera@example.com", "+1 555 0100", "Austin", "alexrivera-example"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("does not change the sheet it was given", () => {
    const sheet = alexsSheet();
    const before = hashDataSheet(sheet);

    placeholderDataSheet(sheet);

    expect(hashDataSheet(sheet)).toBe(before);
  });
});

describe("fillPlaceholders", () => {
  it("puts the real values back into text written with placeholders", () => {
    const answer = "I am {fullName}. Reach me at {email} or {phone}. I can start in {noticePeriod}.";

    expect(fillPlaceholders(answer, alexsSheet())).toBe(
      "I am Alex Rivera. Reach me at alex.rivera@example.com or +1 555 0100. I can start in 2 weeks.",
    );
  });

  it("round-trips: filling the placeholder form of every field gives back that field's value", () => {
    const sheet = alexsSheet();

    for (const field of placeholderDataSheet(sheet).fields) {
      const original = fieldNamed(sheet, field.key);
      if (original.missing) continue;
      expect(fillPlaceholders(field.value, sheet)).toBe(original.value);
    }
  });

  it("leaves a placeholder alone while its value is missing, so a gap looks like a gap", () => {
    expect(fillPlaceholders("I expect {expectedBase}.", alexsSheet())).toBe("I expect {expectedBase}.");
  });

  it("leaves braces that are not a field name alone", () => {
    expect(fillPlaceholders("const x = {value}; {constructor} {phone}", alexsSheet())).toBe(
      "const x = {value}; {constructor} +1 555 0100",
    );
  });
});
