import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, ilike, lte, notInArray, or, sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import {
  activityInputSchema,
  normalizeLinkedInUrl,
  prospectInputSchema,
  prospectPatchSchema,
  renderTemplate,
  tokenCreateSchema,
  workflowInputSchema,
} from "@trucea/shared";
import { requireUser } from "./auth";
import { getDb } from "./db";
import {
  activities,
  extensionTokens,
  mutualContacts,
  prospects,
  scheduledActions,
  userSettings,
  workflows,
  workflowSteps,
} from "../../../database/schema/schema";
import {
  completeAction,
  ensureDefaultWorkflow,
  getProspect,
  recordActivity,
  rescheduleAction,
  scheduleFirstMessage,
  skipAction,
  upsertProspect,
} from "./workflow";

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

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

function taskLabel(actionType: string, stepName?: string | null): string {
  if (actionType === "reply_needed") return "Reply needed";
  if (actionType === "close_no_response") return "Close as no response";
  return stepName ?? "Send message";
}

async function listTasks(ownerId: string, dueOnly = false) {
  const db = getDb();
  const where = dueOnly
    ? and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"), lte(scheduledActions.dueAt, new Date()), notInArray(prospects.workflowStatus, ["paused", "closed", "no_response"]))
    : and(eq(scheduledActions.ownerId, ownerId), eq(scheduledActions.status, "pending"), notInArray(prospects.workflowStatus, ["paused", "closed", "no_response"]));
  const rows = await db.select({ action: scheduledActions, prospect: prospects, step: workflowSteps })
    .from(scheduledActions)
    .innerJoin(prospects, eq(scheduledActions.prospectId, prospects.id))
    .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
    .where(where)
    .orderBy(asc(scheduledActions.dueAt));
  return rows.map(({ action, prospect, step }) => ({
    ...action,
    label: taskLabel(action.actionType, step?.name),
    message: step ? renderTemplate(step.template, prospect) : "",
    prospect: { id: prospect.id, name: prospect.name, company: prospect.company, jobTitle: prospect.jobTitle, linkedinUrl: prospect.linkedinUrl },
    step,
  }));
}

export function registerRoutes(app: Express): void {
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });
  app.use("/api", apiLimiter);

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "trucea-outreach-tracker" }));

  app.get("/api/summary", requireUser, asyncRoute(async (req, res) => {
    const ownerId = req.user!.id;
    const db = getDb();
    const [tasks, counts] = await Promise.all([
      listTasks(ownerId),
      db.select({
        total: sql<number>`count(*)::int`,
        connected: sql<number>`count(*) filter (where ${prospects.connectionStatus} = 'connected')::int`,
        pending: sql<number>`count(*) filter (where ${prospects.connectionStatus} = 'pending')::int`,
        engaged: sql<number>`count(*) filter (where ${prospects.workflowStatus} = 'engaged')::int`,
      }).from(prospects).where(eq(prospects.ownerId, ownerId)),
    ]);
    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    res.json({
      counts: counts[0] ?? { total: 0, connected: 0, pending: 0, engaged: 0 },
      dueCount: tasks.filter((task) => new Date(task.dueAt) <= now).length,
      todayCount: tasks.filter((task) => new Date(task.dueAt) <= endOfToday).length,
      tasks: tasks.slice(0, 20),
    });
  }));

  app.get("/api/prospects", requireUser, asyncRoute(async (req, res) => {
    const ownerId = req.user!.id;
    const search = String(req.query.search ?? "").trim();
    const connection = String(req.query.connection ?? "");
    const workflow = String(req.query.workflow ?? "");
    const filters = [eq(prospects.ownerId, ownerId)];
    if (search) filters.push(or(ilike(prospects.name, `%${search}%`), ilike(prospects.company, `%${search}%`), ilike(prospects.jobTitle, `%${search}%`))!);
    if (connection) filters.push(eq(prospects.connectionStatus, connection));
    if (workflow) filters.push(eq(prospects.workflowStatus, workflow));
    const rows = await getDb().select({ prospect: prospects, action: scheduledActions, step: workflowSteps })
      .from(prospects)
      .leftJoin(scheduledActions, and(eq(scheduledActions.prospectId, prospects.id), eq(scheduledActions.status, "pending")))
      .leftJoin(workflowSteps, eq(scheduledActions.workflowStepId, workflowSteps.id))
      .where(and(...filters)).orderBy(desc(prospects.updatedAt));
    res.json(rows.map(({ prospect, action, step }) => ({ ...prospect, nextAction: action ? { ...action, label: taskLabel(action.actionType, step?.name), step } : null })));
  }));

  app.post("/api/prospects", requireUser, asyncRoute(async (req, res) => {
    const input = prospectInputSchema.parse(req.body);
    const prospect = await upsertProspect(req.user!.id, { ...input, linkedinUrl: normalizeLinkedInUrl(input.linkedinUrl) });
    res.status(201).json(await getProspect(req.user!.id, prospect.id));
  }));

  app.get("/api/prospects/:id", requireUser, asyncRoute(async (req, res) => {
    const prospect = await getProspect(req.user!.id, String(req.params.id));
    if (!prospect) return res.status(404).json({ message: "Prospect not found" });
    res.json(prospect);
  }));

  app.patch("/api/prospects/:id", requireUser, asyncRoute(async (req, res) => {
    const input = prospectPatchSchema.parse(req.body);
    const ownerId = req.user!.id;
    const db = getDb();
    const id = String(req.params.id);
    const existing = await getProspect(ownerId, id);
    if (!existing) return res.status(404).json({ message: "Prospect not found" });
    const { mutualContacts: contacts, linkedinUrl, ...changes } = input;
    await db.update(prospects).set({
      ...changes,
      ...(linkedinUrl ? { linkedinUrl: normalizeLinkedInUrl(linkedinUrl) } : {}),
      updatedAt: new Date(),
    }).where(and(eq(prospects.id, id), eq(prospects.ownerId, ownerId)));
    if (contacts) {
      await db.delete(mutualContacts).where(and(eq(mutualContacts.ownerId, ownerId), eq(mutualContacts.prospectId, id)));
      if (contacts.length) await db.insert(mutualContacts).values(contacts.map((contact) => ({ ownerId, prospectId: id, name: contact.name, linkedinUrl: contact.linkedinUrl || null })));
    }
    if (input.connectionStatus === "connected" && existing.connectionStatus !== "connected") await scheduleFirstMessage(ownerId, id);
    res.json(await getProspect(ownerId, id));
  }));

  app.post("/api/prospects/:id/activities", requireUser, asyncRoute(async (req, res) => {
    res.status(201).json(await recordActivity(req.user!.id, String(req.params.id), activityInputSchema.parse(req.body)));
  }));

  app.get("/api/tasks", requireUser, asyncRoute(async (req, res) => res.json(await listTasks(req.user!.id, req.query.due === "true"))));
  app.post("/api/tasks/:id/complete", requireUser, asyncRoute(async (req, res) => {
    await completeAction(req.user!.id, String(req.params.id));
    res.status(204).end();
  }));
  app.patch("/api/tasks/:id", requireUser, asyncRoute(async (req, res) => {
    const dueAt = new Date(String(req.body.dueAt ?? ""));
    if (Number.isNaN(dueAt.getTime())) return res.status(400).json({ message: "Choose a valid due date" });
    res.json(await rescheduleAction(req.user!.id, String(req.params.id), dueAt));
  }));
  app.post("/api/tasks/:id/skip", requireUser, asyncRoute(async (req, res) => {
    await skipAction(req.user!.id, String(req.params.id));
    res.status(204).end();
  }));

  app.get("/api/workflow", requireUser, asyncRoute(async (req, res) => res.json(await ensureDefaultWorkflow(req.user!.id))));
  app.put("/api/workflow", requireUser, asyncRoute(async (req, res) => {
    const input = workflowInputSchema.parse(req.body);
    const ownerId = req.user!.id;
    const current = await ensureDefaultWorkflow(ownerId);
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.update(workflows).set({ name: input.name, finalWaitBusinessDays: input.finalWaitBusinessDays, updatedAt: new Date() }).where(eq(workflows.id, current.id));
      const keepIds: string[] = [];
      for (let index = 0; index < input.steps.length; index += 1) {
        const step = input.steps[index]!;
        const existing = current.steps[index];
        if (existing) {
          keepIds.push(existing.id);
          await tx.update(workflowSteps).set({ stepOrder: index + 1, kind: step.kind, name: step.name, delayBusinessDays: step.delayBusinessDays, template: step.template }).where(eq(workflowSteps.id, existing.id));
        } else {
          const [created] = await tx.insert(workflowSteps).values({ ownerId, workflowId: current.id, stepOrder: index + 1, kind: step.kind, name: step.name, delayBusinessDays: step.delayBusinessDays, template: step.template }).returning();
          if (created) keepIds.push(created.id);
        }
      }
      if (keepIds.length) await tx.delete(workflowSteps).where(and(eq(workflowSteps.workflowId, current.id), notInArray(workflowSteps.id, keepIds)));
    });
    res.json(await ensureDefaultWorkflow(ownerId));
  }));

  app.get("/api/settings", requireUser, asyncRoute(async (req, res) => {
    const settings = (await getDb().select().from(userSettings).where(eq(userSettings.ownerId, req.user!.id)).limit(1))[0];
    res.json(settings);
  }));
  app.patch("/api/settings", requireUser, asyncRoute(async (req, res) => {
    const timezone = String(req.body.timezone ?? "");
    if (!Intl.supportedValuesOf("timeZone").includes(timezone)) return res.status(400).json({ message: "Invalid timezone" });
    const [settings] = await getDb().update(userSettings).set({ timezone, updatedAt: new Date() }).where(eq(userSettings.ownerId, req.user!.id)).returning();
    res.json(settings);
  }));

  app.get("/api/extension-tokens", requireUser, asyncRoute(async (req, res) => {
    const rows = await getDb().select({ id: extensionTokens.id, name: extensionTokens.name, lastUsedAt: extensionTokens.lastUsedAt, createdAt: extensionTokens.createdAt, revokedAt: extensionTokens.revokedAt })
      .from(extensionTokens).where(eq(extensionTokens.ownerId, req.user!.id)).orderBy(desc(extensionTokens.createdAt));
    res.json(rows);
  }));
  app.post("/api/extension-tokens", requireUser, asyncRoute(async (req, res) => {
    const { name } = tokenCreateSchema.parse(req.body);
    const token = `trucea_${crypto.randomBytes(32).toString("base64url")}`;
    const [record] = await getDb().insert(extensionTokens).values({ ownerId: req.user!.id, name, tokenHash: hashToken(token) }).returning();
    res.status(201).json({ ...record, tokenHash: undefined, token });
  }));
  app.delete("/api/extension-tokens/:id", requireUser, asyncRoute(async (req, res) => {
    await getDb().update(extensionTokens).set({ revokedAt: new Date() }).where(and(eq(extensionTokens.id, String(req.params.id)), eq(extensionTokens.ownerId, req.user!.id)));
    res.status(204).end();
  }));

  app.get("/api/extension/context", requireExtension, asyncRoute(async (req, res) => {
    const ownerId = res.locals.ownerId as string;
    let linkedinUrl: string;
    try { linkedinUrl = normalizeLinkedInUrl(String(req.query.linkedinUrl ?? "")); }
    catch { return res.status(400).json({ message: "Open a LinkedIn profile page first" }); }
    const row = (await getDb().select().from(prospects).where(and(eq(prospects.ownerId, ownerId), eq(prospects.linkedinUrl, linkedinUrl))).limit(1))[0];
    res.json(row ? await getProspect(ownerId, row.id) : { linkedinUrl });
  }));
  app.post("/api/extension/prospects", requireExtension, asyncRoute(async (req, res) => {
    const input = prospectInputSchema.parse(req.body);
    const ownerId = res.locals.ownerId as string;
    const prospect = await upsertProspect(ownerId, { ...input, linkedinUrl: normalizeLinkedInUrl(input.linkedinUrl) });
    res.status(201).json(await getProspect(ownerId, prospect.id));
  }));
  app.patch("/api/extension/prospects/:id", requireExtension, asyncRoute(async (req, res) => {
    const ownerId = res.locals.ownerId as string;
    const input = prospectPatchSchema.parse(req.body);
    const id = String(req.params.id);
    const existing = await getProspect(ownerId, id);
    if (!existing) return res.status(404).json({ message: "Prospect not found" });
    const { mutualContacts: _contacts, linkedinUrl, ...changes } = input;
    await getDb().update(prospects).set({ ...changes, ...(linkedinUrl ? { linkedinUrl: normalizeLinkedInUrl(linkedinUrl) } : {}), updatedAt: new Date() }).where(and(eq(prospects.id, id), eq(prospects.ownerId, ownerId)));
    if (input.connectionStatus === "connected" && existing.connectionStatus !== "connected") await scheduleFirstMessage(ownerId, id);
    res.json(await getProspect(ownerId, id));
  }));
  app.post("/api/extension/prospects/:id/activities", requireExtension, asyncRoute(async (req, res) => {
    res.status(201).json(await recordActivity(res.locals.ownerId as string, String(req.params.id), activityInputSchema.parse(req.body)));
  }));
  app.get("/api/extension/due-count", requireExtension, asyncRoute(async (_req, res) => {
    const tasks = await listTasks(res.locals.ownerId as string, true);
    res.json({ count: tasks.length, next: tasks[0] ?? null });
  }));
}
