import { DateTime } from "luxon";
import { z } from "zod";

export const connectionStatuses = ["not_connected", "pending", "connected"] as const;
export const workflowStatuses = ["new", "active", "engaged", "paused", "no_response", "closed"] as const;
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
  ]),
  content: z.string().trim().max(5000).optional().default(""),
  scheduledActionId: z.string().uuid().optional(),
});

export const workflowStepSchema = z.object({
  id: z.string().uuid().optional(),
  stepOrder: z.number().int().min(1).max(20),
  kind: z.enum(["message", "follow_up"]),
  delayBusinessDays: z.number().int().min(0).max(60),
  name: z.string().trim().min(1).max(100),
  template: z.string().trim().min(1).max(5000),
});

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  finalWaitBusinessDays: z.number().int().min(1).max(60),
  steps: z.array(workflowStepSchema).min(1).max(20),
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
