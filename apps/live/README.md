# Chewbacca Live

A client asks a question about their outreach and watches the answer build:
headline tiles, reply rates with their uncertainty, the replies themselves,
what is waiting on them. Every number comes from a source at question time and
carries its source and age underneath. Read only: nothing on the page sends,
saves or changes anything.

Live for BMA's client Zeutara at https://live-production-fce0.up.railway.app
(service `live` in the chewbacca-team Railway project, deployed with
`railway up` from this folder, like apps/team-web).

## How an answer is made

- **Tier 0.** The suggestion chips and questions shaped like them ("how did
  this week go", "which campaign is working", "what needs me", "who replied
  about Ivy") run a fixed plan of views. No model, about a second.
- **Tier 2.** Anything else goes to the model with the same read-only tools.
  It answers by naming views; code fills every view from the data. Its one
  paragraph of prose passes `lib/rules.js`: a number must be one a source
  returned, nobody is "interested" unless a reply says so, no process talk,
  full words. A refused sentence gets one rewrite, then is dropped.
- Blocks are a closed catalog (`lib/blocks.js`), each mapped to a Kyber HUD
  component, and `public/render.js` draws nothing it does not know.

## Where the data comes from

| Source | What | How it stays fresh |
| --- | --- | --- |
| Togari (`TOGARI_BASE_URL`) | clients, briefs, replies and what Togari did, follow ups, decks | read at question time from `GET /api/v1/portal/live` |
| Clay | sends, delivery, replies, bounces per campaign, 7 days and all time | `agent/live-stats-sync` on a Mac signed in to Clay; reads every 10 minutes and on demand when a question finds numbers older than that |

Clay's public API has no campaign endpoints, so campaign numbers need a
signed-in Clay session. A question with stale numbers asks the agent for a
refresh, waits up to 35 seconds, and otherwise shows the cached numbers with
their real age. With the Mac asleep the page says the Clay connection is
offline instead of inventing anything.

Rates are per email sent, with a Wilson 95% interval. A campaign is called
ahead or behind only when its interval clears another's; the rest are "too
early to tell". Bounces over 5% of sends are flagged.

## Access

A private link `/in/<token>` signs one person in to one client for 30 days.
Only `sha256(token)` lives in `LIVE_ACCESS`, as
`{"<hex>": {"client": "zeutara", "who": "Jonah"}}`. Remove a line to cut a
link off.

## Running it

```
LIVE_DEV=1 TOGARI_BASE_URL=... TOGARI_API_KEY=... node server.js
LIVE_URL=http://127.0.0.1:3000 LIVE_SYNC_KEY=... python3 agent/live-stats-sync --once
agent/install            # the sync as a launchd agent on this Mac
node --test test/live.test.js && python3 test/test_agent.py
```

Variables: `SESSION_SECRET` (32+ characters), `LIVE_SYNC_KEY`,
`LIVE_ACCESS`, `TOGARI_BASE_URL`, `TOGARI_API_KEY`, `ANTHROPIC_API_KEY`,
optional `LIVE_MODEL`.

All glory to God! ✝️❤️
