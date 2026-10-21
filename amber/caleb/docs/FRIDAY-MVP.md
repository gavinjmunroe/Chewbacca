# Friday MVP — festival / event safety surface

The narrow Friday cut is a **living contact-card follow-up loop** for the
weekend (USC graduation, EDC, Lightning in a Bottle). The job is cheap,
real-user proof through iMessage, not a super-app. Camber (Caleb) and Samber
(Sagar) run on the same engine — tenant profile decides the agent name and
context, nothing is Sagar-only.

## What's in

Three deterministic, pre-LLM handlers in
[`Newton/agent/lib/festival.js`](../Newton/agent/lib/festival.js), wired into
the inbound flow in `agent.js` right after the opt-out block, before crisis
detection:

1. **SAFE keyword** — bare-word `SAFE` (in any case, with surrounding
   punctuation) triggers a short harm-reduction script: hydrate, find
   trusted friend / medical tent / security, line up a rideshare home, and
   call 911 / get to medical for real emergencies. Never sources, doses, or
   offers medical advice. No external URLs.

2. **Substance mention redirect** — when a DM mentions MDMA, LSD, shrooms,
   ketamine, coke, GHB, 2C-x, DMT, benzos, meth, or substance-talk phrasing
   (dose / dropping a tab / where to cop), we deflect to safety + general
   DanceSafe-style "test substances, never use alone, pace yourself" caution
   + the SAFE pull-cord. Urgent signals (overdose, unresponsive, can't
   breathe, blue lips, bad trip) get a shorter "go to medical / call 911
   now" variant.

3. **First-contact greeting + first-name gate** — for brand-new DM contacts
   (no `displayName`, `messageCount <= 1`, not the tenant owner), the first
   reply is a warm, radiant, protective opener that asks for the first
   name before going deeper. It also surfaces the SAFE pull-cord on
   message one. State is persisted on the contact profile via
   `festivalGreetedAt`. Subsequent replies attempt to extract a first
   name (`extractFirstNameFromReply`) and persist it as `displayName`
   so deeper conversation can continue.

Tone for the festival/social opener: **devotional joy, care, and radiance**,
not romantic escalation. Women should feel safer, not targeted. The copy
explicitly avoids `babe / sexy / beautiful / gorgeous / date / hook up /
hang alone`-style language (test-enforced).

## What's out of scope (do not add to this PR)

- Maps / location-based features
- Bitchat / mesh / off-grid messaging
- Blockchain or crypto payments
- Agentic web / network search inside SAFE flow
- Sourcing, dosing, drug-combo, or any clinical advice
- External URLs in any festival reply
- Any tenant-specific (Caleb-only / Sagar-only) hardcoding — the only
  Sagar-named artifacts are existing fixtures / test data

## Friday smoke tests

Run from the repo root:

```bash
node --test Newton/agent/lib/__tests__/festival.test.mjs
```

Expected: 19/19 pass. Coverage:

- `SAFE` keyword matcher (positive cases + prose false-positive guard)
- `SAFE` reply content (hydration / friend / rideshare / 911 beats, no
  dosing, sourcing, or external URLs)
- Substance detection across common festival substances + phrasing
- Urgent substance signals (overdose / unresponsive / can't breathe etc.)
- Substance redirect copy: no sourcing, dosing, medical advice; urgent
  variant points to 911 / medical
- First-contact greeting gate (new contact qualifies; known name / already
  greeted / existing conversation / group / owner all skip)
- First-contact greeting copy is warm, name-asking, NOT romantically loaded
- First-name extraction pulls real names and rejects non-names (`yes`,
  `idk`, agent names, the SAFE keyword, etc.)
- End-to-end: no festival reply path facilitates drug use

### Manual smoke checklist (Friday morning)

In a staging Loop sender, from a fresh phone number:

1. Send `hey` → should receive first-contact greeting that asks for name.
2. Reply `I'm Maya` → contact's `displayName` should become "Maya" and the
   next message routes to the normal LLM path.
3. From a separate fresh number, send `where can I get molly` → should
   receive substance redirect, no sourcing.
4. Send `SAFE` → should receive harm-reduction script.
5. Send `my friend is unresponsive` → urgent variant of substance
   redirect (911 / medical now).
6. Confirm: switch tenant from Caleb to Sagar in the resolver, the same
   replies fire — only the agent name in the first-contact greeting
   differs ("Camber" vs "Samber").

## Follow-up (post-Friday)

- Persistent storage of `festivalGreetedAt` and `displayName` works through
  the existing amber-id contacts seam (`loadContact` / `saveContact`). No
  schema migration needed for the MVP.
- If `loadContact` / `saveContact` are unavailable (no amber-id configured),
  the gate falls back to the in-memory contact cache for the duration of
  the process — adequate for the weekend, not durable. Future work: ensure
  amber-id is provisioned on the production deploy before the weekend
  begins.
- Consider a per-event manifest (`event: edc-2026`, `event: lib-2026`) so
  the first-contact greeting can tailor the opener to the specific
  weekend. Out of scope for this PR.
