---
name: gtme-interview
description: "GTM engineer interview questions, take-homes and Clay practicals from sourced procedures: waterfalls, ICP scoring, dedupe, sequences, CRM pushes. Use for GTME or Clay interview practice."
triggers: >-
  Answer GTM engineer interview questions, take-home cases and Clay practicals in seconds from sourced procedures: waterfalls for work emails, hiring signals, ICP scoring formulas, deduping a list, sequence and A/B design, a table burning credits, Claygent versus an AI column, a domain-extraction formula, routing, pushing enriched contacts to HubSpot or Salesforce without duplicates, diagnosing a reply-rate drop, speed-to-lead system design, SQL and API-client coding rounds. Use when practicing for a GTME interview, drilling Clay questions, grading a practice answer, or when someone asks a Clay how-would-you question live. Also fires on: GTME interview, Clay interview, take-home, mock interview, practice question, Clay practical.
---

# GTM engineer interviews

Caleb, 2026-10-10: Clay walkthroughs and practice interviews "are pretty hard
sometimes", and the kit should answer them in about two seconds. This skill is
the fast path. It never invents an answer: every case cites procedures in
[WALKTHROUGHS.md](../../library/learning/clay-navigation/WALKTHROUGHS.md), and
each procedure names its Clay University page, claybook, video timestamp or
interview guide.

## Answer in this order

1. **Look it up.** `gtme-interview ask "<the question as asked>"` returns the
   closest case, two alternates and the related procedures, in tens of
   milliseconds. If no case fits, read the procedures it lists; never answer a
   Clay mechanics question from memory when a sourced entry exists.
2. **Say the answer, then the build.** Lead with the decision and the reason
   (cheapest tool that can answer, qualify before you enrich, read before you
   change anything), then the numbered build steps. Interviewers score numbers,
   trade-offs and ownership, so give the limits that matter: 50,000 rows per
   table, 4 emails per sequence, under 1% bounce, 300 matched for LinkedIn.
3. **Dry-run what the kit can.** Every `chewbacca clay <op>` in a card is
   checked against `library/clay-api/registry.json` before it prints. Cost and
   rate questions run `gtme-math` in process: provider order for a waterfall,
   a Wilson interval for an A/B readout. Writes are never run; a card names the
   UI route instead.
4. **Grade practice answers.** `gtme-interview check <case> --answer "..."`
   scores the answer against the case's key points; 70% passes.

## Commands

```
gtme-interview                       random case: retrieve, build, grade, time
gtme-interview ask "question"        answer a question live
gtme-interview show <case-id>        one case's card
gtme-interview check <case-id> --answer "..."   grade an answer
gtme-interview bench                 every case and paraphrase, timed
gtme-interview list                  case ids
```

`chewbacca gtme-interview ...` dispatches to the same tool. Add `--json` for a
machine-readable card.

## Measured, 2026-10-10

On Caleb's Mac at load average 24: 33 cases, answer path p50 0.26 ms and max
15 ms, about 0.11 s wall clock including Python startup, against a 2,000 ms
budget. Retrieval is 100% on the case prompts and 61% top-1, 85% top-3 on
paraphrases. The paraphrases were written by the same author as
the cases, so read those two numbers as optimistic; a question nobody wrote
down yet will retrieve worse. When the first card is wrong, the alternates
usually hold the right one.

## What the case bank covers

Clay mechanics (waterfalls, validators, run conditions, auto-run, the 50,000-row
wall, HTTP API, workflows and the `toolResult` wiring bug, functions, signals,
Sequencer, ads, MCP), GTME judgment (TAM sourcing, ICP scoring, routing,
deliverability diagnosis), and the interview loop itself (Clay's take-home,
the mock discovery call, speed-to-lead design, an API client, a SQL window
query, agent safety).

## Adding a case

A case is only added with a sourced procedure behind it. Write or find the W-
entry first, then add the case to `evals/evals.json` with `procedures`, a
`model_answer`, three to five `key_points` whose `match` strings appear in the
model answer, `build` steps, and `commands`, `formula` or `compute` where the
kit can show it. Write a `paraphrase` in different words and do not tune the
retrieval to it; it is the held-out question. `tests/test_gtme_interview.py`
refuses a case that cites a missing procedure, names a clay op the registry
lacks, quotes more than 15 words, or blows the time budget.

## Limits

- The bank teaches the answer; it does not replace building one. Run the
  practicals for real in a sandbox table before claiming them in an interview.
- Most Clay YouTube walkthroughs are not in here yet: YouTube rate-limited the
  caption fetch on 2026-10-09 and the transcription job is queued. The ledger
  at `~/second-brain/raw/clay-videos/LEDGER.tsv` lists every one as BLOCKED or
  empty with the reason.
- Sources are paraphrased. Transcripts and pages stay in the private raw
  store and never enter the repo.
