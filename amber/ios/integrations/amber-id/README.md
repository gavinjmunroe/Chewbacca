# Local event discovery integration

The mobile web-event modal calls authenticated `GET /v1/me/discovery/events?q=…&city=…`.
`serp-events.mjs` is a server-only adapter prepared for Amber ID; it is **not mounted or deployed**. The backend checkout is currently made of iCloud placeholders and cannot be read reliably.

Once Amber ID is downloaded:

1. Read its AGENTS.md and existing session/rate-limit conventions.
2. Move this adapter into the backend and mount `createLocalEventsHandler` at the path above. Inject the actual session verifier (`authenticate(req) -> owner ID`) and per-owner rate limiter. The factory refuses to initialize without both.
3. Supply `SERPAPI_API_KEY` from server environment only. Never put it in an `EXPO_PUBLIC_*` variable or the iOS bundle.
4. Run these tests plus authenticated route tests, then verify a real city search. The adapter requests `engine=google_events`, preserves provider date text, deduplicates results and only returns HTTPS sources. It does not create calendar events or purchase tickets.

Run fixture checks: `node --test integrations/amber-id/serp-events.test.mjs`.

Source: https://serpapi.com/google-events-api

# Contact enrichment and billing

The web-contact modal uses the existing authenticated `streamChat` web search and its sourced `web_people` cards. It shows work email, personal email, phone and LinkedIn when provided; unavailable fields remain unavailable. This has not been authenticated end-to-end in this session.

`Add · $1` / `Enrich · $1` currently opens a review. Live purchases are deliberately unavailable; there is no charge, fabricated receipt, or unpriced write. In the isolated design preview, a separate `Confirm sample add · $0` updates the in-memory circle.

To enable paid enrichment, settle the requested credit-vs-per-contact model, configure the iOS billing product and server receipt verification, then implement a server-issued price quote and idempotent purchase/enrichment transaction. The backend must validate the candidate identity, reject duplicate purchases, charge only under the agreed fulfillment/refund policy, merge the saved contact and return the actual fields delivered. A $1 label does not guarantee every contact has every field available.
