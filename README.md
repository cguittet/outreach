# Trucea Outreach Tracker

A small, private relationship tracker for LinkedIn outreach. It combines a focused web dashboard with a Chrome companion that captures only the active profile URL. Profile fields and message events are always confirmed by the user; the extension does not inspect LinkedIn page content or automate sending.

## What is included

- Today queue with overdue, due-now, and upcoming work
- Prospect records, mutual contacts, notes, connection state, and activity timeline
- Editable business-day follow-up sequence with message variables
- Manual sent/reply controls that advance or cancel scheduled work
- Replit Auth owner allowlist
- Replit PostgreSQL migrations with an advisory lock
- Revocable, hashed Chrome-extension pairing tokens
- GitHub Actions and Replit Autoscale configuration

## Repository

```text
apps/web         React dashboard and Express API
apps/extension   Manifest V3 Chrome extension
packages/shared  Validation, URL, template, and scheduling utilities
database         Drizzle schema and SQL migrations
```

## Local development

Requirements: Node.js 22, pnpm 10, and PostgreSQL.

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `DEV_AUTH_EMAIL`, and `ALLOWED_EMAIL`.
2. Export those variables in your shell or use your preferred environment loader.
3. Install dependencies with `pnpm install`.
4. Run `pnpm db:migrate` and `pnpm db:seed`.
5. Start the app with `pnpm dev`, then open `http://localhost:3000`.

`DEV_AUTH_EMAIL` is ignored in production. Production always uses Replit Auth.

## Push to GitHub

Create an empty GitHub repository, then run:

```bash
git add .
git commit -m "Build Trucea outreach tracker"
git remote add origin git@github.com:YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

The CI workflow runs type checks, unit tests, and production builds for every pull request and push to `main`.

## Import and deploy on Replit

1. Open [Replit Import](https://replit.com/import), select GitHub, and choose this repository.
2. Open the Database tool and create the development PostgreSQL database. Replit provides `DATABASE_URL` automatically.
3. Open the Auth tool and enable Replit Auth.
4. Add these Secrets:
   - `SESSION_SECRET`: at least 32 random characters
   - `ALLOWED_EMAIL`: the email on the Replit account allowed to use the app
   - `APP_BASE_URL`: the Preview URL initially, then the published `https://NAME.replit.app` URL
   - `ALLOWED_EXTENSION_ORIGIN`: add after loading the extension, in the form `chrome-extension://EXTENSION_ID`
5. Run `pnpm db:migrate` and `pnpm db:seed`, then verify Preview.
6. Select Publish and use Autoscale. Enable a production database when prompted.
7. Update `APP_BASE_URL` to the published URL and republish.

The deployment startup runs all unapplied migrations before serving traffic. An advisory lock makes concurrent startup safe. Replit injects the correct development or production `DATABASE_URL` for each environment.

## Chrome extension

1. Run `pnpm build:extension`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `apps/extension/dist`.
4. Copy the extension ID and set `ALLOWED_EXTENSION_ORIGIN=chrome-extension://EXTENSION_ID` in Replit, then republish.
5. In the dashboard, open **Extension**, create a pairing token, and copy it immediately.
6. Open the extension, enter the published dashboard URL and token, then approve access to that origin.

The build also produces `apps/extension/trucea-extension.zip`. The ZIP and generated build directory are ignored by Git.

## Database operations

- Apply migrations: `pnpm db:migrate`
- Create the default workflow: `pnpm db:seed`
- Inspect records with Replit's Database tool or Drizzle Studio from Replit

For backup, select the production database in Replit's Database tool and use its export controls. To restore into a new app, provision its database, run migrations, and import the PostgreSQL dump. Never place a dump or live connection string in Git.

## Message variables

Templates support `{{first_name}}`, `{{name}}`, `{{company}}`, and `{{job_title}}`. Business-day delays count Monday through Friday in the timezone selected under Workflow; public holidays are not excluded.

## Security notes

- Only `ALLOWED_EMAIL` can access the dashboard.
- Browser tokens are random, displayed once, stored as SHA-256 hashes, and independently revocable.
- Every query is scoped to the authenticated owner.
- The extension does not read LinkedIn DOM content and performs no automated LinkedIn actions.
- Secrets, database contents, environment files, builds, and extension ZIPs are excluded from Git.
