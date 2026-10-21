# Privy auth in medha-id — what to import where

This file is the single source of truth for how the dedup workstreams hook
into amber-id's existing Privy authentication. WS-2 (api-keys + privy-bridge)
and WS-4 (api-keys-routes + magic-link-routes) read this first so the dedup
side stays decoupled from medha-id's auth internals.

DO NOT duplicate Privy infra into `dedup/auth/`. Re-export from here.

## What exists in medha-id today

- **`@privy-io/server-auth ^1.17.1`** — already in `package.json` deps. No
  install needed.
- **`src/lib/privy.js`** — owns the Privy client + the auth preHandler.
  Key exports the dedup side will use:
  - `requireAuth(request, reply)` — the Fastify preHandler that validates
    the inbound Authorization Bearer JWT against Privy, sets
    `request.privyUser` (the verified Privy user object including the DID),
    and throws/sends 401 on failure. THIS is what tabs 2 and 4 wrap.
  - `verifyToken(token)` — lower-level: takes a raw JWT string, returns
    the verified token claims or throws. Use this only if you need to
    verify a token outside the request lifecycle.
  - `getPrivyClient()` — accessor for the singleton Privy client.
  - `getUserByDid(did)`, `getUserByEmail(email)` — Privy user lookups.
  - `normalizePhone(raw)` — phone E164 normalizer (handy for matcher
    inputs).
- **`src/lib/auth.js`** — owns API-key auth + a mixed preHandler:
  - `requireApiKey(request, reply)` — validates the org-level service
    key (e.g. medha-agent calling medha-id). Sets `request.clientId`.
    NOT the same as the per-user `tgi_live_*` keys WS-2 is building.
  - `requireApiKeyOrAuth(request, reply)` — accepts either the org
    service key OR a Privy Bearer JWT. If Privy wins, sets
    `request.privyUser` exactly like `requireAuth` does.
  - `validateDid(value)`, `validatePhone(value)`, `validateUserId(value)`
    — shared validators.

## What to import from `dedup/auth/privy-bridge.ts` (WS-2)

```ts
// dedup/auth/privy-bridge.ts (WS-2 owns)
//
// Thin re-export so dedup routes don't reach across the codebase to
// medha-id's src/lib/. If medha-id ever refactors privy.js's location
// or signature, only this bridge changes.

export {
  requireAuth as validatePrivyToken,
  verifyToken,
  getPrivyClient,
  getUserByDid,
  getUserByEmail,
} from "../../src/lib/privy.js";
```

Why the rename `requireAuth -> validatePrivyToken`: amber-id's `requireAuth`
is the framework-style name (it preHandlers a Fastify request). The dedup
spec consistently calls it `validatePrivyToken` in WS-2/WS-4 prompts, so
the bridge aliases it to match.

## How WS-4 mounts a Privy-gated route

```ts
import { validatePrivyToken } from "../auth/privy-bridge.js";

app.post(
  "/api/v1/keys",
  { preHandler: validatePrivyToken },
  async (request, reply) => {
    const did = request.privyUser.id; // Privy's user object exposes `.id` as the DID
    // ... issueKey(did, body.name) etc.
  },
);
```

## What WS-7 wires into `src/index.js`

Nothing new for Privy itself — `requireAuth` already lives in `src/lib/privy.js`
and is already imported elsewhere in the codebase. WS-7 only adds the
`registerDedup(fastify)` call which mounts the dedup routes (each of which
already imports `validatePrivyToken` via the bridge).

## DID extraction reference

`request.privyUser` shape after `requireAuth` resolves (per Privy docs):

```
{
  id: "did:privy:abc123...",       // the DID — primary key for owner_did
  linkedAccounts: [...],
  // other Privy fields
}
```

Use `request.privyUser.id` as `owner_did` everywhere. Do NOT trust any DID
that arrives in the request body or query — only the validated one from
the bearer token.

## TLDR for tabs 2 + 4

- Import `validatePrivyToken` from `dedup/auth/privy-bridge.ts`
- Use it as `{ preHandler: validatePrivyToken }` on every user-gated route
- Read the DID from `request.privyUser.id`
- For per-user keys: that DID IS your `owner_did`
