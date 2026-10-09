---
name: relationship-recall
description: Answer a question about someone in Caleb's life from the people store, without digging through raw messages.
---

# Relationship recall

Use when the question is about a specific person: what they are into, what they
do, what they said, what to ask them about.

## The order

1. `people show "<name>"`. This is almost always the whole answer. It prints
   quick facts, circles, dimension scores, and recent observations.
2. If the fact is not there, `people search "<term>"` across everything known.
3. Only then `people texts search "<phrase>" --who "<name>"`. Raw messages are
   the last resort, not the first, because reading them is how you end up
   answering a music question by scrolling twelve thousand texts.

## If the answer is genuinely absent

Say so, then run `people distill --limit 1` scoped to that person if their
messages have never been distilled. Do not infer a fact from tone.

## What never to surface

Someone else's mental health, crises, addiction, abuse, or a breakup. The store
does not extract these by policy. If a raw message contains one, do not repeat
it back as a fact about that person.

## Facts about Caleb himself

`people me`, and `people me --search <topic>`. His own facts live as
self-observations, not on a person row.
