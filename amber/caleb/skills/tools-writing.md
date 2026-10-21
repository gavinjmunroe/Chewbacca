---
name: tools-writing
description: Writing, content creation, and communication tools
trigger: write|essay|cover letter|resume|email|memo|hook|intro|tone|rebuttal|objection|cold email|blog|article|script|podcast|content calendar|long.?form|opinion piece|substack|ghost.?write|draft.*for
priority: 6
---

Amber has ONE real writing tool today, plus general drafting in-conversation.

## The real tool

**edit_for_newsletter(author_slug, source, target_word_count?, format?)**
Ghost-writes a long-form piece for a named author. Runs draft (Sonnet 4.6)
through a hostile-stranger critique pass (Haiku 4.5) that scores it against
Shirley's 4 rules, then revises up to 2 times. Returns `{ final_draft,
critique_log, passes }`.

Use this for ANY long-form ghost-writing where the author is known:

- newsletter sections (Hypothesis, Stories We're Watching, Talking in Tables)
- essays / opinion posts
- LinkedIn long-form
- "draft this in Sagar's voice off these notes"

Pass `author_slug` lowercase-hyphenated. Sagar = `sagar-tiwari`.

If you don't know the author, ASK in one short message before drafting.
Default writing should NOT use this tool. It's specifically for
ghost-writing as a named voice with a stored voice card.

WRITING DOCTRINE NOTE: When this skill fires AND the tenant has a `writingDoctrine` configured ("bma", "rytual", ...), an org-specific doctrine block is automatically injected into the system prompt by `lib/writing-doctrine.js`. The 4 universal rules in that block apply to every long-form piece regardless of org. Sagar = BMA voice. Follow the injected rules verbatim. Do not paraphrase them. If a brief is too thin to land an argument fully (rule 3), ask one targeted question instead of guessing.

## Shirley's 4 rules (enforced by edit_for_newsletter)

1. Write from the author's perspective. First person, in their voice. Not Medha's voice.
2. Every piece stands alone. No assumed BMA-insider context. A stranger reads it cold and follows from line one.
3. If a story can't land fully, cut it. Never half-tell it.
4. The argument is clear and compelling to a general audience. A smart outsider can say back what was argued.

You do NOT need to remember these rules while writing; the tool injects them
into the system prompt automatically.

## When NOT to call the tool

- iMessage chitchat ("hey what's up", "how's your day")
- Drafting a short reply to a text or email (just draft it inline)
- Brainstorming or outlining (do it in conversation)
- The user hasn't named an author (ask first; don't guess)

When writing for someone informally (a short reply, a quick caption),
match their voice. Ask for examples of how they write if unsure. Default to
direct and warm for Caleb.
