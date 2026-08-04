import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "./db";
import { users, userSettings } from "../../../database/schema/schema";
import { ensureDefaultWorkflow } from "./workflow";

export async function seed(): Promise<void> {
  const email = process.env.DEV_AUTH_EMAIL ?? process.env.ALLOWED_EMAIL;
  if (!email) throw new Error("Set DEV_AUTH_EMAIL or ALLOWED_EMAIL before seeding");
  const db = getDb();
  let user = (await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1))[0];
  if (!user) [user] = await db.insert(users).values({ replitUserId: `seed:${email}`, email: email.toLowerCase(), displayName: "Trucea owner" }).returning();
  if (!user) throw new Error("Unable to seed user");
  await db.insert(userSettings).values({ ownerId: user.id }).onConflictDoNothing();
  await ensureDefaultWorkflow(user.id);
  console.info("[database] default workflow ready");
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) seed().then(() => getPool().end()).catch((error) => { console.error(error); process.exit(1); });
