# Medha in-app (iOS) handoff: caller_not_provisioned

**Owner of remaining work:** Karthik (medha-id `/v1/me` identity resolution)
**Date:** 2026-06-02
**Status:** 2 of 3 layers fixed and shipped. One medha-id change remains.

---

## TL;DR

In-app Medha showed "Something went wrong. Try again." for every message. Three
separate bugs were stacked. Two are fixed and deployed. The last one is a
medha-id `/v1/me` gap that only Karthik should land.

| #   | Layer               | Bug                                                                                                                                                                                                     | Status                             |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | medha-platform auth | `/api/v1/quick-call/stream` gated on `requirePrivyAuth` (Privy ES256 only). The app sends a medha-id **session JWT** (OTP login), which Privy verification rejects with 401 before the agent runs.      | FIXED + deployed                   |
| 2   | amber-ios client    | `askMedha` read the SSE stream with React Native's global `fetch`, whose `res.body` is always `null`, so it could never read the stream (emitted `http_200`).                                           | FIXED + pushed (needs iOS rebuild) |
| 3   | medha-id `/v1/me`   | For an OTP/session-token caller, `/v1/me` returns the profile but with `phoneNumber: null` and `loopSenderId: null`, so medha-platform returns `caller_not_provisioned` (424) and the agent never runs. | **OPEN, needs Karthik**            |

---

## How in-app Medha is supposed to work

1. App (`lib/agent.ts` -> `askMedha`) POSTs `{ text }` + `Authorization: Bearer <session JWT>` to
   `medha-platform /api/v1/quick-call/stream` and reads an SSE stream.
2. medha-platform authenticates the caller and resolves their **phone** + **loop sender** from
   medha-id `/v1/me`, synthesizes a Loop-shaped webhook (`contact = phone`, `sender = loopSenderId`),
   and runs it through the same agent loop iMessage uses, capturing the reply and streaming it back as SSE.

iMessage works because its real Loop webhook already carries `sender` + `contact`. The in-app path
has to reconstruct that identity from the caller's token, which is where it breaks.

---

## Root cause of the remaining bug (proven, not guessed)

The iOS app authenticates with a **warm-OTP flow**
(`amber-ios/apps/mobile/lib/auth.ts` -> medha-id `/v1/auth/verify-code-only`). The token it stores and
sends is a **medha-id session JWT**: HMAC-signed, `sub = person_id = sha256(E.164(phone)).slice(0,32)`,
plus a `phone` claim. It is NOT a Privy token.

medha-id `requireAuth` (`src/lib/privy.js`) accepts that token and sets
`request.privyUser = { userId: person_id, phone: <verified phone>, source: "medha-id" }`.

But `GET /v1/me` (`src/routes/profile.js`, ~line 76) derives phone/loop sender like this:

```js
const user = await getUserByDid(privyDid); // privyDid = person_id (phone hash), NOT a Privy DID
const tenant = userToTenant(user);
phoneNumber = tenant.phoneNumber || null; // null: no user doc under the person_id key
loopSenderId = tenant.loopSenderId || null; // null
```

The tenant is keyed by the Privy DID (`did:privy:...`), not by the OTP `person_id`, so
`getUserByDid(person_id)` misses and both fields come back null. medha-platform's
`fetchCallerIdentity` then returns `{ ok:false, status:424, error:"caller_not_provisioned" }`.

### Proof (live trace, captured 2026-06-03)

medha-platform has a temporary admin-readable trace at `GET /debug/qc-trace` (X-Admin-Token).
A real in-app send after the auth fix produced:

```
/quick-call/stream: request arrived, soft Privy auth
/quick-call/stream: soft auth done did=—            <- medha session token, no Privy DID, NO LONGER rejected
/quick-call/stream: handler reached, resolving identity
resolve: tokenPresent=true amberIdUrl=https://medha-id-production.up.railway.app verifiedDid=—
/v1/me result: ok=false status=424 error=caller_not_provisioned hasPhone=false hasLoopSender=false did=—
/quick-call/stream: identity NOT ok -> status=424 error=caller_not_provisioned (agent will NOT run)
```

### The data exists; only `/v1/me` fails to use it

Caleb's phone resolves to a fully provisioned tenant via the service-key route:

```
GET /tenants/resolve?phone=+15550100002  ->
  did:        did:privy:cmo0ay9oy001u0cl7h1wb7thy
  phoneNumber:  +15550100002
  loopSenderId: c351f20c-dec0-44b3-8127-55b662e237a6   (loopSenderPhone +15550100003)
```

`/v1/me` already holds the verified phone in `request.privyUser.phone`. It just never resolves the
tenant by phone.

---

## The remaining fix (medha-id `src/routes/profile.js`, `GET /v1/me`)

When phone/loop sender come back null, fall back to resolving the tenant by the verified session
phone, using the same in-memory index `/tenants/resolve?phone=` uses.

Add the import (top of `profile.js`):

```js
import { requireAuth, getUserByDid, tenantIndex } from "../lib/privy.js";
import { userToTenant } from "./tenants.js";
```

Then, right after the existing `getUserByDid` block that may leave `phoneNumber` / `loopSenderId` null:

```js
// OTP / medha-id session callers are keyed by person_id (phone hash), so the
// getUserByDid lookup above misses the Privy-DID-keyed tenant and returns null
// phone + loop sender. The session is already verified and carries the phone
// (request.privyUser.phone), so resolve the owner tenant by phone the same way
// GET /tenants/resolve?phone= does. Without this the in-app agent path 424s
// (caller_not_provisioned) and never runs.
if ((!phoneNumber || !loopSenderId) && request.privyUser?.phone) {
  const match = tenantIndex.getByPhone(request.privyUser.phone);
  if (match) {
    const t = userToTenant(match);
    phoneNumber = phoneNumber || t.phoneNumber || request.privyUser.phone;
    loopSenderId = loopSenderId || t.loopSenderId;
  }
}
```

Notes:

- `tenantIndex.getByPhone` is already exported from `src/lib/privy.js` and is populated (it returned
  Caleb's tenant above). `userToTenant` is exported from `src/routes/tenants.js`.
- This is **additive**: it only fills fields that were already `null`. It does not change the response
  shape and does not touch any iMessage / webhook code path (the iMessage flow never calls `/v1/me`).
- Watch for a circular import between `profile.js` and `tenants.js`. If it bites, move `userToTenant`
  into a small shared module (e.g. `src/lib/tenant-shape.js`) and import it from both, or inline the
  three fields you need from `decodeMetadata(match.customMetadata)`.

---

## Verify the fix (no app rebuild needed for the server half)

After deploying the medha-id change, have Caleb send one in-app Medha message, then:

```bash
cd <medha-platform>
ADMIN=$(railway variables --kv | grep '^ADMIN_TOKEN=' | cut -d= -f2-)
curl -s -H "X-Admin-Token: $ADMIN" \
  https://medha-platform-production.up.railway.app/debug/qc-trace
```

Success looks like:

```
/v1/me result: ok=true ... hasPhone=true hasLoopSender=true ...
/quick-call/stream: identity OK, dispatching agent
/quick-call/stream: onMessage segment len=...
/quick-call/stream: settled fullLen=>0 hadError=false dispatchDone=true
```

The reader CLI `railway logs -d` was returning a stuck boot snapshot during this work, which is why the
admin `/debug/qc-trace` ring buffer was added. Prefer that endpoint over the log CLI for verification.

---

## Cleanup once verified (medha-platform)

The temporary instrumentation in `medha-platform Newton/agent/lib/server.js` is tagged `[qc-debug]` and
must be removed after the medha-id fix is confirmed:

- the `QC_TRACE` array + `qcTrace()` helper (next to `RECENT_WEBHOOKS`)
- every `qcTrace(...)` call in `resolveQuickCallIdentity` and the `/api/v1/quick-call/stream` handler
- the `GET /debug/qc-trace` endpoint inside the `/debug/` block

`git grep -n "qc-debug" Newton/agent/lib/server.js` finds all of it. The auth fix itself
(`softPrivyAuth` + removing the hard `requirePrivyAuth` gate) is permanent, keep it.

---

## Ship the iOS client (item 2)

The client fix is on `amber-organization/amber-ios` `main`
(commit `c933053`, "stream Medha via expo/fetch ..."). It needs a build to reach the device:

```bash
cd <amber-ios>/apps/mobile
eas build --platform ios --profile production    # then eas submit, or TestFlight
```

EAS / ASC details (from prior sessions): ascAppId `6774023666`, ASC API key at
`~/.appstoreconnect/private_keys/AuthKey_BUU5Z6J9GL.p8`.

Until item 3 lands, the app will show the "Finish setting up Medha" onboarding gate (the client now maps
`caller_not_provisioned` to that gate instead of the generic error). After item 3, it streams the real reply.

---

## What was already changed (do not redo)

**medha-platform** (`Newton/agent/lib/server.js`, deployed to prod):

- Replaced the hard `requirePrivyAuth` gate on the three in-app endpoints
  (`/api/v1/quick-call`, `/api/v1/quick-call/stream`, `/api/v1/togari/message`) with `softPrivyAuth`,
  which captures a Privy DID when present but does NOT reject a medha-id session JWT. medha-id `/v1/me`
  is now the authoritative auth gate for these endpoints (it accepts both token families). Commit
  `dbd8ea7`.

**amber-ios** (`apps/mobile`, pushed to main, commit `c933053`):

- `lib/agent.ts`: `askMedha` now streams via `import { fetch } from 'expo/fetch'` (SDK 54, native iOS
  module, real `ReadableStream` body) instead of RN's global `fetch` (null body).
- `components/AgentChat.tsx`: `caller_not_provisioned` now maps to the identity onboarding gate;
  auth codes (`invalid_privy_token`, `missing_bearer`, `amber_id_rejected_token`, ...) map to re-auth;
  `agent_failed` / `amber_id_*` map to a friendly retry instead of the generic "Something went wrong".

---

## Open product nuance (flag for Caleb + Karthik, not a blocker)

Caleb's only provisioned tenant is `did:privy:cmo0ay9oy...` with `displayName: "Togari"` and
`loopSenderPhone +15550100003`. The in-app **Medha** tab will therefore dispatch under that tenant /
sender. If Medha vs Togari should be distinct tenants/personas per user, decide how the in-app Medha tab
selects the sender (per-user single tenant per the "1:1 dedicated number" vision, vs a fixed
`MEDHA_EXPERT_SENDER_ID`). Not required to make the agent respond; required to get the persona/number right.
