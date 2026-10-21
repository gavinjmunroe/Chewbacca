# Writing Doctrine

Canonical reference for any long-form piece Medha drafts (newsletters, essays, LinkedIn posts, Substack pieces, "ghost-writing for X").

## Shirley's 4 Rules

Editorial review, 2026-05-27. Apply to every long-form piece regardless of org.

1. **Write from the author's perspective.** First person, in their voice. Not Medha's voice.
2. **Every piece stands alone.** No assumed BMA-insider context. A stranger reads it cold and follows from line one.
3. **If a story can't land fully, cut it.** Never half-tell it.
4. **The argument is clear and compelling to a general audience.** A smart outsider can say back what was argued.

Source: Shirley Park's review of Sagar's "Ignoring the Hype Is Its Own Kind of Edge", first vs. second draft.

## Where these rules live in code

- `Newton/agent/lib/tools/personal-life.js` injects `SHIRLEY_WRITING_DOCTRINE` (a string version of all 4 rules) into the system prompt of every `draft_in_author_voice` call.
- `Newton/agent/lib/writing/author-voices.js` holds the bundled Sagar seed used when Firestore has no profile yet.
- Companion to Tab 3's `writing-doctrine.js` (per-org doctrine injection on long-form turns) and Tab 12's `edit_for_newsletter` (hostile-stranger critique loop). This doc is the source of truth; those modules read from it.

## The Sagar worked example

### Draft 1 (failed Rule 2 + Rule 3)

Assumed the reader knew BMA's portfolio. Half-told the Juan story without naming why it mattered. Used "leverage" and "transform" four times between them.

### Draft 2 (passed all 4)

Opens with the scene: "This past March, I met Juan at a conference in Miami." Names the stake within three sentences. Closes with "My bet is" — a personal claim, not a summary. No jargon. A reader who has never heard of BMA understands the argument.

The voice profile in `AUTHOR_VOICE_SEED["sagar-tiwari"]` is extracted from this draft: scene-first openers, "My bet is..." closers, conviction without hedging, no jargon.

## Capturing a new author

```
@Medha track Sagar's voice
display_name: Sagar Tiwari
role_at_org: BMA partner
org: bma
sample_pieces:
  - title: Ignoring the Hype Is Its Own Kind of Edge
    body: <paste full text>
```

Medha runs `track_author_voice` which POSTs to `medha-id /v1/personal/author-voice`. From then on `draft_in_author_voice` reads the stored profile.

## Drafting from a brief

```
@Medha draft Sagar's hypothesis section about <topic> from these notes: <paste>
```

Medha runs `draft_in_author_voice` with `author_slug: "sagar-tiwari"`, `source_brief: <notes>`. The tool:

1. Loads Sagar's voice profile (Firestore first, bundled seed fallback).
2. Builds a system prompt: 4 rules + voice card + length / format hint.
3. Calls Claude Sonnet 4.6 (override with `ANTHROPIC_DRAFT_MODEL`).
4. Strips botty filler and em-dashes via `voice-guard`.
5. Returns the cleaned draft plus a "what I cut and why" trailer (Rule 3 audit).

## What this doc does NOT cover

- Per-org doctrine injection on long-form prompts (Tab 3 — `writing-doctrine.js`).
- Section templates with word-count targets (Tab 4 — `writing/section-templates.js`).
- The newsletter critique + revise loop (Tab 12 — `edit_for_newsletter`).
- The content-seed Firestore object + Drive emit pipeline (Tab 13).

Those modules each reference the 4 rules here; the rules themselves stay in one place.
