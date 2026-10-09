# Librarian procedures, paraphrased from Sift

Source: the Codex skills in github.com/goodnight000/Sift (private repo, no LICENSE
file, read 2026-10-09 through Caleb's collaborator access): `wiki-health-audit`,
`wiki-maintenance-update`, `append-sources-to-existing-wiki`,
`wiki-structure-synthesis`, `research-wiki-update`, `initial-wiki-compile`, the
quiz worker, and the `active-tier-librarian-heartbeats` design. Because the repo
is unlicensed, nothing below is copied. These are the procedures restated for this
kit's brain (`~/second-brain`: `raw/`, `wiki/`, `memory/`, `core/`, `links.sh`,
`[!contradiction]` callouts). Do not paste Sift text or schemas into public repos.
Credit: Charles Zheng.

What the kit already has and this file does not repeat: the ingest, query and lint
triggers in `~/second-brain/CLAUDE.md`, one-fact-one-home, absolute dates,
"the user is right when a file disagrees". What it lacked, and this adds: a way to
classify new material before writing, a citation check, safe-versus-reviewable
repair classes, a sample-before-bulk gate, a structure pass, a paraphrased quiz
procedure, and a cadence with a budget.

## 1. Classify before you write (source delta)

Before an ingest touches any `wiki/` page, sort every claim in the new source into
exactly one bucket. If you cannot sort it, you are not ready to write.

- known: already in the brain with a valid source. Do nothing, or add the new
  source as a second citation.
- new: no page carries it. This is the only bucket that justifies adding prose.
- duplicate: the same claim in different words. Do not make a thin page for it.
- contradicted: a page or `core/` file says the opposite. Goes to section 3.
- weak: extraction was poor, the source is secondhand, or you could not quote it.
  Mark `confidence: low` or hold it back.
- unmapped: true and useful but has no home yet. Record it as a gap in the log,
  do not force it onto an unrelated page.

Then report the counts in one line ("12 claims: 7 known, 3 new, 1 duplicate, 1
contradicted"). The line is the receipt, and it exposes a source that added
nothing.

## 2. Map to pages, patch, do not rebuild

- Search the existing wiki for a home first (`grep -ri`, `./links.sh`). Prefer
  adding a paragraph to the best existing page over a new page.
- Honor a placement instruction from Caleb as a hard constraint unless the target
  page does not exist or the claim would be false there.
- A new page needs a reader task or a stable concept the existing pages cannot
  carry. Reject: one page per source file, a page that only restates a source, a
  split made only because the new source uses different vocabulary.
- Patch against what is on disk now. Never regenerate a page from scratch; read
  it, change the span that needs changing, leave the rest byte-identical.
- Protected pages: anything Caleb hand-wrote (`domains/`, `core/`, his Obsidian
  notes) or marked locked. Do not edit them to fit a source. Write the proposed
  change into the log or a `[!proposal]` callout beside it and let him rule.
  `core/` and `domains/` are the user's voice; compiled `wiki/` pages are yours.

## 3. Contradictions: keep the disagreement visible

Order of operations when a new claim conflicts with an old one:

1. Quote both sides with their sources and dates. Do not summarize either.
2. Decide the kind. Supersession (a later, more authoritative source corrects an
   earlier one: a manager's correction email over an old onboarding note) is
   different from a live dispute (two credible sources disagree).
3. Supersession: say so on the page ("as of 2026-10-09, per X; earlier Y is
   stale"), keep the old claim struck through or in a short history line, and keep
   the stale source cited as the stale one. A wrong claim that disappears gets
   re-learned later.
4. Live dispute: write both positions on the page and open a `[!contradiction]`
   callout. Never average into a compromise claim nobody made, and never pick a
   winner for Caleb. If one side is Caleb's own statement, he is right and the
   file is stale (existing rule); fix the file and log that you did.
5. Add a test: after the edit, the stale value must not appear as current
   anywhere. `grep` for it. Sift's own eval for this case fails the run if the
   outdated schedule shows up as the current one.

## 4. Citation integrity is a check, not decoration

For every factual sentence you add or edit in `wiki/`:

- It cites a file in `raw/` (or a memory file) that actually contains it.
- The cited passage, quoted or located by heading or line, directly supports this
  exact claim, not just the same topic.
- The same excerpt is not reused to back two unrelated claims.
- A claim you edited keeps a citation that still supports the edited version. If
  you changed what the sentence says, the old citation may no longer cover it.
- A stale, vague, or inherited source counts as weak support, never strong.

Audit anti-patterns to refuse: treating any link as valid without opening it,
counting a duplicate source as breadth, flagging every short page as bad when the
evidence is narrow, and turning audit output into edits in the same pass.

## 5. Health audit: read-only, ranked, with kinds

Run it as a separate step that writes nothing to `wiki/`. Output a report with
these finding kinds, each naming the exact pages and sources behind it, so a
high-severity item cannot hide inside "needs improvement":

- source_gap: material in `raw/` with no page.
- weak_provenance: claim without an exact supporting passage.
- contradiction: open `[!contradiction]` or a conflict you just found.
- stale_content: the source changed or `review` cadence passed. Keep stale
  separate from contradicted.
- broken_link / orphan_page: run `./links.sh orphans` and `./links.sh dead-ends`
  rather than eyeballing.
- synthesis_gap: several well-supported pages that need a bridge page.
- protected_pending: a proposal waiting on Caleb.

For a large brain, sample first: one hub, one leaf, one recently edited page, one
page with few citations, one tied to a high-value source. Tune the finding
categories on that sample, then scan the rest. Each finding gets severity
(info, low, medium, high), a recommendation, and a flag for whether it is a safe
mechanical fix.

## 6. Repair classes: what may be fixed without asking

Classify every proposed repair before doing it:

- safe_auto_fix: mechanical, no claim changes. Repair a broken wikilink, add a
  missing reciprocal link, fix index drift. Apply directly.
- safe_issue: record a finding (log entry or callout) without touching a page.
- reviewable_patch: any change to what a page claims, its citations, a
  synthesis page, or text Caleb wrote. Stage it and wait for his ruling.
- blocked: ambiguous target, no evidence, or the page changed since you read it.
  Say why and stop on that item.

Gates that go with the classes:

- Re-read the page immediately before writing. If it differs from what you
  planned against (hash or mtime), the plan is void for that page.
- Test before bulk: apply a small representative sample, verify links still
  resolve and citations still match claims, only then expand. If the sample
  fails, stop and report the failed operations instead of widening.
- Never delete a page. Merge or redirect, and keep history in git.
- Weak or contradicted evidence becomes an issue, not confident prose.
- Duplicate pages are merged only after checking they answer the same reader
  question and that the citations survive the merge.

## 7. Structure synthesis (when the wiki feels scattered)

Read-only, and produces recommendations. Classify each as link_only,
merge_candidate, split_candidate, new_bridge_page, move_or_rename, or
needs_human_review. Look for: duplicate title clusters, overloaded hub pages that
absorbed unrelated claims, pages invisible in `index.md`, and source clusters in
`raw/` scattered over unrelated pages with no home. Tie every recommendation to
page or source handles. Prefer small proposals to a reorganization, and call out
Caleb-written pages before suggesting any move.

## 8. Reading order for an initial compile

When compiling a new topic from several sources into the wiki for the first time:

1. List sources, read each once, and sketch private notes only: central themes,
   which sources are central versus peripheral versus duplicate, contradictions,
   candidate pages with their supporting sources, overlaps to merge, gaps.
2. Check structure before writing. No page exists only because one source file
   exists. No two pages answer the same question. No hub absorbs unrelated claims
   to avoid making a page. Every important theme maps to a page, is marked
   duplicate, or is recorded as a gap.
3. Match shape to genre: problem sets become strategy and worked-pattern pages,
   dense papers can support long pages, sparse slides produce fewer short pages
   with a caveat. Page length follows the evidence, not a quota.
4. Title pages as claims (existing rule) and lead with the takeaway.

## 9. Quiz generation from the wiki (for study use)

Two stages, both grounded in the page text:

1. Extract concepts from the chosen pages. Keep only concepts that need apply,
   analyze or evaluate thinking, each with the source passage it came from.
   Recall-only facts do not make good questions.
2. Write questions per concept: multiple choice or true/false only, reasoning
   first (a scenario, not "define X"), no "all of the above" or "none of the
   above", each with the correct answer, an explanation, the source passage, and
   the level. Distractors must be real misconceptions someone would hold, not
   filler. Reject any question whose answer is not in the cited passage.

This pairs with the `study-guide` and `quiz` skills; use it when the material
lives in `wiki/` rather than in lecture files, and respect
`coursework policy <course> ai` before generating anything for a graded class.

## 10. Cadence with a budget (the heartbeat idea)

Sift runs maintenance on a schedule, not on request. The reusable decisions:

- One dispatcher that asks "which wikis need work right now", not one job per
  wiki. Tier by recent activity: active (touched in 7 days, has a successful
  prior compile), then warm and dormant, which Sift deferred.
- Idempotent: skip a target with a successful run in the last 6 days, and back
  off 2 days after a failure or a budget refusal. A target never gets retried in a
  tight loop.
- A row per attempt, including skipped ones, with a status (pending, running,
  succeeded, failed, skipped, budget_exhausted). "Why did it not check X this
  week" is answered by the skipped row, so write one.
- A reaper for stuck runs (their timeout: 30 minutes against a post-pass that
  takes under 2) so one crash cannot block a target for a day.
- A hard budget per owner and a global kill switch. Sift's first version ran one
  kind of check, orphan and broken-reference sweep, and held everything else back
  until that shape was observed in production.

For this kit that maps to `brain-review` on a schedule: run `./links.sh orphans`
and the lint list on whichever domains changed this week, write one log line per
attempt with its status, and never run the expensive contradiction pass on files
nothing touched. Scheduled jobs belong on the server side per the
automation-runs-on-server rule, and a load-guard applies.
