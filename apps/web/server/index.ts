import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { ZodError } from "zod";
import { setupAuth } from "./auth";
import { registerRoutes } from "./routes";

async function main() {
  const app = express();
  // Trust exactly one proxy hop (Replit's reverse proxy) so Express sees the
  // correct protocol (https) and host — required for Clerk's handshake.
  // Using 1 (not true) keeps express-rate-limit happy; "true" is rejected as
  // too permissive by express-rate-limit v7+.
  app.set("trust proxy", 1);
  const extensionOrigin = process.env.ALLOWED_EXTENSION_ORIGIN;
  const isDev = process.env.NODE_ENV !== "production";
  app.use(cors({
    origin(origin, callback) {
      // In dev, allow all origins (private single-user workspace — no production data at risk).
      if (isDev) return callback(null, true);
      // In production, restrict to the configured origins.
      if (!origin || origin === extensionOrigin || origin === process.env.APP_BASE_URL) return callback(null, true);
      callback(new Error("Origin not allowed"));
    },
    credentials: true,
  }));

  // setupAuth mounts the Clerk proxy middleware (before body parsers) and clerkMiddleware
  await setupAuth(app);

  app.use(express.json({ limit: "256kb" }));
  registerRoutes(app);

  // Resolve paths handling both dev (apps/web/server/) and production build (apps/web/dist/server/).
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const isBuilt = serverDir.includes("/dist/server");
  if (process.env.NODE_ENV === "production") {
    // Built: dist/server → ../public = dist/public ✓
    // Source (shouldn't run in prod): server → ../dist/public ✓
    const publicDir = isBuilt
      ? path.resolve(serverDir, "../public")
      : path.resolve(serverDir, "../dist/public");
    app.use(express.static(publicDir, { maxAge: "1h", index: false }));
    app.get("*splat", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  } else {
    const { createServer } = await import("vite");
    // vite.config.ts is always one level up from server/ in source
    const vite = await createServer({ configFile: path.resolve(serverDir, "../vite.config.ts"), server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ message: "Please check the form fields", issues: error.flatten() });
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[api]", error);
    res.status(message.includes("not found") ? 404 : 500).json({ message });
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "0.0.0.0", () => console.info(`[server] listening on 0.0.0.0:${port}`));
}

main().catch((error) => {
  console.error("[server] startup failed", error);
  process.exit(1);
});
