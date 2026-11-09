# Audit

Run 2026-09-09 against a store holding **3,186 people**, **505,400 messages**,
**154 circles** and **600+ extracted facts**. Every `works` entry was executed,
not assumed.

| Verdict | Count |
| --- | --- |
| `works` | 72 |
| `partial` | 15 |
| `build` | 12 |
| `blocked` | 1 |

## What the gaps have in common

Three shapes account for almost every `build`:

**Directional message counts.** Who reached out and got no reply, which
friendships are one-sided, who I owe a response to. The `messages` table has
`from_me` on every row, so all of these are one query away. Nothing has written
that query yet. This is the cheapest large win on the list.

**Two-person comparisons.** What do we have in common, who do we both know,
who did I meet through whom. Facts are stored per person with no join across
people, and `relationships` is sparse because nothing populates it
automatically.

**Freshness.** A fact from 2019 and a fact from last week look identical in
`people show`. Observations already decay inside scoring, so the model exists;
it just is not surfaced on the facts themselves.

## The one deliberate refusal

Case 95, "who is going through something hard right now," is marked `blocked`
and should stay that way. `distill` has an explicit forbidden pattern covering
crises, addiction, abuse and the breakdown of relationships, and it drops those
messages before they ever reach the model. Caleb set that rule directly. A
system that indexes other people's worst weeks is not a second brain, it is a
liability, and the people in the store never agreed to it.
