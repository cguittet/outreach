import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  replitUserId: text("replit_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSettings = pgTable("user_settings", {
  ownerId: uuid("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("America/New_York"),
  dailyProspectGoal: integer("daily_prospect_goal").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lifecycleStages = pgTable("lifecycle_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stageKey: text("stage_key"),
  stageOrder: integer("stage_order").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lifecycle_stages_owner_order_active_unique").on(table.ownerId, table.stageOrder).where(sql`${table.archivedAt} IS NULL`),
  index("lifecycle_stages_owner_idx").on(table.ownerId),
]);

export const prospects = pgTable("prospects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  linkedinUrl: text("linkedin_url").notNull(),
  name: text("name").notNull(),
  jobTitle: text("job_title").notNull().default(""),
  company: text("company").notNull().default(""),
  companySize: text("company_size").notNull().default("Unknown"),
  connectionStatus: text("connection_status").notNull().default("not_connected"),
  workflowStatus: text("workflow_status").notNull().default("new"),
  lifecycleStageId: uuid("lifecycle_stage_id").notNull().references(() => lifecycleStages.id, { onDelete: "restrict" }),
  trackingStatus: text("tracking_status").notNull().default("open"),
  notes: text("notes").notNull().default(""),
  lastInteractedAt: timestamp("last_interacted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prospects_owner_linkedin_unique").on(table.ownerId, table.linkedinUrl),
  index("prospects_owner_status_idx").on(table.ownerId, table.workflowStatus),
  index("prospects_owner_stage_idx").on(table.ownerId, table.lifecycleStageId),
]);

export const mutualContacts = pgTable("mutual_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  linkedinUrl: text("linkedin_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("mutual_contacts_prospect_idx").on(table.prospectId)]);

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Trucea outreach"),
  finalWaitBusinessDays: integer("final_wait_business_days").notNull().default(5),
  isDefault: integer("is_default").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("workflows_owner_default_unique").on(table.ownerId, table.isDefault)]);

export const workflowSteps = pgTable("workflow_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id").notNull().references(() => lifecycleStages.id, { onDelete: "cascade" }),
  trigger: text("trigger_type").notNull().default("no_reply"),
  stepOrder: integer("step_order").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  delayBusinessDays: integer("delay_business_days").notNull().default(0),
  template: text("template").notNull(),
}, (table) => [uniqueIndex("workflow_steps_branch_order_unique").on(table.stageId, table.trigger, table.stepOrder)]);

export const prospectStageHistory = pgTable("prospect_stage_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  fromStageId: uuid("from_stage_id").references(() => lifecycleStages.id, { onDelete: "restrict" }),
  toStageId: uuid("to_stage_id").notNull().references(() => lifecycleStages.id, { onDelete: "restrict" }),
  reason: text("reason").notNull().default("manual"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("prospect_stage_history_owner_time_idx").on(table.ownerId, table.occurredAt),
  index("prospect_stage_history_prospect_time_idx").on(table.prospectId, table.occurredAt),
]);

export const scheduledActions = pgTable("scheduled_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id, { onDelete: "set null" }),
  actionType: text("action_type").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("scheduled_actions_owner_due_idx").on(table.ownerId, table.status, table.dueAt),
  uniqueIndex("scheduled_actions_one_pending_per_prospect")
    .on(table.prospectId)
    .where(sql`${table.status} = 'pending'`),
]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  content: text("content").notNull().default(""),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("activities_prospect_time_idx").on(table.prospectId, table.occurredAt)]);

export const extensionTokens = pgTable("extension_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("extension_tokens_owner_idx").on(table.ownerId)]);

export const prospectRelations = relations(prospects, ({ many }) => ({
  mutualContacts: many(mutualContacts),
  activities: many(activities),
  scheduledActions: many(scheduledActions),
  stageHistory: many(prospectStageHistory),
}));

export const mutualContactRelations = relations(mutualContacts, ({ one }) => ({
  prospect: one(prospects, { fields: [mutualContacts.prospectId], references: [prospects.id] }),
}));

export const workflowRelations = relations(workflows, ({ many }) => ({ steps: many(workflowSteps) }));
export const workflowStepRelations = relations(workflowSteps, ({ one }) => ({
  workflow: one(workflows, { fields: [workflowSteps.workflowId], references: [workflows.id] }),
}));
