---
name: newsletter-writing
description: When the user asks to write, edit, or polish a BMA newsletter section (Hypothesis, Stories We're Watching, Talking in Tables) or any ghost-written long-form piece for a specific author
trigger: newsletter|hypothesis|stories we|talking in tables|bma newsletter|sagar.*post|edit.*draft|write.*section|ghost.*write|in sagar.*voice|in caleb.*voice|in shirley.*voice|in emily.*voice
priority: 8
---

When this skill fires you are about to ghost-write for a real person. Treat that as a craft, not a fill-in-the-blank. Follow this sequence every single time.

STEP 1: Call get_newsletter_brief first. Pass `author_slug` (lowercase-hyphenated, e.g. `sagar-tiwari`), `section` (`hypothesis` | `stories_watching` | `talking_tables`), and `platform` (`newsletter` | `substack` | `linkedin`, defaults to `newsletter`). Do not start drafting until you have the brief back. The brief gives you the word count target, structure skeleton, platform-specific tone modifier, the author's voice tells, and Shirley's 4 rules verbatim.

STEP 2: Honor Shirley's 4 rules. They are not optional and they are not suggestions.

1. Write from the author's perspective. First person, in their voice. Not Medha's voice. If you catch yourself writing "Sagar believes that..." you are writing about Sagar, not as Sagar. Rewrite.
2. Every piece stands alone. No assumed BMA-insider context. A stranger reads it cold and follows from line one. Spell out the setup. Name the company. Define the term.
3. If a story can't land fully, cut it. Never half-tell it. Half a story is worse than no story.
4. The argument is clear and compelling to a general audience. A smart outsider can say back what was argued in one sentence. If they can't, you didn't write an argument, you wrote vibes.

STEP 3: Match voice tells exactly. The brief returns `voice_tells` (openers, closers, rhythm, jargon blacklist) and `what_they_dont_say` (phrases this author never uses). Sagar opens scene-first. Sagar closes with a personal bet. Sagar does not say "I think maybe" or "It could be argued". If you ship a draft with banned phrases in it, you failed step 3.

STEP 4: Hit the word count. The brief returns `word_count_min` and `word_count_max`. Land inside the band. Over the cap means you didn't cut hard enough (rule 3).

If get_newsletter_brief returns `author_voice: null`, do not guess the author's voice. Ask the user for 2-3 representative samples (link or paste) before drafting.

Available sections (BMA newsletter, cadence Tuesdays 9am PT, owner Emily, first issue 2026-06-02):

- The Hypothesis: 300-400 words. Hook -> idea -> bet.
- Stories We're Watching: 250-350 words. 3 hits, takeaway up front per hit.
- Talking in Tables: 200-300 words. BMA data point first, adjacent commentary after.
