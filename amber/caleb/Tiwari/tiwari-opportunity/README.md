# tiwari-opportunity

**Sequencing primitive** — right info, right moment.

In the yoga model, `tiwari-opportunity` is the **devotional delivery layer**
(bhakti). PeopleRank surfaces *who*. Enrich fills in *what*. Opportunity decides
*when* and *how* to tell you.

## What it does

Given a trigger — a daily digest tick, a calendar event coming up, an iMessage
that just landed, an unfinished thread — it:

1. Composes a people-centric question from the trigger context
2. Asks `amber-id /ask` (which already blends the user's private KB with
   togari-PeopleRank signal)
3. Enforces **billing gates** for paid channels (iMessage / SMS concierge)
4. Packages the answer as a channel-appropriate payload (push, email, iMessage, SMS)

## Contract

```js
import { sequence } from "./index.js";

const result = await sequence({
  trigger: {
    type: "daily_digest" | "calendar_event" | "missed_conversation" |
          "imessage_reply" | "arbitrary_prompt",
    context: "human phrasing of the trigger",
    at: "2026-04-18T14:00:00Z",     // optional
    channel: "push" | "imessage" | "sms" | "email",
  },
  userCnft: "...",                    // required — sequencing is always personal
  token: "<Privy JWT>",               // required
  entitlements: {                     // enforced for paid channels
    imessage_concierge: true,
    sms_concierge: false,
  },
  options: { topK, timeoutMs, style, title },
});
```

Return envelope (shared across all Tiwari services):

```js
{
  ok: true,
  source: "blended" | "amber-id" | "empty" | "billing-gate",
  results: [payload],    // channel-shaped payload (push/imessage/sms/email)
  personalized: true,
  tookMs: 842,
  warnings: [],
  citations: [...],
}
```

## Billing gates

These channels **require** the corresponding entitlement in the request —
callers (amber-agent routes) are responsible for looking the entitlement up
from the user's subscription state and passing it in.

| Channel    | Entitlement key        | Tier           |
| ---------- | ---------------------- | -------------- |
| `push`     | —                      | Free           |
| `email`    | —                      | Amber Plus     |
| `imessage` | `imessage_concierge`   | Amber iMessage |
| `sms`      | `sms_concierge`        | Amber iMessage |

If the gate is not met, `sequence` returns `{ ok: false, source: "billing-gate",
error: "entitlement_required" }` — **no LLM call is made** — and the agent
route translates this into a 402 Payment Required response.

## Relationship to togari

`togari-opportunity` (internal name `togari-clay`) is the production
Opportunity Engine V2 MCP server the BMA team ships. It runs on its own
Railway service and owns BigQuery signal subscriptions, Clay enrichment
pipelines, Stripe metered billing, and outreach drafting for B2B clients.

We vendor it at `vendor/togari/` (pinned SHA) and call its direct-api HTTP
surface via `src/togari-adapter.js`. Trigger types `signal_scan`,
`signal_subscription`, and `data_pull` route through togari-opportunity.
All other trigger types (daily_digest, calendar_event, missed_conversation,
imessage_reply, arbitrary_prompt) route through amber-id `/ask` so the
personal side of the network gets the same treatment.

Every togari call is enriched with amber-id personal context by default
(turn off with `options.includePersonalContext = false`).

## Files

- `index.js` — `sequence()` entry point
- `src/togari-adapter.js` — typed HTTP client for the togari-opportunity
  direct-api surface (ping, signal create/trigger/results, data pull)
- `vendor/togari/` — git submodule pinned to a reviewed SHA of
  `amber-organization/togari-opportunity`
