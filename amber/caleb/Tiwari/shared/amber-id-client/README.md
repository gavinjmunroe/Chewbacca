# shared/amber-id-client

HTTP client for the sibling [amber-id](https://github.com/amber-organization/amber-id) service. Every Tiwari service that wants to blend personal, cNFT-gated context calls this module.

## Why this exists

amber-id is deliberately a separate repo: it's deployed on its own Railway service with its own Privy + Pinecone + Solana configuration. We never mirror its source into this monorepo — that would invite drift. Instead, this client is the **integration contract**: one place where amber-id's HTTP surface is typed, retried, and audited.

## Usage

```js
import amberId from "../../shared/amber-id-client/index.js";

// iOS onboarding: mint a cNFT for a newly-onboarded user
const { cnftMint, assetId, signature } = await amberId.mintIdentity({
  token: userPrivyJwt,
  ownerPubkey: userSolanaWallet,
});

// tiwari-opportunity: generate a people-first answer for a push notification
const { answer, people, citations } = await amberId.ask({
  token: userPrivyJwt,
  question: "Who from my network is in SF next week?",
});

// tiwari-enrich: read the user's private notes about a known contact
const { matches } = await amberId.query({
  token: userPrivyJwt,
  text: `What do I know about ${contact.name}?`,
  topK: 8,
});
```

## Auth summary

| Call | Who sends what |
|---|---|
| `mintIdentity`, `getIdentity`, `ingest`, `query`, `forget`, `stats`, `ask` | User's Privy JWT (Bearer) |
| `verifyIdentity`, `status` | Public |
| `resolveTenant` | `AMBER_ID_API_KEY` (server-to-server only) |

## Errors

Every non-2xx response throws `AmberIdError` with `.status`, `.code`, `.body`. Callers should handle:

- `401 / auth_required` — token missing or expired; bounce user to re-auth.
- `412 / cnft_required` — user hasn't minted their Amber Identity yet; route them to onboarding.
- `429` — upstream rate limit; surface a "try again in a moment" to the user.
- `5xx` — upstream down; Tiwari services should fall back to togari-only or newton-only results.

## Env

```
AMBER_ID_BASE_URL=https://amber-id-production.up.railway.app
AMBER_ID_API_KEY=                  # only needed for server-to-server admin calls
AMBER_ID_TIMEOUT_MS=8000
```
