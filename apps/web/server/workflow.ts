import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { addBusinessDays, renderTemplate, type ActivityInput, type ProspectInput } from "@trucea/shared";
import { getDb } from "./db";
import {
  activities,
  lifecycleStages,
  mutualContacts,
  prospectStageHistory,
  prospects,
  scheduledActions,
  userSettings,
  workflows,
  workflowSteps,
} from "../../../database/schema/schema";

const defaultStages = [
  ["New", "new"], ["Active", "active"], ["Engaged", "engaged"], ["Meeting Booked", "meeting_booked"],
  ["Meeting Attended", "meeting_attended"], ["Customer", "customer"], ["Churned", "churned"],
] as const;
const defaultActiveSteps = [
  { trigger: "entry", stepOrder: 1, kind: "message", name: "First message", delayBusinessDays: 0, template: "Hi {{first_name}}, great to connect. I’d love to learn how {{company}} is approaching this today." },
  { trigger: "reply", stepOrder: 1, kind: "message", name: "Reply message", delayBusinessDays: 0, template: "Thanks for getting back to me, {{first_name}}. Would you be open to a quick conversation?" },
  { trigger: "no_reply", stepOrder: 1, kind: "follow_up", name: "Follow-up", delayBusinessDays: 3, template: "Hi {{first_name}}, just following up in case my note got buried. Would a quick conversation be useful?" },
  { trigger: "no_reply", stepOrder: 2, kind: "follow_up", name: "Final follow-up", delayBusinessDays: 5, template: "Hi {{first_name}}, I’ll close the loop for now. Happy to reconnect if this becomes relevant for {{company}}." },
] as const;

export async function ensureLifecycleStages(ownerId: string) {
  const db = getDb();
  let stages = await db.select().from(lifecycleStages)
    .where(and(eq(lifecycleStages.ownerId, ownerId), isNull(lifecycleStages.archivedAt)))
    .orderBy(asc(lifecycleStages.stageOrder));
  if (!stages.length) {
    stages = await db.insert(lifecycleStages).values(defaultStages.map(([name, stageKey], index) => ({ ownerId, name, stageKey, stageOrder: index + 1 }))).returning();
    stages.sort((a, b) => a.stageOrder - b.stageOrder);
  }
  return stages;
}

export async function ensureDefaultWorkflow(ownerId: string) {
  const db = getDb();
  const stages = await ensureLifecycleStages(ownerId);
  let workflow = (await db.select().from(workflows).where(and(eq(workflows.ownerId, ownerId), eq(workflows.isDefault, 1))).limit(1))[0];
  if (!workflow) {
    [workflow] = await db.insert(workflows).values({ ownerId, name: "Trucea outreach", isDefault: 1 }).returning();
    if (!workflow) throw new Error("Unable to create workflow");
  }
  let steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, workflow.id)).orderBy(asc(workflowSteps.stepOrder));
  if (!steps.length) {
    const active = stages.find((stage) => stage.stageKey === "active") ?? stages[1] ?? stages[0];
    if (active) steps = await db.insert(workflowSteps).values(defaultActiveSteps.map((step) => ({ ...step, ownerId, workflowId: workflow!.id, stageId: active.id }))).returning();
  }
  return {
    ...workflow,
    stages: stages.map((stage) => ({ ...stage, steps: steps.filter((step) => step.stageId === stage.id).sort((a, b) => a.stepOrder - b.stepOrder) })),
  };
}

export async function getTimezone(ownerId: string): Promise<string> {
  const settings = (await getDb().select().from(userSettings).where(eq(userSettings.ownerId, ownerId)).limit(1))[0];
  return settings?.timezone ?? "America/New_York";
}

export async function cancelPending(ownerId: string, prospectId: string) {
  await getDb().update(scheduledActions).set({ status: "cancelled", completedAt: new Date() })
    .where(and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.prospectId, prospectId), eq(scheduledActions.status, "pending")));
}

async function schedule(ownerId: string, prospectId: string, actionType: string, dueAt: Date, workflowStepId?: string) {
  await cancelPending(ownerId, prospectId);
  const [action] = await getDb().insert(scheduledActions).values({ ownerId, prospectId, actionType, dueAt, workflowStepId }).returning();
  return action;
}

async function scheduleStageEntry(ownerId: string, prospectId: string, stageId: string) {
  const workflow = await ensureDefaultWorkflow(ownerId);
  const stage = workflow.stages.find((item) => item.id === stageId);
  const entry = stage?.steps.find((step) => step.trigger === "entry");
  if (entry) return schedule(ownerId, prospectId, "send_message", new Date(), entry.id);
  return undefined;
}

async function scheduleStageAdvance(ownerId: string, prospectId: string, stageId: string) {
  const workflow = await ensureDefaultWorkflow(ownerId);
  const index = workflow.stages.findIndex((stage) => stage.id === stageId);
  if (index >= 0 && workflow.stages[index + 1]) return schedule(ownerId, prospectId, "advance_stage", new Date());
  await cancelPending(ownerId, prospectId);
  return undefined;
}

export async function transitionProspect(ownerId: string, prospectId: string, toStageId: string, reason = "manual") {
  const db = getDb();
  const [prospect, stage] = await Promise.all([
    db.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId))).limit(1).then((rows) => rows[0]),
    db.select().from(lifecycleStages).where(and(eq(lifecycleStages.id, toStageId), eq(lifecycleStages.ownerId, ownerId), isNull(lifecycleStages.archivedAt))).limit(1).then((rows) => rows[0]),
  ]);
  if (!prospect) throw new Error("Prospect not found");
  if (!stage) throw new Error("Lifecycle stage not found");
  if (prospect.lifecycleStageId === stage.id) return getProspect(ownerId, prospectId);
  await cancelPending(ownerId, prospectId);
  await db.transaction(async (tx) => {
    await tx.update(prospects).set({ lifecycleStageId: stage.id, workflowStatus: stage.name.toLowerCase() === "new" ? "new" : stage.name.toLowerCase() === "engaged" ? "engaged" : "active", updatedAt: new Date() })
      .where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId)));
    await tx.insert(prospectStageHistory).values({ ownerId, prospectId, fromStageId: prospect.lifecycleStageId, toStageId: stage.id, reason });
    await tx.insert(activities).values({ ownerId, prospectId, type: "stage_changed", content: `Moved to ${stage.name}`, metadata: { fromStageId: prospect.lifecycleStageId, toStageId: stage.id, reason } });
  });
  if (prospect.trackingStatus === "open") await scheduleStageEntry(ownerId, prospectId, stage.id);
  return getProspect(ownerId, prospectId);
}

export async function handleConnectionAccepted(ownerId: string, prospectId: string) {
  const db = getDb();
  const prospect = (await db.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId))).limit(1))[0];
  if (!prospect) return;
  const stages = await ensureLifecycleStages(ownerId);
  const currentIndex = stages.findIndex((stage) => stage.id === prospect.lifecycleStageId);
  if (currentIndex === 0 && stages[1]) await transitionProspect(ownerId, prospectId, stages[1].id, "connection_accepted");
  else if (prospect.trackingStatus === "open" && prospect.lifecycleStageId) await scheduleStageEntry(ownerId, prospectId, prospect.lifecycleStageId);
}

export async function updateTrackingStatus(ownerId: string, prospectId: string, trackingStatus: "open" | "paused" | "closed") {
  const db = getDb();
  const previous = (await db.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId))).limit(1))[0];
  if (!previous) throw new Error("Prospect not found");
  const [prospect] = await db.update(prospects).set({ trackingStatus, workflowStatus: trackingStatus === "paused" ? "paused" : trackingStatus === "closed" ? "closed" : "active", updatedAt: new Date() })
    .where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId))).returning();
  if (!prospect) throw new Error("Prospect not found");
  if (trackingStatus === "closed") await cancelPending(ownerId, prospectId);
  if (trackingStatus === "open") {
    const pending = await db.select({ id: scheduledActions.id }).from(scheduledActions).where(and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.prospectId, prospectId), eq(scheduledActions.status, "pending"))).limit(1);
    if (!pending.length) await scheduleStageEntry(ownerId, prospectId, prospect.lifecycleStageId);
  }
  return getProspect(ownerId, prospectId);
}

export async function upsertProspect(ownerId: string, input: ProspectInput & { linkedinUrl: string }) {
  const db = getDb();
  const existing = (await db.select().from(prospects).where(and(eq(prospects.ownerId, ownerId), eq(prospects.linkedinUrl, input.linkedinUrl))).limit(1))[0];
  const firstStage = (await ensureLifecycleStages(ownerId))[0];
  if (!firstStage) throw new Error("Unable to create the first lifecycle stage");
  const [prospect] = await db.insert(prospects).values({
    ownerId,
    linkedinUrl: input.linkedinUrl,
    name: input.name,
    jobTitle: input.jobTitle,
    company: input.company,
    companySize: input.companySize,
    connectionStatus: input.connectionStatus,
    workflowStatus: "new",
    lifecycleStageId: firstStage.id,
    trackingStatus: "open",
    notes: input.notes,
  }).onConflictDoUpdate({
    target: [prospects.ownerId, prospects.linkedinUrl],
    set: { name: input.name, jobTitle: input.jobTitle, company: input.company, companySize: input.companySize, connectionStatus: input.connectionStatus, notes: input.notes, updatedAt: new Date() },
  }).returning();
  if (!prospect) throw new Error("Unable to save prospect");
  if (!existing) await db.insert(prospectStageHistory).values({ ownerId, prospectId: prospect.id, toStageId: firstStage.id, reason: "prospect_created", occurredAt: prospect.createdAt });
  await db.delete(mutualContacts).where(and(eq(mutualContacts.ownerId, ownerId), eq(mutualContacts.prospectId, prospect.id)));
  if (input.mutualContacts.length) await db.insert(mutualContacts).values(input.mutualContacts.map((contact) => ({ ownerId, prospectId: prospect.id, name: contact.name, linkedinUrl: contact.linkedinUrl || null })));
  if (input.connectionStatus === "connected" && (!existing || existing.connectionStatus !== "connected")) await handleConnectionAccepted(ownerId, prospect.id);
  return prospect;
}

export async function scheduleFirstMessage(ownerId: string, prospectId: string) {
  return handleConnectionAccepted(ownerId, prospectId);
}

export async function recordActivity(ownerId: string, prospectId: string, input: ActivityInput) {
  const db = getDb();
  const prospect = (await db.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.ownerId, ownerId))).limit(1))[0];
  if (!prospect) throw new Error("Prospect not found");
  const pending = (await db.select({ action: scheduledActions, step: workflowSteps }).from(scheduledActions)
    .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
    .where(and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.prospectId, prospectId), eq(scheduledActions.status, "pending"))).limit(1))[0];
  const occurredAt = new Date();
  await db.insert(activities).values({ ownerId, prospectId, type: input.type, content: input.content, metadata: input.scheduledActionId ? { scheduledActionId: input.scheduledActionId } : {}, occurredAt });
  const isInteraction = ["connection_request_sent", "message_sent", "reply_received", "reply_sent"].includes(input.type);
  if (isInteraction) await db.update(prospects).set({ lastInteractedAt: occurredAt, updatedAt: occurredAt }).where(eq(prospects.id, prospectId));

  if (input.type === "connection_request_sent") {
    await cancelPending(ownerId, prospectId);
    await db.update(prospects).set({ connectionStatus: "pending", updatedAt: occurredAt }).where(eq(prospects.id, prospectId));
  } else if (input.type === "reply_received") {
    await cancelPending(ownerId, prospectId);
    if (prospect.trackingStatus === "open") {
      const workflow = await ensureDefaultWorkflow(ownerId);
      const stage = workflow.stages.find((item) => item.id === prospect.lifecycleStageId);
      const replyStep = stage?.steps.find((step) => step.trigger === "reply");
      if (replyStep) await schedule(ownerId, prospectId, "reply_needed", occurredAt, replyStep.id);
      else await scheduleStageAdvance(ownerId, prospectId, prospect.lifecycleStageId);
    }
  } else if (input.type === "reply_sent") {
    await cancelPending(ownerId, prospectId);
    if (prospect.trackingStatus === "open") await scheduleStageAdvance(ownerId, prospectId, prospect.lifecycleStageId);
  } else if (input.type === "message_sent") {
    if (pending?.action) await db.update(scheduledActions).set({ status: "completed", completedAt: occurredAt }).where(eq(scheduledActions.id, pending.action.id));
    if (prospect.trackingStatus !== "open") return getProspect(ownerId, prospectId);
    const workflow = await ensureDefaultWorkflow(ownerId);
    const stage = workflow.stages.find((item) => item.id === prospect.lifecycleStageId);
    if (pending?.step?.trigger === "reply") {
      await scheduleStageAdvance(ownerId, prospectId, prospect.lifecycleStageId);
    } else {
      const followUps = stage?.steps.filter((step) => step.trigger === "no_reply").sort((a, b) => a.stepOrder - b.stepOrder) ?? [];
      const next = pending?.step?.trigger === "no_reply"
        ? followUps.find((step) => step.stepOrder === pending.step!.stepOrder + 1)
        : followUps[0];
      if (next) await schedule(ownerId, prospectId, "send_message", addBusinessDays(occurredAt, next.delayBusinessDays, await getTimezone(ownerId)), next.id);
      else await cancelPending(ownerId, prospectId);
    }
  }
  return getProspect(ownerId, prospectId);
}

export async function completeAction(ownerId: string, actionId: string) {
  const db = getDb();
  const [action] = await db.update(scheduledActions).set({ status: "completed", completedAt: new Date() })
    .where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.ownerId, ownerId))).returning();
  if (!action) throw new Error("Action not found");
  if (action.actionType === "close_no_response") await db.update(prospects).set({ trackingStatus: "closed", workflowStatus: "no_response", updatedAt: new Date() }).where(and(eq(prospects.id, action.prospectId), eq(prospects.ownerId, ownerId)));
}

export async function rescheduleAction(ownerId: string, actionId: string, dueAt: Date) {
  const [action] = await getDb().update(scheduledActions).set({ dueAt })
    .where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"))).returning();
  if (!action) throw new Error("Action not found");
  return action;
}

export async function skipAction(ownerId: string, actionId: string) {
  const db = getDb();
  const action = (await db.select({ action: scheduledActions, step: workflowSteps }).from(scheduledActions)
    .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
    .where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"))).limit(1))[0];
  if (!action?.action) throw new Error("Action not found");
  await db.update(scheduledActions).set({ status: "completed", completedAt: new Date() }).where(eq(scheduledActions.id, actionId));
  await db.insert(activities).values({ ownerId, prospectId: action.action.prospectId, type: "task_completed", content: "Skipped scheduled step", metadata: { actionId } });
  if (action.step?.trigger === "no_reply" || action.step?.trigger === "entry") {
    const workflow = await ensureDefaultWorkflow(ownerId);
    const stage = workflow.stages.find((item) => item.id === action.step?.stageId);
    const followUps = stage?.steps.filter((step) => step.trigger === "no_reply").sort((a, b) => a.stepOrder - b.stepOrder) ?? [];
    const next = action.step.trigger === "entry" ? followUps[0] : followUps.find((step) => step.stepOrder === action.step!.stepOrder + 1);
    if (next) await schedule(ownerId, action.action.prospectId, "send_message", addBusinessDays(new Date(), next.delayBusinessDays, await getTimezone(ownerId)), next.id);
  }
}

export async function getProspect(ownerId: string, id: string) {
  const db = getDb();
  const row = (await db.select({ prospect: prospects, stage: lifecycleStages }).from(prospects)
    .leftJoin(lifecycleStages, eq(prospects.lifecycleStageId, lifecycleStages.id))
    .where(and(eq(prospects.id, id), eq(prospects.ownerId, ownerId))).limit(1))[0];
  if (!row) return undefined;
  const [contacts, history, stageHistory, nextActions] = await Promise.all([
    db.select().from(mutualContacts).where(and(eq(mutualContacts.ownerId, ownerId), eq(mutualContacts.prospectId, id))).orderBy(asc(mutualContacts.name)),
    db.select().from(activities).where(and(eq(activities.ownerId, ownerId), eq(activities.prospectId, id))).orderBy(desc(activities.occurredAt)),
    db.select({ history: prospectStageHistory, stage: lifecycleStages }).from(prospectStageHistory).innerJoin(lifecycleStages, eq(prospectStageHistory.toStageId, lifecycleStages.id)).where(and(eq(prospectStageHistory.ownerId, ownerId), eq(prospectStageHistory.prospectId, id))).orderBy(desc(prospectStageHistory.occurredAt)),
    db.select({ action: scheduledActions, step: workflowSteps }).from(scheduledActions).leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id)).where(and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.prospectId, id), eq(scheduledActions.status, "pending"))).limit(1),
  ]);
  const next = nextActions[0];
  return {
    ...row.prospect,
    stage: row.stage,
    mutualContacts: contacts,
    activities: history,
    stageHistory: stageHistory.map((item) => ({ ...item.history, stage: item.stage })),
    nextAction: next ? { ...next.action, label: actionLabel(next.action.actionType, next.step?.name), message: next.step ? renderTemplate(next.step.template, row.prospect) : "", step: next.step } : null,
  };
}

export function actionLabel(actionType: string, stepName?: string | null): string {
  if (actionType === "reply_needed") return stepName ?? "Reply needed";
  if (actionType === "advance_stage") return "Advance to next stage";
  if (actionType === "close_no_response") return "Close as no response";
  return stepName ?? "Send message";
}
