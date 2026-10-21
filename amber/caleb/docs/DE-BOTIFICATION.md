# De-botification — keeping Camber and Samber calm

Camber (Caleb) and Samber (Sagar) share the same engine. They speak through
the same voice doctrine (`AMBER_VOICE_DOCTRINE_TEMPLATE` in
`Newton/agent/lib/prompts.js`) and the only per-tenant differences are
policy: Camber is hiring-side, Samber is selling-side.

The doctrine governs **LLM** replies. Several outbound paths do not go
through the LLM and historically pulled the tone toward "scheduled
service" rather than "calm presence":

| Path | What it sends | LLM? |
|---|---|---|
| `lib/festival.js` | SAFE keyword reply, substance redirect, first-contact greeting | No (deterministic) |
| `lib/calendar/runtime.js` | Read replies + confirmation prompts | No (deterministic) |
| `lib/checkins.js` | Morning / evening / Sunday check-in prompts | No (deterministic) |
| `lib/proactive-runner.js` | Daily context nudge + dormant-contact outreach | Yes, but ungated |

This change adds two small adapters that keep all four paths in line with
the voice doctrine and put the scheduled traffic behind per-tenant
preferences.

---

## 1. `lib/voice-guard.js` — deterministic copy guard

`humanize(text)` is a pure post-processor that strips the small set of
phrases that consistently make Camber/Samber feel robotic:

- `"As an AI, ..."` / `"I'm just an AI"` disclaimers
- `"Let me know if you need anything"`, `"Is there anything else?"`,
  `"Happy to help"`, `"Hope this helps"` (service-desk closers)
- `"I apologize for any..."` / `"Sorry for the inconvenience"`
- `"Feel free to ..."` openers
- Em-dashes (`—` → `, ` per house style)
- Exclamation / question-mark spam (`!!!` → `!`)

`humanize()` is wired into:

- `lib/festival.js` — `buildSafeKeywordReply`, `buildSubstanceRedirectReply`,
  `buildFirstContactGreeting`
- `lib/calendar/runtime.js` — both read and confirmation replies
- `lib/checkins.js` — `buildMorningPrompt`, `buildEveningPrompt`,
  `buildSpiritualPrompt`
- `lib/proactive-runner.js` — Claude-authored proactive nudges + outreach
  messages

For development you can opt in to strict mode:

```
AMBER_STRICT_VOICE=1
```

…which makes `assertHumanReply()` throw if a botty phrase slips through.
Production never crashes on a copy regression — it just gets scrubbed.

---

## 2. `lib/proactive-prefs.js` — scheduled service gating

Three independent gates, each resolved in this precedence:

1. `tenant.preferences.proactive.<key>` (per-tenant, set via amber-id)
2. `process.env.AMBER_PROACTIVE_<KEY>` (deploy-time global)
3. default

| Gate | Tenant pref | Env var | Default |
|---|---|---|---|
| Morning / evening / Sunday check-ins | `checkins` | `AMBER_PROACTIVE_CHECKINS` | **on** |
| Claude "did you check your health / project nudge" | `contextNudge` | `AMBER_PROACTIVE_CONTEXT_NUDGE` | **off** |
| Dormant-contact outreach batch | `outreach` | `AMBER_PROACTIVE_OUTREACH` | **off** |

Truthy: `1` / `true` / `on` / `yes`. Falsy: `0` / `false` / `off` / `no`.
Any other string falls back to the default.

### Critical: SAFE / crisis paths are NOT gated

The SAFE keyword, substance redirect, urgent substance signal, crisis
detection, and first-contact greeting all run from `agent.js` on inbound
text and never go through `proactive-prefs`. Even when a tenant has
turned every scheduled gate off, they still get harm-reduction support
and the first-contact greeting.

### Example tenant preference (set in amber-id)

```jsonc
{
  "preferences": {
    "proactive": {
      "checkins": true,         // keep the morning/evening rhythm
      "contextNudge": false,    // no Claude-authored nudge messages
      "outreach": false         // no outbound to dormant contacts
    }
  }
}
```

### Example deployment env to quiet everything except check-ins

```
AMBER_PROACTIVE_CHECKINS=true
AMBER_PROACTIVE_CONTEXT_NUDGE=false
AMBER_PROACTIVE_OUTREACH=false
```

---

## Why these defaults

The user feedback driving this change: "too many scheduled services;
Samber/Camber are coming across as botty." The defaults reflect that:

- Check-ins are the original product surface
  (`docs/CHECKIN-PRODUCT.md`) and ship enabled.
- The Claude-authored context nudge and the dormant-contact outreach
  batch are the two surfaces that most often produced
  unwanted-scheduled-service traffic, so they are now opt-in.
- The voice guard runs unconditionally on every deterministic path so
  Camber/Samber never close a reply with "Let me know if you need
  anything else!"

If you need to disable a check-in surface for one tenant without
touching the env, set their `preferences.proactive.checkins = false`
through amber-id. The next scheduler tick will see it.

---

## Files added / changed

- `Newton/agent/lib/voice-guard.js` (new)
- `Newton/agent/lib/proactive-prefs.js` (new)
- `Newton/agent/lib/festival.js` (wired humanize into all 3 deterministic replies)
- `Newton/agent/lib/calendar/runtime.js` (wired humanize into reply paths)
- `Newton/agent/lib/checkins.js` (humanize prompts + gate via `isCheckinSchedulerEnabled`)
- `Newton/agent/lib/proactive-runner.js` (humanize outbound + per-tenant gates)
- `Newton/agent/lib/__tests__/voice-guard.test.mjs` (new, 18 tests)
- `Newton/agent/lib/__tests__/proactive-prefs.test.mjs` (new, 14 tests)
