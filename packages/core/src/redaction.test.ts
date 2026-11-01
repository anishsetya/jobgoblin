import { describe, expect, it } from "vitest";
import { redactContactDetails } from "./redaction";

// What the text of Alex Rivera's resume PDF looks like after extraction.
const ALEX_RESUME_TEXT = `Alex Rivera
alex.rivera@example.com | +1 555 0100 | Austin, TX | github.com/alexrivera-example
Backend engineer who builds reliable APIs and the platforms they run on

EXPERIENCE
Software Engineer, Northwind Logistics, Austin, TX    2024-06 - Present
- Built a shipment-tracking API in Python and PostgreSQL that serves 2M requests a day
- Cut p95 latency of the orders service 40% by adding a Redis read-through cache

EDUCATION
B.S. Computer Science, State University, Austin, TX    2020-08 - 2024-05

SKILLS
Python, TypeScript, Go, PostgreSQL, Redis, Docker, Kubernetes, AWS, React, Terraform
`;

describe("redactContactDetails: a normal resume", () => {
  const { redacted, found } = redactContactDetails(ALEX_RESUME_TEXT);

  it("removes the name, email, phone and link", () => {
    for (const secret of ["Alex Rivera", "alex.rivera@example.com", "+1 555 0100", "github.com/alexrivera-example"]) {
      expect(redacted).not.toContain(secret);
    }
  });

  it("returns what it found, for the contact section", () => {
    expect(found).toEqual({
      fullName: "Alex Rivera",
      email: "alex.rivera@example.com",
      phone: "+1 555 0100",
      location: "Austin, TX",
      github: "github.com/alexrivera-example",
    });
  });

  it("removes the header block's location line but keeps the places jobs were in", () => {
    expect(redacted).toContain("Software Engineer, Northwind Logistics, Austin, TX");
    expect(redacted.split("\n")[0]).not.toContain("Austin");
  });

  it("keeps a summary sentence written before the first heading", () => {
    expect(redacted).toContain("Backend engineer who builds reliable APIs and the platforms they run on");
  });

  it("keeps every section and all the content below the header", () => {
    expect(redacted).toContain("EXPERIENCE");
    expect(redacted).toContain("Built a shipment-tracking API in Python and PostgreSQL that serves 2M requests a day");
    expect(redacted).toContain("2020-08 - 2024-05");
    expect(redacted).toContain("Python, TypeScript, Go");
  });
});

describe("redactContactDetails: details anywhere in the text", () => {
  it("replaces an email, phone number, link and the name found below the header with placeholders", () => {
    const text = `Alex Rivera
alex@example.com

EXPERIENCE
Built tools. Portfolio at https://alexrivera.dev/work, write to alex@example.com or call (555) 010-0100.
References: Alex Rivera, +91 98765 43210, www.linkedin.com/in/alexrivera.`;

    const { redacted, found } = redactContactDetails(text);

    expect(redacted).toContain("Portfolio at {link}, write to {email} or call {phone}.");
    expect(redacted).toContain("References: {fullName}, {phone}, {link}.");
    expect(redacted).not.toMatch(/alexrivera|alex@|555|98765/i);
    expect(found.linkedin).toBe("www.linkedin.com/in/alexrivera");
    expect(found.portfolio).toBe("https://alexrivera.dev/work");
  });

  it("reports a detail that appears only below the header", () => {
    const { found } = redactContactDetails("Alex Rivera\n\nEXPERIENCE\nReach me at alex@example.com.");

    expect(found.email).toBe("alex@example.com");
  });

  it.each(["(555) 010-0100", "555-010-0100", "555.010.0100", "5550100100", "+44 20 7946 0958"])(
    "recognises the phone number %s",
    (phone) => {
      const { redacted, found } = redactContactDetails(`Name Person\n\nEXPERIENCE\nCall ${phone} today`);

      expect(redacted).toBe("EXPERIENCE\nCall {phone} today");
      expect(found.phone).toBe(phone);
    },
  );

  it("does not mistake dates, years or version numbers for phone numbers", () => {
    const text = "EXPERIENCE\nSoftware Engineer 2023-05 - 2024-08 and Jan 2020 - Mar 2022\nServed 2,000,000 users on Python 3.11 in 2024";

    expect(redactContactDetails(text).redacted).toBe(text);
  });

  it("does not mistake technology names such as ASP.NET and Node.js for links", () => {
    const text = "SKILLS\nASP.NET, Node.js, Vue.js, Next.js";

    expect(redactContactDetails(text).redacted).toBe(text);
  });

  it("does not report the domain of an email address as a link", () => {
    const { found } = redactContactDetails("Alex Rivera\nalex.rivera@example.com\n\nSKILLS\nGo");

    expect(found.portfolio).toBeUndefined();
  });
});

describe("redactContactDetails: other shapes of header", () => {
  it("removes a header that has name and contact details on separate lines", () => {
    const text = "Priya Natarajan\nBengaluru, India\npriya@example.com\n+91 98765 43210\nlinkedin.com/in/priya-n\n\nSummary\nBackend engineer.";

    const { redacted, found } = redactContactDetails(text);

    expect(redacted).toBe("Summary\nBackend engineer.");
    expect(found).toEqual({
      fullName: "Priya Natarajan",
      location: "Bengaluru, India",
      email: "priya@example.com",
      phone: "+91 98765 43210",
      linkedin: "linkedin.com/in/priya-n",
    });
  });

  it("takes the first three lines as the header when there is no section heading", () => {
    const text = "Alex Rivera\nalex@example.com\nAustin, TX\nBuilt reliable APIs in Python for several years at one company.";

    const { redacted, found } = redactContactDetails(text);

    expect(redacted).toBe("Built reliable APIs in Python for several years at one company.");
    expect(found.fullName).toBe("Alex Rivera");
  });

  it("recognises headings in any case, with a colon, and the first heading ends the header", () => {
    const text = "Alex Rivera\nalex@example.com\n\nWork Experience:\nAlex Rivera worked here.\nSkills\nGo";

    const { redacted } = redactContactDetails(text);

    expect(redacted).toBe("Work Experience:\n{fullName} worked here.\nSkills\nGo");
  });

  it("handles Windows line endings and empty text", () => {
    expect(redactContactDetails("Alex Rivera\r\nalex@example.com\r\n\r\nSkills\r\nGo").redacted).toBe("Skills\nGo");
    expect(redactContactDetails("")).toEqual({ redacted: "", found: {} });
  });

  it("does not take a document title for a name", () => {
    const { found } = redactContactDetails("Resume\nAlex Rivera\nalex@example.com\n\nSkills\nGo");

    expect(found.fullName).toBe("Alex Rivera");
  });
});

// What a LinkedIn "Save to PDF" export looks like after extraction: the sidebar comes first, then the name.
const LINKEDIN_EXPORT_TEXT = `Contact
alex.rivera@example.com
www.linkedin.com/in/alexrivera (LinkedIn)
Top Skills
TypeScript
PostgreSQL
Distributed Systems
Languages
English (Native or Bilingual)
Certifications
AWS Certified Developer
Alex Rivera
Software Engineer at Northwind Logistics
Austin, Texas, United States
Summary
Backend engineer who builds reliable APIs.
Experience
Northwind Logistics
Software Engineer
June 2024 - Present
Alex Rivera built the shipment-tracking API.
Education
State University`;

describe("redactContactDetails: a LinkedIn export", () => {
  const { redacted, found } = redactContactDetails(LINKEDIN_EXPORT_TEXT);

  it("finds the person's name after the sidebar, not the word Contact", () => {
    expect(found.fullName).toBe("Alex Rivera");
    expect(found.email).toBe("alex.rivera@example.com");
    expect(found.linkedin).toBe("www.linkedin.com/in/alexrivera");
    expect(found.location).toBe("Austin, Texas, United States");
  });

  it("removes the name and contact details everywhere, and keeps the sections from Summary on", () => {
    expect(redacted).not.toMatch(/Rivera|alex\.rivera@|linkedin\.com/i);
    expect(redacted).toContain("{fullName} built the shipment-tracking API.");
    expect(redacted).toContain("Summary\nBackend engineer who builds reliable APIs.\nExperience");
  });
});
