---
name: Clerk trust proxy — Replit reverse proxy fix
description: Clerk's handshake returns 426 on Replit unless Express trusts the reverse proxy.
---

# Clerk 426 on Replit — trust proxy required

## The rule

Add `app.set("trust proxy", 1)` to the Express app before mounting `clerkMiddleware`.

**Why:** Replit terminates TLS at the edge and forwards to the server over plain HTTP. Without `trust proxy`, Express reports `req.protocol` as `http`. Clerk's `clerkMiddleware` requires HTTPS for the handshake flow and returns HTTP 426 Upgrade Required when it sees `http` — even if the external-facing URL is `https://`.

**Critical:** Use `1` (number of proxy hops), NOT `true`. `express-rate-limit` v7+ throws `ERR_ERL_PERMISSIVE_TRUST_PROXY` and crashes the server if `trust proxy` is set to `true`. Using `1` satisfies both Clerk and express-rate-limit.

**How to apply:** Any Express server behind Replit's reverse proxy that uses Clerk auth. Must come before `cors`, `clerkMiddleware`, and all other middleware.

```typescript
const app = express();
app.set("trust proxy", 1); // ← required for Replit proxy; use 1, not true
```

The symptom of the 426 is `GET /?__clerk_handshake=... 426 (Upgrade Required)` in the browser console.
The symptom of the wrong value is `ValidationError: ERR_ERL_PERMISSIVE_TRUST_PROXY` crashing the production server.
