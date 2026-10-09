---
name: feedback_prove_it_on_prod
description: 'A client-facing button or send is "working" only after a real request hits production and its effect is read back; handler-level tests hid two dead paths on Zeutara.'
metadata:
  node_type: memory
  type: feedback
  originSessionId: 380d5ca0-cf58-46a3-9497-41e9d7e2940e
  modified: 2026-10-09T10:07:48.191Z
---

Zeutara, 2026-10-08/09. Caleb: "I lost so much aura on the call when the buttons didn't do jack." Two paths that had passing tests were dead in production: the Good fit button (server.ts only routed `smartlead_*` clicks; tests called the handler directly) and the Slack Send button (its Clay hook pointed at an empty "Pull in data from a Webhook Table" that had never received a row, so no reply had ever gone out through it).

**Why:** tests that start below the entry point can't see routing or wiring, and a webhook that answers 200 proves nothing about what happens after.

**How to apply:** before telling Caleb something client-facing works, push one real request through the front door and read the effect back. Recipes that worked: a Slack-signed `block_actions` POST to `/slack/interactivity` (signing secret via `railway run`, dummy lead, response_url at httpbin) then `railway logs` for the handler line; a Clay workflow run with a harmless target (blocklist `…@example.invalid`, forward to Caleb's own inbox) then `clay workflows runs list` and the Clay thread. Say plainly which step only the client can exercise. Related: a private note, [[feedback_automation_runs_on_server]], [[feedback_a_silent_guard_proves_nothing]].
