import type { Express, NextFunction, Request, Response } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { userSettings, users } from "../../../database/schema/schema";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

type DbUser = typeof users.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      dbUser: DbUser;
    }
  }
}

export async function setupAuth(app: Express): Promise<void> {
  // Mount Clerk proxy middleware BEFORE body parsers
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

  // Simple middleware: reads CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY from env
  app.use(clerkMiddleware());

  // GET /api/auth/user — returns the local DB user row for the authenticated session
  app.get("/api/auth/user", requireAuth, (req, res) => {
    res.json(req.dbUser);
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);

  if (!auth.userId) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const sessionClaims = auth.sessionClaims as {
    userId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  } | undefined;

  const email = sessionClaims?.email;
  if (!email) {
    res.status(401).json({ message: "No email in session claims" });
    return;
  }

  // Check ALLOWED_EMAIL restriction
  const allowedEmail = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (allowedEmail && email.toLowerCase() !== allowedEmail) {
    res.status(403).json({ message: "This account is not authorized" });
    return;
  }

  const db = getDb();

  // Email-bridge JIT provisioning: look up by email, insert if not found
  let [dbUser] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

  if (!dbUser) {
    const displayName = [sessionClaims?.firstName, sessionClaims?.lastName]
      .filter(Boolean)
      .join(" ") || email;

    const replitUserId = sessionClaims?.userId ?? auth.userId;

    const [inserted] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        replitUserId,
        displayName,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      dbUser = inserted;
      // Also create default user settings
      await db.insert(userSettings).values({ ownerId: inserted.id }).onConflictDoNothing();
    } else {
      // Race condition: another request beat us — re-select
      [dbUser] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    }
  }

  if (!dbUser) {
    res.status(401).json({ message: "Could not resolve local user" });
    return;
  }

  req.dbUser = dbUser;
  next();
}
