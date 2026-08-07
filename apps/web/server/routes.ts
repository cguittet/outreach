import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import {
  activityInputSchema,
  buildTimeBuckets,
  kpiQuerySchema,
  localDayBounds,
  normalizeLinkedInUrl,
  prospectInputSchema,
  prospectListQuerySchema,
  prospectPatchSchema,
  renderTemplate,
  settingsPatchSchema,
  stageTransitionSchema,
  tokenCreateSchema,
  workflowInputSchema,
} from "@trucea/shared";
import { requireAuth } from "./auth";
import { getDb } from "./db";
import {
  activities,
  extensionTokens,
  lifecycleStages,
  mutualContacts,
  prospectStageHistory,
  prospects,
  scheduledActions,
  userSettings,
  workflows,
  workflowSteps,
} from "../../../database/schema/schema";
import {
  actionLabel,
  completeAction,
  ensureDefaultWorkflow,
  getProspect,
  getTimezone,
  handleConnectionAccepted,
  recordActivity,
  rescheduleAction,
  skipAction,
  transitionProspect,
  updateTrackingStatus,
  upsertProspect,
} from "./workflow";

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
}

function hashToken(token: string): string { return crypto.createHash("sha256").update(token).digest("hex"); }

async function requireExtension(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Pairing token required" });
  const db = getDb();
  const record = (await db.select().from(extensionTokens).where(and(eq(extensionTokens.tokenHash, hashToken(token)), sql`${extensionTokens.revokedAt} IS NULL`, or(sql`${extensionTokens.expiresAt} IS NULL`, sql`${extensionTokens.expiresAt} > now()`))).limit(1))[0];
  if (!record) return res.status(401).json({ message: "Pairing token is invalid or revoked" });
  await db.update(extensionTokens).set({ lastUsedAt: new Date() }).where(eq(extensionTokens.id, record.id));
  res.locals.ownerId = record.ownerId;
  next();
}

async function listTasks(ownerId: string, dueOnly = false) {
  const db = getDb();
  const where = dueOnly
    ? and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"), lte(scheduledActions.dueAt, new Date()), eq(prospects.trackingStatus, "open"))
    : and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"), eq(prospects.trackingStatus, "open"));
  const rows = await db.select({ action: scheduledActions, prospect: prospects, step: workflowSteps }).from(scheduledActions)
    .innerJoin(prospects, eq(scheduledActions.prospectId, prospects.id))
    .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
    .where(where).orderBy(asc(scheduledActions.dueAt));
  return rows.map(({ action, prospect, step }) => ({
    ...action,
    label: actionLabel(action.actionType, step?.name),
    message: step ? renderTemplate(step.template, prospect) : "",
    prospect: { id: prospect.id, name: prospect.name, company: prospect.company, jobTitle: prospect.jobTitle, linkedinUrl: prospect.linkedinUrl },
    step,
  }));
}

type ProspectSort = "prospect" | "connection" | "stage" | "createdAt" | "lastInteractedAt" | "nextAction";

async function listProspects(ownerId: string, rawQuery: Record<string, unknown>) {
  const query = prospectListQuerySchema.parse(rawQuery);
  const filters = [eq(prospects.ownerId, ownerId)];
  if (query.search) filters.push(or(ilike(prospects.name, `%${query.search}%`), ilike(prospects.company, `%${query.search}%`), ilike(prospects.jobTitle, `%${query.search}%`))!);
  if (query.connection) filters.push(eq(prospects.connectionStatus, query.connection));
  if (query.stage) filters.push(eq(prospects.lifecycleStageId, query.stage));
  const rows = await getDb().select({ prospect: prospects, stage: lifecycleStages, action: scheduledActions, step: workflowSteps })
    .from(prospects)
    .leftJoin(lifecycleStages, eq(prospects.lifecycleStageId, lifecycleStages.id))
    .leftJoin(scheduledActions, and(eq(scheduledActions.prospectId, prospects.id), eq(scheduledActions.status, "pending")))
    .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
    .where(and(...filters));
  const items = rows.map(({ prospect, stage, action, step }) => ({ ...prospect, stage, nextAction: action ? { ...action, label: actionLabel(action.actionType, step?.name), step } : null }));
  const direction = query.direction === "asc" ? 1 : -1;
  const text = (value: string | null | undefined) => value ?? "";
  const time = (value: Date | string | null | undefined) => value ? new Date(value).getTime() : null;
  items.sort((a, b) => {
    const key = query.sort as ProspectSort;
    if (key === "lastInteractedAt" || key === "nextAction") {
      const av = time(key === "lastInteractedAt" ? a.lastInteractedAt : a.nextAction?.dueAt);
      const bv = time(key === "lastInteractedAt" ? b.lastInteractedAt : b.nextAction?.dueAt);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * direction;
    }
    if (key === "createdAt") return (a.createdAt.getTime() - b.createdAt.getTime()) * direction;
    const av = key === "prospect" ? a.name : key === "connection" ? a.connectionStatus : text(a.stage?.name);
    const bv = key === "prospect" ? b.name : key === "connection" ? b.connectionStatus : text(b.stage?.name);
    return av.localeCompare(bv, undefined, { sensitivity: "base" }) * direction;
  });
  return { items, query };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function getKpis(ownerId: string, rawQuery: Record<string, unknown>) {
  const query = kpiQuerySchema.parse(rawQuery);
  const db = getDb();
  const timezone = await getTimezone(ownerId);
  const [stageRows, prospectRows, historyRows] = await Promise.all([
    db.select().from(lifecycleStages).where(eq(lifecycleStages.ownerId, ownerId)).orderBy(asc(lifecycleStages.stageOrder)),
    db.select().from(prospects).where(eq(prospects.ownerId, ownerId)),
    db.select().from(prospectStageHistory).where(eq(prospectStageHistory.ownerId, ownerId)).orderBy(asc(prospectStageHistory.occurredAt)),
  ]);
  const activeStages = stageRows.filter((stage) => !stage.archivedAt);
  const now = new Date();
  const buckets = buildTimeBuckets(now, query.granularity, timezone);
  const previousBuckets = buildTimeBuckets(now, query.granularity, timezone, true);
  const valueFor = (bucket: { start: Date; end: Date }) => {
    if (query.metric === "added") return prospectRows.filter((prospect) => prospect.createdAt >= bucket.start && prospect.createdAt <= bucket.end).length;
    if (query.view === "entries") return historyRows.filter((entry) => entry.toStageId === query.metric && entry.reason !== "migration_baseline" && entry.occurredAt >= bucket.start && entry.occurredAt <= bucket.end).length;
    return prospectRows.filter((prospect) => {
      if (prospect.createdAt > bucket.end) return false;
      const last = historyRows.filter((entry) => entry.prospectId === prospect.id && entry.occurredAt <= bucket.end).at(-1);
      return last?.toStageId === query.metric;
    }).length;
  };
  const values = buckets.map((bucket) => ({ ...bucket, value: valueFor(bucket) }));
  const previousValues = previousBuckets.map(valueFor);
  const current = query.view === "totals" && query.metric !== "added" ? values.at(-1)?.value ?? 0 : values.reduce((sum, bucket) => sum + bucket.value, 0);
  const previous = query.view === "totals" && query.metric !== "added" ? previousValues.at(-1) ?? 0 : previousValues.reduce((sum, value) => sum + value, 0);
  return {
    ...query,
    timezone,
    stages: stageRows,
    currentTotals: {
      prospects: prospectRows.length,
      stages: activeStages.map((stage) => ({ stageId: stage.id, name: stage.name, count: prospectRows.filter((prospect) => prospect.lifecycleStageId === stage.id).length })),
    },
    buckets: values.map((bucket) => ({ ...bucket, start: bucket.start.toISOString(), end: bucket.end.toISOString() })),
    comparison: { current, previous, percentage: previous === 0 ? (current > 0 ? null : 0) : ((current - previous) / previous) * 100, isNew: previous === 0 && current > 0 },
  };
}

export function registerRoutes(app: Express): void {
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));
  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "trucea-outreach-tracker" }));

  app.get("/api/summary", requireAuth, asyncRoute(async (req, res) => {
    const ownerId = req.dbUser.id;
    const db = getDb();
    const [tasks, workflow, settings, counts] = await Promise.all([
      listTasks(ownerId), ensureDefaultWorkflow(ownerId),
      db.select().from(userSettings).where(eq(userSettings.ownerId, ownerId)).limit(1).then((rows) => rows[0]),
      db.select({ total: sql<number>`count(*)::int`, connected: sql<number>`count(*) filter (where ${prospects.connectionStatus} = 'connected')::int`, pending: sql<number>`count(*) filter (where ${prospects.connectionStatus} = 'pending')::int` }).from(prospects).where(eq(prospects.ownerId, ownerId)),
    ]);
    const engaged = workflow.stages.find((stage) => stage.stageKey === "engaged");
    const engagedCount = engaged ? (await db.select({ count: sql<number>`count(*)::int` }).from(prospects).where(and(eq(prospects.ownerId, ownerId), eq(prospects.lifecycleStageId, engaged.id))))[0]?.count ?? 0 : 0;
    const now = new Date();
    const bounds = localDayBounds(now, settings?.timezone ?? "America/New_York");
    const addedToday = (await db.select({ count: sql<number>`count(*)::int` }).from(prospects).where(and(eq(prospects.ownerId, ownerId), sql`${prospects.createdAt} >= ${bounds.start}`, sql`${prospects.createdAt} <= ${bounds.end}`)))[0]?.count ?? 0;
    res.json({
      counts: { ...(counts[0] ?? { total: 0, connected: 0, pending: 0 }), engaged: engagedCount },
      engagedStageId: engaged?.id ?? null,
      goal: { target: settings?.dailyProspectGoal ?? 5, addedToday, isBusinessDay: bounds.isBusinessDay },
      dueCount: tasks.filter((task) => new Date(task.dueAt) <= now).length,
      todayCount: tasks.filter((task) => new Date(task.dueAt) <= bounds.end).length,
      tasks: tasks.slice(0, 20),
    });
  }));

  app.get("/api/prospects", requireAuth, asyncRoute(async (req, res) => res.json((await listProspects(req.dbUser.id, req.query)).items)));
  app.get("/api/prospects/export.csv", requireAuth, asyncRoute(async (req, res) => {
    const { items } = await listProspects(req.dbUser.id, req.query);
    const header = ["Name", "Job title", "Company", "Company size", "LinkedIn URL", "Connection", "Lifecycle stage", "Date added", "Last interaction", "Next action", "Due date"];
    const rows = items.map((item) => [item.name, item.jobTitle, item.company, item.companySize, item.linkedinUrl, item.connectionStatus, item.stage?.name, item.createdAt, item.lastInteractedAt, item.nextAction?.label, item.nextAction?.dueAt]);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="trucea-prospects-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"));
  }));
  app.post("/api/prospects", requireAuth, asyncRoute(async (req, res) => {
    const input = prospectInputSchema.parse(req.body);
    const prospect = await upsertProspect(req.dbUser.id, { ...input, linkedinUrl: normalizeLinkedInUrl(input.linkedinUrl) });
    res.status(201).json(await getProspect(req.dbUser.id, prospect.id));
  }));
  app.get("/api/prospects/:id", requireAuth, asyncRoute(async (req, res) => {
    const prospect = await getProspect(req.dbUser.id, String(req.params.id));
    if (!prospect) return res.status(404).json({ message: "Prospect not found" });
    res.json(prospect);
  }));
  app.patch("/api/prospects/:id", requireAuth, asyncRoute(async (req, res) => {
    const input = prospectPatchSchema.parse(req.body);
    const ownerId = req.dbUser.id; const id = String(req.params.id); const db = getDb();
    const existing = await getProspect(ownerId, id);
    if (!existing) return res.status(404).json({ message: "Prospect not found" });
    const { mutualContacts: contacts, linkedinUrl, workflowStatus: legacyStatus, trackingStatus, ...changes } = input;
    await db.update(prospects).set({ ...changes, ...(linkedinUrl ? { linkedinUrl: normalizeLinkedInUrl(linkedinUrl) } : {}), updatedAt: new Date() }).where(and(eq(prospects.id, id), eq(prospects.ownerId, ownerId)));
    if (contacts) {
      await db.delete(mutualContacts).where(and(eq(mutualContacts.ownerId, ownerId), eq(mutualContacts.prospectId, id)));
      if (contacts.length) await db.insert(mutualContacts).values(contacts.map((contact) => ({ ownerId, prospectId: id, name: contact.name, linkedinUrl: contact.linkedinUrl || null })));
    }
    const nextTracking = trackingStatus ?? (legacyStatus === "paused" ? "paused" : legacyStatus === "closed" || legacyStatus === "no_response" ? "closed" : undefined);
    if (nextTracking) await updateTrackingStatus(ownerId, id, nextTracking);
    if (input.connectionStatus === "connected" && existing.connectionStatus !== "connected") await handleConnectionAccepted(ownerId, id);
    res.json(await getProspect(ownerId, id));
  }));
  app.post("/api/prospects/:id/stage", requireAuth, asyncRoute(async (req, res) => {
    const input = stageTransitionSchema.parse(req.body);
    res.json(await transitionProspect(req.dbUser.id, String(req.params.id), input.stageId, input.reason));
  }));
  app.post("/api/prospects/:id/activities", requireAuth, asyncRoute(async (req, res) => res.status(201).json(await recordActivity(req.dbUser.id, String(req.params.id), activityInputSchema.parse(req.body)))));

  app.get("/api/tasks", requireAuth, asyncRoute(async (req, res) => res.json(await listTasks(req.dbUser.id, req.query.due === "true"))));
  app.post("/api/tasks/:id/complete", requireAuth, asyncRoute(async (req, res) => { await completeAction(req.dbUser.id, String(req.params.id)); res.status(204).end(); }));
  app.patch("/api/tasks/:id", requireAuth, asyncRoute(async (req, res) => { const dueAt = new Date(String(req.body.dueAt ?? "")); if (Number.isNaN(dueAt.getTime())) return res.status(400).json({ message: "Choose a valid due date" }); res.json(await rescheduleAction(req.dbUser.id, String(req.params.id), dueAt)); }));
  app.post("/api/tasks/:id/skip", requireAuth, asyncRoute(async (req, res) => { await skipAction(req.dbUser.id, String(req.params.id)); res.status(204).end(); }));

  app.get("/api/workflow", requireAuth, asyncRoute(async (req, res) => res.json(await ensureDefaultWorkflow(req.dbUser.id))));
  app.put("/api/workflow", requireAuth, asyncRoute(async (req, res) => {
    const input = workflowInputSchema.parse(req.body); const ownerId = req.dbUser.id; const current = await ensureDefaultWorkflow(ownerId); const db = getDb();
    const normalizedStages = input.stages.map((stage) => ({ ...stage, id: stage.id ?? crypto.randomUUID() }));
    const incomingIds = new Set(normalizedStages.map((stage) => stage.id));
    const removed = current.stages.filter((stage) => !incomingIds.has(stage.id));
    for (const stage of removed) {
      const occupied = (await db.select({ count: sql<number>`count(*)::int` }).from(prospects).where(and(eq(prospects.ownerId, ownerId), eq(prospects.lifecycleStageId, stage.id))))[0]?.count ?? 0;
      if (occupied) return res.status(409).json({ message: `Move ${occupied} prospect${occupied === 1 ? "" : "s"} out of ${stage.name} before archiving it.` });
    }
    await db.transaction(async (tx) => {
      await tx.update(workflows).set({ name: input.name, updatedAt: new Date() }).where(eq(workflows.id, current.id));
      await tx.update(lifecycleStages).set({ stageOrder: sql`${lifecycleStages.stageOrder} + 1000` }).where(and(eq(lifecycleStages.ownerId, ownerId), isNull(lifecycleStages.archivedAt)));
      for (const [index, stage] of normalizedStages.entries()) {
        if (stage.id && current.stages.some((item) => item.id === stage.id)) await tx.update(lifecycleStages).set({ name: stage.name, stageOrder: index + 1, updatedAt: new Date() }).where(and(eq(lifecycleStages.id, stage.id), eq(lifecycleStages.ownerId, ownerId)));
        else await tx.insert(lifecycleStages).values({ ...(stage.id ? { id: stage.id } : {}), ownerId, name: stage.name, stageOrder: index + 1 });
      }
      for (const stage of removed) await tx.update(lifecycleStages).set({ archivedAt: new Date(), stageOrder: stage.stageOrder + 1000, updatedAt: new Date() }).where(eq(lifecycleStages.id, stage.id));
      await tx.update(workflowSteps).set({ stepOrder: sql`${workflowSteps.stepOrder} + 1000` }).where(eq(workflowSteps.workflowId, current.id));
      const currentSteps = current.stages.flatMap((stage) => stage.steps);
      const keptSteps = new Set<string>();
      for (const stage of normalizedStages) {
        for (const step of stage.steps) {
          if (step.id && currentSteps.some((item) => item.id === step.id)) {
            keptSteps.add(step.id);
            await tx.update(workflowSteps).set({ stageId: stage.id, trigger: step.trigger, stepOrder: step.stepOrder, kind: step.kind, name: step.name, delayBusinessDays: step.delayBusinessDays, template: step.template }).where(and(eq(workflowSteps.id, step.id), eq(workflowSteps.ownerId, ownerId)));
          } else {
            const [created] = await tx.insert(workflowSteps).values({ ...(step.id ? { id: step.id } : {}), ownerId, workflowId: current.id, stageId: stage.id, trigger: step.trigger, stepOrder: step.stepOrder, kind: step.kind, name: step.name, delayBusinessDays: step.delayBusinessDays, template: step.template }).returning();
            if (created) keptSteps.add(created.id);
          }
        }
      }
      const removedSteps = currentSteps.filter((step) => !keptSteps.has(step.id)).map((step) => step.id);
      if (removedSteps.length) await tx.delete(workflowSteps).where(and(eq(workflowSteps.workflowId, current.id), inArray(workflowSteps.id, removedSteps)));
    });
    res.json(await ensureDefaultWorkflow(ownerId));
  }));

  app.get("/api/settings", requireAuth, asyncRoute(async (req, res) => res.json((await getDb().select().from(userSettings).where(eq(userSettings.ownerId, req.dbUser.id)).limit(1))[0])));
  app.patch("/api/settings", requireAuth, asyncRoute(async (req, res) => {
    const input = settingsPatchSchema.parse(req.body);
    if (input.timezone && !Intl.supportedValuesOf("timeZone").includes(input.timezone)) return res.status(400).json({ message: "Invalid timezone" });
    const [settings] = await getDb().update(userSettings).set({ ...input, updatedAt: new Date() }).where(eq(userSettings.ownerId, req.dbUser.id)).returning();
    res.json(settings);
  }));
  app.get("/api/kpis", requireAuth, asyncRoute(async (req, res) => res.json(await getKpis(req.dbUser.id, req.query))));

  app.get("/api/extension-tokens", requireAuth, asyncRoute(async (req, res) => res.json(await getDb().select({ id: extensionTokens.id, name: extensionTokens.name, lastUsedAt: extensionTokens.lastUsedAt, createdAt: extensionTokens.createdAt, revokedAt: extensionTokens.revokedAt }).from(extensionTokens).where(eq(extensionTokens.ownerId, req.dbUser.id)).orderBy(desc(extensionTokens.createdAt)))));
  app.post("/api/extension-tokens", requireAuth, asyncRoute(async (req, res) => { const { name } = tokenCreateSchema.parse(req.body); const token = `trucea_${crypto.randomBytes(32).toString("base64url")}`; const [record] = await getDb().insert(extensionTokens).values({ ownerId: req.dbUser.id, name, tokenHash: hashToken(token) }).returning(); res.status(201).json({ ...record, tokenHash: undefined, token }); }));
  app.delete("/api/extension-tokens/:id", requireAuth, asyncRoute(async (req, res) => { await getDb().update(extensionTokens).set({ revokedAt: new Date() }).where(and(eq(extensionTokens.id, String(req.params.id)), eq(extensionTokens.ownerId, req.dbUser.id))); res.status(204).end(); }));

  app.get("/api/extension/context", requireExtension, asyncRoute(async (req, res) => { const ownerId = res.locals.ownerId as string; let linkedinUrl: string; try { linkedinUrl = normalizeLinkedInUrl(String(req.query.linkedinUrl ?? "")); } catch { return res.status(400).json({ message: "Open a LinkedIn profile page first" }); } const row = (await getDb().select().from(prospects).where(and(eq(prospects.ownerId, ownerId), eq(prospects.linkedinUrl, linkedinUrl))).limit(1))[0]; res.json(row ? await getProspect(ownerId, row.id) : { linkedinUrl }); }));
  app.post("/api/extension/prospects", requireExtension, asyncRoute(async (req, res) => { const input = prospectInputSchema.parse(req.body); const ownerId = res.locals.ownerId as string; const prospect = await upsertProspect(ownerId, { ...input, linkedinUrl: normalizeLinkedInUrl(input.linkedinUrl) }); res.status(201).json(await getProspect(ownerId, prospect.id)); }));
  app.patch("/api/extension/prospects/:id", requireExtension, asyncRoute(async (req, res) => { const ownerId = res.locals.ownerId as string; const input = prospectPatchSchema.parse(req.body); const id = String(req.params.id); const existing = await getProspect(ownerId, id); if (!existing) return res.status(404).json({ message: "Prospect not found" }); const { mutualContacts: _contacts, linkedinUrl, workflowStatus: _legacy, trackingStatus: _tracking, ...changes } = input; await getDb().update(prospects).set({ ...changes, ...(linkedinUrl ? { linkedinUrl: normalizeLinkedInUrl(linkedinUrl) } : {}), updatedAt: new Date() }).where(and(eq(prospects.id, id), eq(prospects.ownerId, ownerId))); if (input.connectionStatus === "connected" && existing.connectionStatus !== "connected") await handleConnectionAccepted(ownerId, id); res.json(await getProspect(ownerId, id)); }));
  app.post("/api/extension/prospects/:id/activities", requireExtension, asyncRoute(async (req, res) => res.status(201).json(await recordActivity(res.locals.ownerId as string, String(req.params.id), activityInputSchema.parse(req.body)))));
  app.get("/api/extension/due-count", requireExtension, asyncRoute(async (_req, res) => { const tasks = await listTasks(res.locals.ownerId as string, true); res.json({ count: tasks.length, next: tasks[0] ?? null }); }));
}
