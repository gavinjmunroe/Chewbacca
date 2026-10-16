# GTME memory: lessons that the next campaign runs

Caleb, 2026-10-16: "Think about how we made chewbs rlly incredible at
remembering ppl and things over time... channel that same level of engineering
at making it rlly incredible at GTME... make the research and resources we
gathered actually applicable... Chewbs should be a smarter GTME than any human
bc it is able to operate in a way humans can't."

## Spec (written before any code)

### The problem, measured

GTM know-how lives in four places that nothing reads at planning time:

- `skills/gtm-engineering/SKILL.md`: 537 lines, eleven dated "lessons from X"
  sections. A lesson there is prose. It fails nothing and is found only if the
  agent reads the whole file.
- `team/memory/`: one fact per file, retrieved by keyword when a prompt
  happens to match.
- Client repos: `zeutara-gtme/findings/*.md`, `RECOVERY-STATE.md`, the Sabo
  state file. They hold sourced numbers that no other client's work ever reads.
- `chewbacca gtm-memory experiments`: per-client arms and the playbook's
  verdict floors. Scoped to one client by design, so it can't carry a lesson
  from Zeutara into Sabo.

The concrete miss this spec is built against: on 2026-10-03 Zeutara learned
that an email whose domain doesn't match the firm predicts a bounce or the
wrong person (102 of Qube's 481 audience, next to a 27% bounce rate). On
2026-10-16 the Sabo chain hit the same failure (a ZeroBounce-valid email at
another company for a Gymshark search) and found it again by hand. A memory
that worked would have handed Sabo that check on day one.

### What REA's Touhou essays say compounds

From rea.tools/blog/touhou-reconstruction and /blog/reverse-engineering-models:

1. The repo is the working memory. TH08's ledger held source for 1,107
   functions; `PROGRESS.md` and `RE_HANDOFF.md` let a fresh session resume.
   Each change was stored next to its observed result and the next decision,
   and the essays keep failed variations on purpose, so a later agent knows
   which hypotheses were already tested.
2. Oracles decide claims, and an oracle is tested with cases it must reject.
   Their exact-match comparator never checked float constants, so a `0.0`
   passed for `128.0`. Once fixed, an audit of 1,548 references found twelve
   more wrong results that had already been accepted. The fix was adding
   deliberately wrong values to the comparator's tests, and revisiting every
   result the weaker check had passed. Intermediate signals (right function
   size) needed checking against the full oracle.
3. One project's lessons become checks the next one runs. TH08's whole-build
   lesson shaped TH095, and the float fix was carried forward so TH095 didn't
   inherit the blind spot. Shared authorship is a prior, and the target
   decides whether a pattern applies. Held-out evaluation splits by source
   family, not by name, or near-duplicates leak.
4. A name needs its own evidence. "Unknown" is a valid answer.

### The GTM translation

| REA                               | GTME memory                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| function ledger, handoff files    | `team/gtme-lessons/<id>.json`, one experiment per file, in git                                                                            |
| change, result, next decision     | `hypothesis`, `change`, `result`, `next_decision`, plus a `history` that is appended, never edited                                        |
| failed variations kept            | verdicts `refuted` and `inconclusive` are first-class and retrieved like wins                                                             |
| exact-match comparator            | outcome oracles: reply rate, positive reply rate, verified-email rate, bounce rate, meetings, buyer hit rate, credits per verified result |
| right size, wrong bytes           | proxy oracles (grader score, spam score, Jev fit) can be recorded but can never confirm or refute                                         |
| deliberate failures in the tests  | every oracle has reject cases in `tests/test_gtme_lessons.py`                                                                             |
| re-audit after the oracle changed | each oracle has a version; a lesson judged under an older version shows REVISIT in `audit`                                                |
| lesson becomes a check            | `check` (what to run or verify) and an optional `check_ref` (`path::needle`, same as gtme-rules)                                          |
| target decides                    | `applies_to` and `scope` say where it held; retrieval shows the origin client so the reader judges transfer                               |
| neutral name when unsure          | verdict `observed` for a single seen case, `pending` before the result, `[NEED]` for a missing unit                                       |

### Requirements

R1. A lesson records: id, title, origin client, date, stage, applies_to tags,
hypothesis, change, oracle (metric, numerator, denominator, unit, source,
baseline), result, verdict, next_decision, check, evidence refs, scope.

R2. `confirmed` and `refuted` need an outcome or mechanical oracle, a sample at
or above that metric's floor, a baseline (except mechanical), and evidence.
Anything less is `observed`, `inconclusive` or `pending`. The tool refuses
the write, it doesn't downgrade silently.

R3. Each oracle names the sources it trusts. Positive replies never come from
a Clay category. A verified email only counts after the domain check. Meetings
need a calendar, a booking or the client saying so. Cost is per verified
result, never per attempted row.

R4. The ledger holds no email addresses or phone numbers. Evidence is a path or
commit, so client data stays in the client repo.

R5. `gtme lesson plan "<what you're about to build>" [--client X]` returns the
lessons that apply, ranked, each with its verdict, origin client, the check to
run and its evidence, in under a second, with no model call.

R6. A plan query that no lesson covers returns nothing, not the closest junk.

R7. `gtme lesson audit` exits 1 on a malformed lesson, a broken `check_ref`, or
private data, and lists REVISIT lessons.

R8. History is append-only: `gtme lesson record ID ...` adds the new result
and keeps the old one.

### Falsifier

The retrieval design is wrong if, with every Sabo lesson hidden, a Sabo
planning query fails to surface the Zeutara email-domain lesson in its top
five, or if an off-topic query returns any lesson.

### Held-out retrieval cases, sealed before the retriever exists

Written 2026-10-16 before `tools/gtme_lessons.py` had a ranking function. The
queries use words a person planning the work would type, not the lesson text.
Lesson ids are the ones planned for the seed ledger.

- H1, transfer, with `--exclude-client Sabo`: "Sabo: for each fitness creator,
  build a list of brands that sponsor creators, find the person who runs
  creator partnerships at each brand and get a verified email". Must return
  `zeutara-email-domain-mismatch` in the top 5.
- H2, a client the ledger has never seen (Firm Foundation): "first cold email
  campaign to construction company owners: pick who to send to and write the
  sequence". Must return `zeutara-list-fit-before-copy` in the top 5 and at
  least one copy lesson.
- H3, reply handling: "a prospect wrote back, how do we know if they are
  interested and who answers them". Must return
  `zeutara-reply-text-not-category` in the top 3.
- H4, restart: "the campaign got paused for bounces, how do we restart it
  safely". Must return `zeutara-recovery-window-before-resume` in the top 3.
- H5, off-topic: "make the TTS logo spin in Blender". Must return nothing.
- H6, leave one client out: for every Sabo lesson that names a Zeutara lesson
  in `derived_from`, the Sabo lesson's hypothesis as the query, with Sabo
  excluded, must return that Zeutara lesson in the top 5.

Limits of this test, stated now: the same agent wrote the queries and the
lessons, so vocabulary overlap is likelier than with a stranger's query. The
cases are few. Passing them shows the mechanism works on these cases; it
doesn't show coverage.

## Design (the slice that shipped)

### Storage

`team/gtme-lessons/<id>.json`, one experiment per file, in git next to team
memory. One file per lesson keeps parallel tabs from fighting over one ledger
file, and `chewbacca land` carries it like any other change. The location is
overridable with `GTME_LESSONS_DIR` for tests. Evidence is a path or a commit:
client numbers that already sit in a client repo stay there, and the ledger
holds the claim plus a pointer.

A lesson, with every field required except the last three:

```json
{
  "id": "zeutara-email-domain-mismatch",
  "title": "An email whose domain isn't the account's own predicts a bounce or the wrong person",
  "client": "Zeutara",
  "date": "2026-10-03",
  "stage": "verify",
  "applies_to": ["email-verification", "list-quality", "bounce"],
  "hypothesis": "...",
  "change": "...",
  "oracle": {
    "metric": "bounce_rate",
    "numerator": null,
    "denominator": null,
    "unit": "sends",
    "source": "clay_campaign_stats",
    "baseline": "...",
    "version": 1
  },
  "result": "...",
  "verdict": "observed",
  "next_decision": "...",
  "check": "...",
  "evidence": ["~/code/work/zeutara-gtme/findings/2026-10-03-copy-and-fit.md"],
  "check_ref": ["kit:tools/gtme_lessons.py::def verified_email"],
  "derived_from": [],
  "scope": "...",
  "history": []
}
```

Stages: list, enrich, verify, copy, send, deliverability, reply, meeting, ops.
Verdicts: pending, observed, inconclusive, confirmed, refuted.

### Oracles

`gtme lesson oracles` prints the registry. Five kinds of rule, each with reject
cases in `tests/test_gtme_lessons.py`:

| Oracle                 | Kind        | Floor | Refuses                                        |
| ---------------------- | ----------- | ----- | ---------------------------------------------- |
| reply_rate             | outcome     | 500   | confirmed with no unit, no baseline, small n   |
| positive_reply_rate    | outcome     | 500   | a Clay category, a reply category, a snippet   |
| bounce_rate            | outcome     | 200   | small n (floor guessed, never measured)        |
| verified_email_rate    | outcome     | 20    | any count without `domain_checked: true`       |
| buyer_hit_rate         | outcome     | 20    | the model's pick or a title match as the judge |
| meetings               | outcome     | 500   | inferred meetings, reply categories            |
| credits_per_verified   | outcome     | 10    | cost per attempted row                         |
| row_chars              | mechanical  | 1     | nothing: a deterministic size confirms on one  |
| observation            | observation | n/a   | ever confirming or refuting                    |
| grade, spam, fit score | proxy       | n/a   | ever confirming or refuting                    |

The 500 floor is the playbook's "under 500 sends per arm is don't know yet".
The others are marked guessed in the code, so the next person knows how much
they're worth. `gtme lesson verified-email` is the row-level form of the
verified-email oracle, usable inside a chain: valid at the brand's or the
parent's domain (or a subdomain) counts, valid elsewhere doesn't, and
catch-all or unknown never counts.

Each oracle carries a version. A lesson stores the version it was judged under,
and `audit` marks it REVISIT once the oracle tightens, the way REA reopened
every result the weak float comparator had passed.

### Retrieval

`gtme lesson plan "<text>"` is BM25 over the lesson's fields (title, tags and
check weighted up), after mapping GTM synonyms onto 24 concept groups
(influencer, creator and athlete are one idea; findymail, zerobounce and valid
are another). Then three rules:

- A lesson must share at least two ideas with the query and clear a score
  floor. One shared word like "email" matches half the ledger and says nothing.
  This is what returns nothing for an off-topic query.
- Each stage the query touches gets its best lesson first, then the rest fill
  by score. A plan spans stages, and without this the copy lessons for "pick
  who to send to and write the sequence" sat sixth behind five verify lessons.
- A refuted lesson ranks with the wins (a failed variation is what stops the
  next agent retrying it). Pending ranks last.

Results from another client are marked "check it applies here", with the
`scope` line saying where the lesson held, because shared authorship is a
prior and the target decides.

### Where it runs without anyone asking

- `chewbacca gtme start` prints the top three lessons under the plan, and
  `gtme list` prints them before building the list.
- A lesson's title and check can't name its client (refused at add), and
  `gtme start` prints only those two fields, with the origin shown only for a
  client this machine already runs. Someone else's install sees "an earlier
  client".
- The gtm-engineering skill tells every GTM session to run `lesson plan` first
  and record each experiment after.
- `tests/run.sh` runs the test file and `gtme lesson audit` on the real ledger,
  so a broken `check_ref` or a malformed lesson fails the suite.

### Seed ledger

17 lessons, each from a file on disk: 11 Zeutara (list fit before copy, email
domain mismatch, grader not validated, variant A vs B with the unit unstated,
reply text over category, reply coverage, meetings oracle blind, paused-campaign
orphans, recovery window before resume, opt-out, recovery as a task graph) and 6
Sabo (buyer keywords, identifiers_only and the read cap, off-domain valid email,
Jev score floor, parent-domain fallback, cost per verified buyer). One is
`confirmed` (the identifiers_only row size, a mechanical oracle). Two are
`inconclusive`. The rest are `observed`, because none of them has 500 per arm
or a measured baseline yet, and the tool refuses to call them more.
`gtme lesson audit`: 4 CHECKED (a check that still exists in code), 13 PROSE.

## Results

Run on 2026-10-16 against the real ledger.

First sealed batch, before any change to the ranker: H1, H3, H4 and H5 passed,
and so did both H6 leave-one-client-out pairs (Sabo's off-domain lesson finds
Zeutara's domain lesson first, and the Jev floor lesson finds list-fit-before-copy).
H2 half failed: list-fit-before-copy was 5th, but no copy lesson made the top
five.

Before changing anything, four more cases were sealed (H7 to H10) and run
against the unchanged ranker as a baseline: 3 of 4. H7 failed, with the cost
lesson 5th when it needed the top 3. Same cause as H2: one heavy idea filling
the top with one stage.

After the stage-coverage rule: all ten cases and both H6 pairs pass, on
Python 3.14 and Apple's 3.9. The H1 transfer query puts
`zeutara-email-domain-mismatch` first.

What this does not show: that a stranger's query would retrieve as well, or
that lessons change campaign outcomes. The second claim needs the experiment in
the follow-ups below.

## Follow-ups, in order

1. Turn PROSE checks into code, one at a time. The three closest: the list-fit
   share before copy (gtme-score already scores fit), the 500-per-arm floor in
   `gtme-grade`'s copy gate, and the recovery window inside the resume op once
   `fix/zeutara-claude-recovery` merges.
2. Sabo's `live_chain.py` calls `gtme_lessons.verified_email` instead of its
   own domain check, so the oracle and the chain can't drift apart. They
   already differ: the chain's `email_problem` rejects only "invalid" and lets
   a catch-all or unknown verdict through as usable, and the oracle doesn't
   count those as verified. Decide which one is right before merging them.
3. Feed `gtm-memory experiments` arms into `gtme lesson record` when an arm
   matures past day 21, so measured verdicts land without a person writing them.
4. Move the dated lesson sections of `skills/gtm-engineering/SKILL.md` into
   the ledger, so the skill keeps only procedure.
5. Measure whether lessons change outcomes: the next client's first campaign
   with `lesson plan` checks applied, against Zeutara's lifetime numbers as of
   2026-10-11 as the baseline (bounce rate 2.0% of 1,780 sends, positive replies 0.37% of
   people).
