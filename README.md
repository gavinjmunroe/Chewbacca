# 100 things a personal relationship store should be able to do

A catalogue of use cases for [Chewbacca](https://github.com/calebnewtonusc/Chewbacca)'s
`people` CLI, and eventually for Amber. Each one is written as a question a person
would actually ask out loud, paired with an honest verdict on whether the thing
works today.

This is not a wishlist. Every entry carries a status:

| Status | Meaning |
| --- | --- |
| `works` | You can do this right now with a single command. |
| `partial` | The data exists but the answer takes assembly or the coverage is thin. |
| `blocked` | Needs data the store does not have, or an integration that is not wired. |
| `build` | Nothing exists yet. This is the backlog. |

The audit was run against a live store of 3,186 people, 505,400 messages and
600+ extracted facts on 2026-09-09. Counts in `AUDIT.md` are real, not estimates.

## Why this exists

The store had 505,400 messages and could not answer "what music is my friend
into." Everything was retrievable and nothing was *known*. These 100 cases are
the specification for the difference.

## Layout

```
USE-CASES.md          the 100, grouped by what they are for
AUDIT.md              the verdict on each, with the command that proves it
data/use-cases.json   the same list, machine readable
evals/evals.json      the ones that can be checked automatically
skills/               agent instructions for the harder categories
```

## Using it

An agent should read `data/use-cases.json`, not the markdown. Every entry has
`id`, `ask`, `category`, `status`, `command`, and `needs`.

All glory to God! ✝️❤️
