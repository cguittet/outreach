import { describe, expect, it } from "vitest";
import { addBusinessDays, normalizeLinkedInUrl, renderTemplate } from "./index";

describe("normalizeLinkedInUrl", () => {
  it("removes tracking and trailing paths", () => {
    expect(normalizeLinkedInUrl("https://linkedin.com/in/jane-doe/?trk=abc"))
      .toBe("https://www.linkedin.com/in/jane-doe");
  });

  it("rejects non-profile URLs", () => {
    expect(() => normalizeLinkedInUrl("https://linkedin.com/company/trucea")).toThrow();
  });
});

describe("addBusinessDays", () => {
  it("moves Friday plus two business days to Tuesday at the same local time", () => {
    const due = addBusinessDays("2026-08-07T14:00:00.000Z", 2, "America/New_York");
    expect(due.toISOString()).toBe("2026-08-11T14:00:00.000Z");
  });
});

describe("renderTemplate", () => {
  it("fills supported variables", () => {
    expect(renderTemplate("Hi {{first_name}} — how is {{company}}?", { name: "Jane Doe", company: "Acme" }))
      .toBe("Hi Jane — how is Acme?");
  });
});
