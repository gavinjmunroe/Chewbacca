# goodnight000 (Charles Zheng): verdicts on the remaining repos

Read 2026-10-09. Scope: everything except api-anything, cstack, countinghouse and
dime, which other work owns. Every repo with a LICENSE file is MIT (Charles Zheng,
or Zackriya Solutions for siftnotes). The exceptions are Pebble ("proprietary, all
rights reserved"), Sift and sift-cli (`UNLICENSED`), and six repos with no license
file. Nothing from an unlicensed repo is copied; only ideas are restated.

## Verdicts

| Repo | License | Verdict | Reason |
| --- | --- | --- | --- |
| Sift (private) | none | TAKE | Its Librarian skills hold health-audit, contradiction, citation and maintenance procedures the brain lacked. Paraphrased into skills/second-brain/references/librarian-from-sift.md. |
| sift-cli | UNLICENSED | SKIP | Thin client to the hosted Sift API after `sift login`. The package ships one bundled skill about itself and no Librarian logic (no "librarian", "contradict" or "lint" text in dist/bin/sift.js). The kit's brain is local markdown. |
| Pebble | proprietary | TAKE ideas only | 1,011-source feed list is real, but license forbids copying. Note in data/pebble-feeds/README.md; scoring ideas below. |
| exact-paste | MIT | INSTALL, later | Chrome extension, works. Needs a TypeSafe key. Overlaps jev-browse in model only. Details below. |
| tally | MIT | INSTALL, optional | Local usage dashboard. Overlaps codexbar only partly. Details below. |
| siftnotes | MIT (Zackriya) | SKIP | One-commit fork of Meetily (local Whisper meeting recorder, Rust and Next.js, Tauri). No Sift-specific logic. Heavy build for a job audio-brief and the watch skills already cover. |
| Room | none | TAKE a pattern | Three short prompts (designer, architect, coder) chained by labeled handoff sections. Pattern below, no text copied. |
| DataResearch | none | SKIP | 59 AI-compiled markdown research files, 77 KB of top-level reports. The TikTok playbook cites "50+ sources" and benchmarks with no per-claim attribution, which fails the kit's no-unverified-specifics rule. The kit already has social, video-script and gtm skills. |
| Fern | none | SKIP | Pnpm monorepo with a CLAUDE.md, design system, and security checklists for a product app. No reusable tool; the docs are product-specific. |
| Lens | none | SKIP | Pnpm monorepo for a learning product. Product-specific. |
| Tartan2026 | none | SKIP | MedClaw/CarePilot health-concierge app with a compliance checklist. Product-specific, and medical. |
| Cheffed | none | SKIP | Recipe app (React, OpenRouter). Not a kit capability. |
| Enuoia | none | SKIP | Archived Spotify mood app (Expo). Not a kit capability. |
| goodnight00-OS | none | SKIP | React desktop-simulator website. Not a kit capability. |

## exact-paste: install or not

What it is: MV3 Chrome extension. You copy a chunk of text (an email thread, an
address block), focus a form field, paste, and it inserts only the part that field
wants. One email, phone, URL or single person's name is decided on-device. Company,
city, title, or a chunk with two people goes to TypeSafe Jev to pick a substring,
then a second check validates it; any failure pastes the whole chunk. Model never
writes text; code slices what you copied.

Needs: Node 22+, a TypeSafe API key (console.typesafe.ai) baked into the build,
a manual "Load unpacked" click in Chrome (no silent install), and `curl | bash` for
the one-liner (read `install.sh` before running it; the kit does not run it).
`npm test` is free; `npm run eval` spends live Jev calls. Privacy: field label and
copied text go to api.typesafe.ai on smart slices; private keys and card-shaped
numbers are filtered out first.

Overlap: the kit's `jev` and `jev-browse` skills drive browser tasks with the same
model through the user's Chrome. exact-paste is a different job (human-triggered
paste in one field, no agent) so it does not duplicate them. The `typesafe-ai` skill
lives at ~/.claude/skills/typesafe-ai (not under ~/.chewbacca/skills, where it
was expected); check where the TypeSafe key is stored before building. The
extension bakes the key into `dist/`, which must never be committed.

Verdict: worth installing for Caleb's daily form filling (applications, Clay,
portals). Install by hand when the TypeSafe key is on disk. The pattern is worth
keeping regardless: **the model proposes a span, code copies only that span from
the source text, a second check verifies it, and any doubt falls back to the
whole original.** That structure makes a hallucinated value impossible, and it
applies to any "fill this field from that text" automation the kit builds.

## tally: install or not

What it is: Tauri v2 desktop app (React front end, Rust back end, SQLite at
~/.tally/tally.sqlite). It reads Claude Code session JSONL under ~/.claude and
Codex's SQLite and JSONL under ~/.codex, plus Cline, Kilo, Roo, OpenCode and
OpenClaw, and shows tokens, estimated cost, sessions, models, projects and an
activity calendar. Fully local, read-only, no keys, no network.

Needs: Node 18+, a Rust toolchain, Tauri v2 system dependencies, then
`npm run tauri build`. `cargo` and node 22 are on this Mac, so the build is
possible (several minutes of Rust compile). Costs come from a per-model rate table
(`src-tauri/src/db/cost_defaults.rs`) that must be kept current by hand.

Overlap with codexbar: codexbar answers "how much quota and credit do I have left
and when does it reset" per provider. tally answers "where did my tokens and
dollars go" by session, model and project, historically. They are complementary,
not duplicates. The kit has no historical per-project spend view (no `ccusage`
on PATH either), so tally fills a real gap.

Verdict: INSTALL, optional, low priority. A build is not needed to get the value:
the parsing approach (read per-message `usage` fields from Claude Code JSONL and
price them per model) can be done in a few dozen lines inside the kit if a build
is unwanted. Treat its cost table as an estimate, since it prices tokens, not what
a subscription actually charges.

## Room: the pattern worth keeping

Three prompts form a pipeline: designer, architect, coder. Each ends with a fixed
labeled section (an architect handoff, then an implementation blueprint) and the
next stage is told to read only that section and ignore everything before it. The
designer may not write code and uses plain-English specs; the architect simulates
failure modes and hides its debate from the coder; the coder writes a test meant to
break its own work first and, after three failed attempts, stops and writes a bug
report asking to escalate instead of trying a fourth time.

For the kit this is a handoff discipline: when one agent hands to another, end with
a single named block containing only what the next stage needs, and give the
receiving stage a stop rule. It matches existing `graph-engineering` guidance on
verifier separation and stop rules, so it is a confirmation, not a new skill. No
text from Room is copied (no license).

## Pebble: scoring ideas worth knowing (paraphrased, not copied)

From docs/algorithm-design.md and the config's weight tables:

- Rank by several signals blended with fixed weights rather than one score:
  entity prominence, event impact, source authority, corroboration, social
  velocity, cluster velocity, novelty, event rarity, funding size, research rigor,
  source diversity, with small multiplicative boosts for official releases.
- Trust is its own score, separate from importance: source authority, number of
  independent corroborating sources, official confirmation, claim quality, and
  primary document. It maps to labels (official, confirmed, likely, developing,
  unverified) driven by thresholds plus a minimum source count.
- Corroboration counts independent sources only. If most articles share more than
  about 60 percent of their text with the first one, they are a wire echo and
  collapse to one source, and "developing" stories take a small penalty.
- A story decays with a half-life (18 hours in the config) and a high score on a
  fresh multi-source story raises an urgent alert.

Use: the echo-collapse and independent-source count are directly relevant to
`signals` and prospect research in the GTM skills, where five articles repeating
one press release look like corroboration and are not. Not built; recorded here.
