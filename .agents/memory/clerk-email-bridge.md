---
name: Clerk auth migration — email bridge pattern
description: This app uses email (not userId/replitUserId) as the bridge column between Clerk sessions and the local users table.
---

# Clerk Auth — Email Bridge

**Rule:** `requireAuth` in `apps/web/server/auth.ts` looks up `users` by `sessionClaims.email` (not by `sessionClaims.userId`). The `replitUserId` column is populated once on JIT insert to satisfy the NOT NULL constraint; it is never re-synced.

**Why:** The original `upsertUser` used `email` as the conflict target (not the Replit subject ID). Keeping the same bridge column avoids data-model churn and means existing rows are found immediately for migrated users.

**How to apply:** Any future auth middleware or user-lookup code must query `WHERE users.email = sessionClaims.email`. Do NOT use `sessionClaims.userId` for the local DB lookup — that's the Replit/Clerk external ID, not the bridge field for this app.
