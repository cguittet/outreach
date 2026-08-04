import { and, asc, desc, eq } from "drizzle-orm";
import { addBusinessDays, renderTemplate, type ActivityInput, type ProspectInput } from "@trucea/shared";
import { getDb } from "./db";
import {
  activities,
  mutualContacts,
  prospects,
  scheduledActions,
  userSettings,
  workflows,
  workflowSteps,
} from "../../../database/schema/schema";

const defaultSteps = [
  { stepOrder: 1, kind: "message", name: "First message", delayBusinessDays: 0, template: "Hi {{first_name}}, great to connect. I’d love to learn how {{company}} is approaching this today." },
  { stepOrder: 2, kind: "follow_up", name: "Follow-up", delayBusinessDays: 3, template: "Hi {{first_name}}, just following up in case my note got buried. Would a quick conversation be useful?" },
  { stepOrder: 3, kind: "follow_up", name: "Final follow-up", delayBusinessDays: 5, template: "Hi {{first_name}}, I’ll close the loop for now. Happy to reconnect if this becomes relevant for {{company}}." },
] as const;

export async function ensureDefaultWorkflow(ownerId: string) {
  const db = getDb();
  let workflow = (await db.select().from(workflows).where(and(eq(workflows.ownerId, ownerId), eq(workflows.isDefault, 1))).limit(1))[0];
  if (!workflow) {
    [workflow] = await db.insert(workflows).values({ ownerId, name: "Trucea outreach", isDefault: 1 }).returning();
    if (!workflow) throw new Error("Unable to create workflow");
    await db.insert(workflowSteps).values(defaultSteps.map((step) => ({ ...step, ownerId, workflowId: workflow!.id })));
  }
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, workflow.id)).orderBy(asc(workflowSteps.stepOrder));
  return { ...workflow, steps };
}

export async function getTimezone(ownerId: string): Promise<string> {
  const settings = (await getDb().select().from(userSettings).where(eq(userSettings.ownerId, ownerId)).limit(1))[0];
  return settings?.timezone ?? "America/New_York";
}

async function cancelPending(ownerId: string, prospectId: string) {
  await getDb().update(scheduledActions).set({ status: "cancelled", completedAt: new Date() })
    .where(and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.prospectId, prospectId), eq(scheduledActions.status, "pending")));
}

async function schedule(ownerId: string, prospectId: string, actionType: string, dueAt: Date, workflowStepId?: string) {
  await cancelPending(ownerId, prospectId);
  const [action] = await getDb().insert(scheduledActions).values({ ownerId, prospectId, actionType, dueAt, workflowStepId }).returning();
  return action;
}

export async function upsertProspect(ownerId: string, input: ProspectInput & { linkedinUrl: string }) {
  const db = getDb();
  const [prospect] = await db.insert(prospects).values({
    ownerId,
    linkedinUrl: input.linkedinUrl,
    name: input.name,
    jobTitle: input.jobTitle,
    company: input.company,
    companySize: input.companySize,
    connectionStatus: input.connectionStatus,
    workflowStatus: input.connectionStatus === "connected" ? "active" : "new",
    notes: input.notes,
  }).onConflictDoUpdate({
    target: [prospects.ownerId, prospects.linkedinUrl],
    set: {
      name: input.name,
      jobTitle: input.jobTitle,
      company: input.company,
      companySize: input.companySize,
      connectionStatus: input.connectionStatus,
      notes: input.notes,
      updatedAt: new Date(),
    },
  }).returning();
  if (!prospect) throw new Error("Unable to save prospect");
  await db.delete(mutualContacts).where(and(eq(mutualContacts.ownerId, ownerId), eq(mutualContacts.prospectId, prospect.id)));
  if (input.mutualContacts.length) {
    await db.insert(mutualContacts).values(input.mutualContacts.map((contact) => ({
      ownerId,
      prospectId: prospect.id,
      name: contact.name,
      linkedinUrl: contact.linkedinUrl || null,
    })));
  }
  if (input.connectionStatus === "connected") await scheduleFirstMessage(ownerId, prospect.id);
  return prospect;
}

export async function scheduleFirstMessage(ownerId: string, prospectId: string) {
  const workflow = await ensureDefaultWorkflow(ownerId);
  const first = workflow.steps[0];
  if (!first) return;
  const existingSent = await getDb().select({ id: activities.id }).from(activities)
    .where(and(eq(activities.ownerId, ownerId), eq(activities.prospectId, prospectId), eq(activities.type, "message_sent"))).limit(1);
  if (!existingSent.length) await schedule(ownerId, prospectId, "send_message", new Date(), first.id);
}

export async function recordActivity(ownerId: string, prospectId: string, input: ActivityInput) {
  const db = getDb();
  const prospect = (await db.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId))).limit(1))[0];
  if (!prospect) throw new Error("Prospect not found");
  const pending = (await db.select().from(scheduledActions).where(and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.prospectId, prospectId), eq(scheduledActions.status, "pending"))).limit(1))[0];

  await db.insert(activities).values({ ownerId, prospectId, type: input.type, content: input.content, metadata: input.scheduledActionId ? { scheduledActionId: input.scheduledActionId } : {} });

  if (input.type === "connection_request_sent") {
    await cancelPending(ownerId, prospectId);
    await db.update(prospects).set({ connectionStatus: "pending", workflowStatus: "active", updatedAt: new Date() }).where(eq(prospects.id, prospectId));
  } else if (input.type === "reply_received") {
    await db.update(prospects).set({ workflowStatus: "engaged", updatedAt: new Date() }).where(eq(prospects.id, prospectId));
    await schedule(ownerId, prospectId, "reply_needed", new Date());
  } else if (input.type === "reply_sent") {
    await cancelPending(ownerId, prospectId);
    await db.update(prospects).set({ workflowStatus: "engaged", updatedAt: new Date() }).where(eq(prospects.id, prospectId));
  } else if (input.type === "message_sent") {
    if (pending) await db.update(scheduledActions).set({ status: "completed", completedAt: new Date() }).where(eq(scheduledActions.id, pending.id));
    const workflow = await ensureDefaultWorkflow(ownerId);
    const sentStep = workflow.steps.find((step) => step.id === pending?.workflowStepId) ?? workflow.steps[0];
    const next = workflow.steps.find((step) => step.stepOrder === (sentStep?.stepOrder ?? 0) + 1);
    const timezone = await getTimezone(ownerId);
    if (next) {
      await schedule(ownerId, prospectId, "send_message", addBusinessDays(new Date(), next.delayBusinessDays, timezone), next.id);
    } else {
      await schedule(ownerId, prospectId, "close_no_response", addBusinessDays(new Date(), workflow.finalWaitBusinessDays, timezone));
    }
    await db.update(prospects).set({ workflowStatus: "active", updatedAt: new Date() }).where(eq(prospects.id, prospectId));
  }
  return getProspect(ownerId, prospectId);
}

export async function completeAction(ownerId: string, actionId: string) {
  const db = getDb();
  const action = (await db.select().from(scheduledActions).where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.ownerId, ownerId))).limit(1))[0];
  if (!action) throw new Error("Action not found");
  await db.update(scheduledActions).set({ status: "completed", completedAt: new Date() }).where(eq(scheduledActions.id, action.id));
  if (action.actionType === "close_no_response") {
    await db.update(prospects).set({ workflowStatus: "no_response", updatedAt: new Date() }).where(eq(prospects.id, action.prospectId));
  }
}

export async function rescheduleAction(ownerId: string, actionId: string, dueAt: Date) {
  const [action] = await getDb().update(scheduledActions).set({ dueAt })
    .where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending")))
    .returning();
  if (!action) throw new Error("Action not found");
  return action;
}

export async function skipAction(ownerId: string, actionId: string) {
  const db = getDb();
  const action = (await db.select().from(scheduledActions).where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"))).limit(1))[0];
  if (!action) throw new Error("Action not found");
  await db.update(scheduledActions).set({ status: "completed", completedAt: new Date() }).where(eq(scheduledActions.id, action.id));
  await db.insert(activities).values({ ownerId, prospectId: action.prospectId, type: "task_completed", content: "Skipped scheduled step", metadata: { actionId } });
  if (action.actionType === "send_message") {
    const workflow = await ensureDefaultWorkflow(ownerId);
    const current = workflow.steps.find((step) => step.id === action.workflowStepId);
    const next = workflow.steps.find((step) => step.stepOrder === (current?.stepOrder ?? 0) + 1);
    const timezone = await getTimezone(ownerId);
    if (next) await schedule(ownerId, action.prospectId, "send_message", addBusinessDays(new Date(), next.delayBusinessDays, timezone), next.id);
    else await schedule(ownerId, action.prospectId, "close_no_response", addBusinessDays(new Date(), workflow.finalWaitBusinessDays, timezone));
  }
}

export async function getProspect(ownerId: string, id: string) {
  const db = getDb();
  const prospect = (await db.select().from(prospects).where(and(eq(prospects.id, id), eq(prospects.ownerId, ownerId))).limit(1))[0];
  if (!prospect) return undefined;
  const [contacts, history, nextActions] = await Promise.all([
    db.select().from(mutualContacts).where(eq(mutualContacts.prospectId, id)).orderBy(asc(mutualContacts.name)),
    db.select().from(activities).where(eq(activities.prospectId, id)).orderBy(desc(activities.occurredAt)),
    db.select({ action: scheduledActions, step: workflowSteps }).from(scheduledActions)
      .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
      .where(and(eq(scheduledActions.prospectId, id), eq(scheduledActions.status, "pending"))).limit(1),
  ]);
  const next = nextActions[0];
  return {
    ...prospect,
    mutualContacts: contacts,
    activities: history,
    nextAction: next ? {
      ...next.action,
      label: next.action.actionType === "reply_needed" ? "Reply needed" : next.action.actionType === "close_no_response" ? "Close as no response" : next.step?.name ?? "Send message",
      message: next.step ? renderTemplate(next.step.template, prospect) : "",
      step: next.step,
    } : null,
  };
}
