# Trucea Outreach Tracker

A private LinkedIn outreach tracker with a React/Express web dashboard and an optional Chrome extension companion.

## Stack

- **Frontend**: React 19 + Vite (TypeScript, `apps/web/client/`)
- **Backend**: Express 5 + Passport + Replit OIDC auth (`apps/web/server/`)
- **Database**: PostgreSQL via Drizzle ORM (`database/schema/`, `database/migrations/`)
- **Shared utilities**: `packages/shared/` (validation, URL, template, scheduling)
- **Chrome extension**: `apps/extension/` (Manifest V3, optional)
- **Package manager**: pnpm 10 workspaces

## How to run

The `Start application` workflow handles everything:
```
pnpm install && pnpm db:migrate && pnpm dev
```

The server listens on **port 5000** (set via `PORT` env var).

## Required secrets / env vars

| Key | Description |
|-----|-------------|
| `SESSION_SECRET` | At least 32 random characters for session signing |
| `ALLOWED_EMAIL` | Replit account email that can log in |
| `APP_BASE_URL` | Preview URL in dev; published URL after deploying |
| `DATABASE_URL` | Injected automatically by Replit |

Optional:
- `ALLOWED_EXTENSION_ORIGIN` — set after loading the Chrome extension (`chrome-extension://EXTENSION_ID`)

## Database

- Migrations run automatically on startup (`pnpm db:migrate`)
- Seed creates the default follow-up workflow (`pnpm db:seed`) — run once after first migration
- Schema: `database/schema/schema.ts`; migrations: `database/migrations/`

## Auth

Uses Replit OIDC in production. Only `ALLOWED_EMAIL` can access the dashboard.

## Replit-specific changes made during import

- Removed `packageManager` field from `package.json` (Replit's pnpm wrapper conflicted with corepack)
- Fixed `apps/web/server/migrate.ts` and `apps/web/server/index.ts` to resolve paths relative to `import.meta.url` instead of `process.cwd()` (pnpm runs scripts from the package subdirectory, not the workspace root)
- Added dev CORS allowlist entries for `REPLIT_DEV_DOMAIN`, `localhost`, and `127.0.0.1` so the Replit preview pane works

## User preferences

<!-- Add any preferred conventions or patterns here -->
