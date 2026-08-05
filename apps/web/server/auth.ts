import type { Express, NextFunction, Request, Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import * as oidc from "openid-client";
import { Strategy } from "openid-client/passport";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "./db";
import { userSettings, users } from "../../../database/schema/schema";

export interface AuthUser {
  id: string;
  replitUserId: string;
  email: string;
  displayName: string;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

async function upsertUser(identity: { sub: string; email: string; name?: string }): Promise<AuthUser> {
  const allowedEmail = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (allowedEmail && identity.email.toLowerCase() !== allowedEmail) {
    throw new Error("This Replit account is not authorized for this app");
  }
  const db = getDb();
  const [user] = await db.insert(users).values({
    replitUserId: identity.sub,
    email: identity.email.toLowerCase(),
    displayName: identity.name ?? identity.email,
  }).onConflictDoUpdate({
    // Use email as the conflict target so a real Replit login can overwrite a
    // dev-seeded row that has the same email but a different replitUserId.
    target: users.email,
    set: { replitUserId: identity.sub, displayName: identity.name ?? identity.email, updatedAt: new Date() },
  }).returning();
  if (!user) throw new Error("Unable to create user");
  await db.insert(userSettings).values({ ownerId: user.id }).onConflictDoNothing();
  return user;
}

export async function setupAuth(app: Express): Promise<void> {
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET;
  if (production && (!secret || secret.length < 32)) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production");
  }
  const PgStore = connectPgSimple(session);
  app.set("trust proxy", 1);
  app.use(session({
    store: new PgStore({ pool: getPool(), tableName: "sessions", createTableIfMissing: false }),
    secret: secret ?? "development-only-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: production, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user: AuthUser, done) => done(null, user));

  const devEmail = !production ? process.env.DEV_AUTH_EMAIL : undefined;
  if (devEmail) {
    app.use(async (req, _res, next) => {
      if (!req.user) req.user = await upsertUser({ sub: `dev:${devEmail}`, email: devEmail, name: "Trucea owner" });
      next();
    });
  }

  const replId = process.env.REPL_ID;
  if (replId) {
    const config = await oidc.discovery(new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"), replId);
    const callbackURL = new URL("/api/callback", process.env.APP_BASE_URL ?? `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`).toString();
    const verify = async (tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers, done: (error: unknown, user?: Express.User | false) => void) => {
      try {
        const claims = tokens.claims();
        if (!claims?.sub || typeof claims.email !== "string") return done(new Error("Replit Auth did not return an email address"));
        const user = await upsertUser({ sub: claims.sub, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined });
        done(null, user);
      } catch (error) {
        done(error);
      }
    };
    passport.use("replitauth", new Strategy({ config, scope: "openid email profile offline_access", callbackURL }, verify));
    app.get("/api/login", passport.authenticate("replitauth"));
    app.get("/api/callback", passport.authenticate("replitauth", { failureRedirect: "/?auth=failed" }), (_req, res) => res.redirect("/"));
  } else {
    app.get("/api/login", (_req, res) => res.status(503).send("Replit Auth becomes available after importing this app into Replit. For local development, set DEV_AUTH_EMAIL."));
  }

  app.get("/api/logout", (req, res, next) => req.logout((error) => error ? next(error) : res.redirect("/")));
  app.get("/api/auth/user", (req, res) => req.user ? res.json(req.user) : res.status(401).json({ message: "Not authenticated" }));
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (allowed && req.user.email.toLowerCase() !== allowed) {
    res.status(403).json({ message: "This account is not authorized" });
    return;
  }
  next();
}

export async function getUserById(id: string) {
  return (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0];
}
