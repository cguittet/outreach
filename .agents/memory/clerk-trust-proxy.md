---
name: Clerk trust proxy — Replit reverse proxy fix
description: Clerk's handshake returns 426 on Replit unless Express trusts the reverse proxy.
---

# Clerk 426 on Replit — trust proxy required

## The rule

Add `app.set("trust proxy", true)` to the Express app before mounting `clerkMiddleware`.

**Why:** Replit terminates TLS at the edge and forwards to the server over plain HTTP. Without `trust proxy`, Express reports `req.protocol` as `http`. Clerk's `clerkMiddleware` requires HTTPS for the handshake flow and returns HTTP 426 Upgrade Required when it sees `http` — even if the external-facing URL is `https://`.

**How to apply:** Any Express server behind Replit's reverse proxy that uses Clerk auth. Must come before `cors`, `clerkMiddleware`, and all other middleware.

```typescript
const app = express();
app.set("trust proxy", true); // ← required for Replit proxy
```

The symptom is `GET /?__clerk_handshake=... 426 (Upgrade Required)` in the browser console, visible both in the preview iframe and in a direct browser tab.
