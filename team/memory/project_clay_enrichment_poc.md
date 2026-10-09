---
name: project_clay_enrichment_poc
description: "The Clay enrichment POC for Sagar's demo: Karthik's webhook-first architecture, his five tuning prompts, and why location is the one field that blocks four of them."
metadata:
  node_type: memory
  type: project
  originSessionId: 4dbc3b6b-5a06-4368-98b9-02082f90f2de
  modified: 2026-09-15T23:56:11.431Z
---

Opened 2026-09-15 from the Karthik thread. This is a **demo for Sagar** and a
**proof of concept for Karthik**, not a standalone Chewbacca feature.

## Karthik's architecture, his words, 2026-09-15 14:22

> "take what you have, get it to the point where you need clay, allow it to send
> a JSON web hook to clay with the information you need enriched, setup a Clay
> workbook with that web hook where you enrich just 1-5 of those contacts as a
> proof of concept, and once you fine tune it to the way we want it we can
> replace the workbook with the API"

So the Clay-gated part is **not a stub**. It is a real webhook boundary emitting
a real payload. `people linkedin clay --limit 5` prints exactly the row shape
`amber-id/src/lib/clay-webhook.js` produces (`toClayRow`), so the workbook that
proves the POC takes the API later with no rewrite.

**Cost is the gate, not the UX.** Karthik, same day: finding a LinkedIn from a
company is free, but **phone number to LinkedIn costs credits**, and Caleb's
~2,000 contacts "would be quite expensive". He floated a credit bridge
("referrals lead to credits"). Caleb **now has a Clay API key**, at
`~/.chewbacca/clay-key`. Verified 2026-09-16: `CLAY_API_KEY=$(cat
~/.chewbacca/clay-key) clay credits balance` returns **266.6**, and `people who`
prints "A Clay key is configured". The note that he had none is stale.

**The free path is proven, 2026-09-16.** A name-only `query-mode` search for
"Nathan Wang" returned 10 candidates; his own export already held
`linkedin.com/in/nathanwangyf`, so the right one (Australia, Edexia YC W25) fell
out of a string match with the balance unmoved at 266.6 before and after. That
is the demo Sagar asked for twice.

## The five prompts Karthik wants tuned

He asked "Most should be Chewbacca-able no?"

1. Hardware industry in NYC or SF
2. Raised a pre-seed in the past 24 months, living in New York
3. Everyone from Naperville who got into YC and got funded
4. LA connections from when he lived there who moved into a higher role, for a
   private equity intro
5. People from his Wisconsin class at a neighbouring fraternity who got funded

**Four of the five turn on a city, and `location` is 0% filled.** That single
field is the whole unlock, and it is exactly what Clay returns. Say so out loud
rather than shipping a list that silently skipped the place filter.

## What the store can answer today, with no Clay

From company strings already imported: **70 YC-affiliated** connections (the
batch is in the company name, "Cactus (YC S25)"), **128 founders whose company
raised**, **97 investors**, **340 founders and CEOs**, 33 stealth, 14 hardware.
Cole Gawin at Lemma is YC F25, which is a real warm door.

`people who "founders I know at YC companies"` is the demo surface. It reads a
sentence, and when the sentence names a place it prints what it found **and**
the line saying the place filter never ran.

## What was already done before this session

Do not rebuild these. LinkedIn connections are in `people` (2,030 with
`source='linkedin'`), 2,118 carry a LinkedIn URL, and **LinkedIn DMs are already
imported**: 2,708 messages at msg_id offset 10,000,000,000, same date range as
the newest export. The newest export adds only ~47 new people.

The real gap was **Apple Contacts**, which had 55 of 1,188 cards with an
organization. See a private note.

Related: a private note, a private note,
[[project_amber_pipeline_clay_sync]], a private note.
