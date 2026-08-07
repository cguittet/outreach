import { describe, expect, it } from "vitest";
import { addBusinessDays, buildTimeBuckets, kpiQuerySchema, localDayBounds, normalizeLinkedInUrl, prospectListQuerySchema, renderTemplate, settingsPatchSchema, workflowInputSchema } from "./index";

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

describe("timezone windows", () => {
  it("uses the owner's local day and business-day rule", () => {
    const bounds = localDayBounds("2026-08-08T02:00:00.000Z", "America/New_York");
    expect(bounds.isBusinessDay).toBe(true);
    expect(bounds.start.toISOString()).toBe("2026-08-07T04:00:00.000Z");
  });

  it("builds ten daily buckets and six weekly/monthly buckets", () => {
    expect(buildTimeBuckets("2026-08-07T12:00:00Z", "daily", "America/New_York")).toHaveLength(10);
    expect(buildTimeBuckets("2026-08-07T12:00:00Z", "weekly", "America/New_York")).toHaveLength(6);
    expect(buildTimeBuckets("2026-08-07T12:00:00Z", "monthly", "America/New_York", true)).toHaveLength(6);
  });

  it("uses Monday-to-Sunday weekly buckets", () => {
    const bucket = buildTimeBuckets("2026-08-07T12:00:00Z", "weekly", "America/New_York").at(-1)!;
    expect(bucket.start.toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(bucket.end.toISOString()).toBe("2026-08-10T03:59:59.999Z");
  });
});

describe("pipeline validation", () => {
  it("defaults prospect sorting and KPI controls", () => {
    expect(prospectListQuerySchema.parse({}).sort).toBe("createdAt");
    expect(kpiQuerySchema.parse({})).toMatchObject({ granularity: "daily", view: "entries", metric: "added" });
  });

  it("validates daily prospect goals", () => {
    expect(settingsPatchSchema.parse({ dailyProspectGoal: 5 }).dailyProspectGoal).toBe(5);
    expect(() => settingsPatchSchema.parse({ dailyProspectGoal: -1 })).toThrow();
  });

  it("rejects duplicate reply branches", () => {
    const step = { stepOrder: 1, kind: "message" as const, trigger: "reply" as const, delayBusinessDays: 0, name: "Reply", template: "Thanks" };
    expect(() => workflowInputSchema.parse({ name: "Test", finalWaitBusinessDays: 5, stages: [{ name: "Active", stageOrder: 1, steps: [step, step] }] })).toThrow();
  });
});
