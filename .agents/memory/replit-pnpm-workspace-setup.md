---
name: Replit pnpm workspace setup quirks
description: Fixes required when importing a pnpm workspace monorepo into Replit
---

# Replit pnpm workspace setup quirks

## Rules

**Remove `packageManager` field from root `package.json`.**
Replit's pnpm wrapper intercepts the field and tries to install the pinned pnpm version via corepack, which fails with EAGAIN/exit-1 loops. The environment already ships a compatible pnpm version.

**Why:** Replit's package management interceptor reads `packageManager` and runs `pnpm add pnpm@X.Y.Z` to enforce corepack pinning — this always fails in the Replit nix environment.

**How to apply:** On any pnpm workspace import, check `package.json` for `"packageManager"` and delete the line before running `pnpm install`.

---

**Fix `process.cwd()`-relative paths in server/migration scripts.**
pnpm runs workspace scripts from the package subdirectory (e.g. `apps/web`), not the workspace root. Scripts that use `process.cwd()` to resolve paths outside their package (e.g. `database/migrations/`) break.

Use `import.meta.url` instead, and detect dev vs. built context:

```typescript
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const isBuilt = scriptDir.includes("/dist/server");
// Source:  apps/web/server/ → 3 levels up → workspace root
// Built:   apps/web/dist/server/ → 4 levels up → workspace root
const migrationsDir = path.resolve(scriptDir,
  isBuilt ? "../../../../database/migrations" : "../../../database/migrations");
```

For production static files (built server at `dist/server/`):
```typescript
const isBuilt = serverDir.includes("/dist/server");
const publicDir = isBuilt
  ? path.resolve(serverDir, "../public")        // dist/server → dist/public ✓
  : path.resolve(serverDir, "../dist/public");  // server → dist/public ✓
```

**Why:** `pnpm --filter @pkg dev` sets CWD to the package dir; `pnpm start` (production) sets CWD to workspace root. `import.meta.url` is stable regardless of CWD.

---

**Add dev CORS origins for Replit preview.**
The CORS middleware must allow three additional origins in development so the Replit preview pane and screenshot tool work:
1. `https://${REPLIT_DEV_DOMAIN}` — browser preview
2. `http://localhost:PORT` — local dev
3. `http://127.0.0.1:PORT` — screenshot/health-check tool

**Why:** The preview iframe sends the Replit dev domain as `Origin`; the screenshot tool sends `http://127.0.0.1:5000`. Strict origin checks return 500 (caught by the global error handler), rendering a blank page.
