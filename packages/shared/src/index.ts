import { DateTime } from "luxon";
import { z } from "zod";

export const connectionStatuses = ["not_connected", "pending", "connected"] as const;
export const workflowStatuses = ["new", "active", "engaged", "paused", "no_response", "closed"] as const;
export const trackingStatuses = ["open", "paused", "closed"] as const;
export const workflowTriggers = ["entry", "reply", "no_reply"] as const;
export const companySizes = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
  "Unknown",
] as const;

export type ConnectionStatus = (typeof connectionStatuses)[number];
export type WorkflowStatus = (typeof workflowStatuses)[number];
export type TrackingStatus = (typeof trackingStatuses)[number];
export type CompanySize = (typeof companySizes)[number];

export const mutualContactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
});

export const prospectInputSchema = z.object({
  linkedinUrl: z.string().trim().url(),
  name: z.string().trim().min(1).max(160),
  jobTitle: z.string().trim().max(200).default(""),
  company: z.string().trim().max(200).default(""),
  companySize: z.enum(companySizes).default("Unknown"),
  connectionStatus: z.enum(connectionStatuses).default("not_connected"),
  notes: z.string().trim().max(5000).default(""),
  mutualContacts: z.array(mutualContactSchema).max(50).default([]),
});

export const prospectPatchSchema = prospectInputSchema.partial().extend({
  workflowStatus: z.enum(workflowStatuses).optional(),
  trackingStatus: z.enum(trackingStatuses).optional(),
});

export const activityInputSchema = z.object({
  type: z.enum([
    "connection_request_sent",
    "message_sent",
    "reply_received",
    "reply_sent",
    "status_changed",
    "note_added",
    "task_completed",
    "stage_changed",
  ]),
  content: z.string().trim().max(5000).optional().default(""),
  scheduledActionId: z.string().uuid().optional(),
});

export const workflowStepSchema = z.object({
  id: z.string().uuid().optional(),
  stepOrder: z.number().int().min(1).max(20),
  kind: z.enum(["message", "follow_up"]),
  trigger: z.enum(workflowTriggers),
  delayBusinessDays: z.number().int().min(0).max(60),
  name: z.string().trim().min(1).max(100),
  template: z.string().trim().min(1).max(5000),
});

export const lifecycleStageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  stageOrder: z.number().int().min(1).max(50),
  steps: z.array(workflowStepSchema.omit({ stepOrder: true }).extend({ stepOrder: z.number().int().min(1).max(20) })).max(22),
}).superRefine((stage, context) => {
  for (const trigger of ["entry", "reply"] as const) {
    if (stage.steps.filter((step) => step.trigger === trigger).length > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: `Only one ${trigger} message is allowed`, path: ["steps"] });
  }
  const orders = stage.steps.filter((step) => step.trigger === "no_reply").map((step) => step.stepOrder);
  if (new Set(orders).size !== orders.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Follow-up order must be unique", path: ["steps"] });
});

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  finalWaitBusinessDays: z.number().int().min(1).max(60).default(5),
  stages: z.array(lifecycleStageSchema).min(1).max(50),
});

export const prospectListQuerySchema = z.object({
  search: z.string().trim().max(200).default(""),
  connection: z.enum(["", ...connectionStatuses]).default(""),
  stage: z.union([z.literal(""), z.string().uuid()]).default(""),
  sort: z.enum(["prospect", "connection", "stage", "createdAt", "lastInteractedAt", "nextAction"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export const stageTransitionSchema = z.object({
  stageId: z.string().uuid(),
  reason: z.string().trim().max(100).default("manual"),
});

export const settingsPatchSchema = z.object({
  timezone: z.string().trim().optional(),
  dailyProspectGoal: z.number().int().min(0).max(1000).optional(),
});

export const kpiQuerySchema = z.object({
  granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  view: z.enum(["entries", "totals"]).default("entries"),
  metric: z.union([z.literal("added"), z.string().uuid()]).default("added"),
});

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(100).default("Chrome extension"),
});

export function normalizeLinkedInUrl(value: string): string {
  const url = new URL(value.trim());
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "linkedin.com" || !url.pathname.toLowerCase().startsWith("/in/")) {
    throw new Error("Enter a LinkedIn profile URL such as linkedin.com/in/name");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments[0]?.toLowerCase() !== "in") {
    throw new Error("Enter a valid LinkedIn profile URL");
  }
  return `https://www.linkedin.com/in/${segments[1]}`;
}

export function addBusinessDays(isoDate: string | Date, days: number, timezone: string): Date {
  let cursor = typeof isoDate === "string"
    ? DateTime.fromISO(isoDate, { zone: "utc" }).setZone(timezone)
    : DateTime.fromJSDate(isoDate, { zone: "utc" }).setZone(timezone);
  let remaining = days;
  while (remaining > 0) {
    cursor = cursor.plus({ days: 1 });
    if (cursor.weekday <= 5) remaining -= 1;
  }
  return cursor.toUTC().toJSDate();
}

export function localDayBounds(isoDate: string | Date, timezone: string): { start: Date; end: Date; isBusinessDay: boolean } {
  const value = typeof isoDate === "string" ? DateTime.fromISO(isoDate, { zone: "utc" }) : DateTime.fromJSDate(isoDate, { zone: "utc" });
  const local = value.setZone(timezone);
  return { start: local.startOf("day").toUTC().toJSDate(), end: local.endOf("day").toUTC().toJSDate(), isBusinessDay: local.weekday <= 5 };
}

export interface TimeBucket { start: Date; end: Date; label: string }

export function buildTimeBuckets(isoDate: string | Date, granularity: "daily" | "weekly" | "monthly", timezone: string, previous = false): TimeBucket[] {
  const value = typeof isoDate === "string" ? DateTime.fromISO(isoDate, { zone: "utc" }) : DateTime.fromJSDate(isoDate, { zone: "utc" });
  const local = value.setZone(timezone);
  const count = granularity === "daily" ? 10 : 6;
  const unit = granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";
  const currentEnd = local.endOf(unit);
  const windowEnd = previous ? currentEnd.minus({ [unit + "s"]: count }) : currentEnd;
  return Array.from({ length: count }, (_, index) => {
    const offset = count - index - 1;
    const cursor = windowEnd.minus({ [unit + "s"]: offset });
    const start = cursor.startOf(unit);
    const end = cursor.endOf(unit);
    const label = granularity === "daily" ? start.toFormat("MMM d") : granularity === "weekly" ? `Wk ${start.toFormat("MMM d")}` : start.toFormat("MMM");
    return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate(), label };
  });
}

export function renderTemplate(template: string, prospect: { name: string; company?: string | null; jobTitle?: string | null }): string {
  const firstName = prospect.name.trim().split(/\s+/)[0] ?? prospect.name;
  const values: Record<string, string> = {
    first_name: firstName,
    name: prospect.name,
    company: prospect.company ?? "",
    job_title: prospect.jobTitle ?? "",
  };
  return template.replace(/{{\s*(first_name|name|company|job_title)\s*}}/g, (_, key: string) => values[key] ?? "");
}

export type ProspectInput = z.infer<typeof prospectInputSchema>;
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type WorkflowInput = z.infer<typeof workflowInputSchema>;
