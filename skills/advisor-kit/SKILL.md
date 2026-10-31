---
name: advisor-kit
description: "Package what we've built into a private repo a mentor, advisor or exec can use in their own company, built from every word of the call. Use when someone says 'add me to your repo', 'share what you've got', or Caleb says to help an advisor any way we can."
---

# Advisor kit

An advisor who runs a company gets more from a repo their team can clone today
than from a list of links. The first one was `calebnewtonusc/andrew-kit`, for
Andrew Laffoon (Mixbook CEO) on 2026-10-30.

## Never

- Never work from a call summary or the first page of a transcript. Granola's
  MCP pages long transcripts (`truncated`, `offset`, `total_chars`), and the
  importer kept only the first 37k of Andrew's 60k. Caleb, 2026-10-30: "plz read
  every word on those transcripts". Page with `offset` until `total_chars`.
- Never guess who a name is. "Andrew" had 20 matches in `people`. Caleb had to
  say "Andrew laffoon, we called him today". Run `people brief "<full name>"`
  and check today's Granola titles before anything else.
- Never scope it to what they literally asked for. Caleb, 2026-10-30: "Think
  through literally everything that could be useful for him as CEO in this
  time they're looking to transition the company". Map every problem they named
  on the call to a deliverable.
- Never build it serially. Caleb, 2026-10-30: "GRAPH ENGINERR I BEG U PLZ".
  Write `PLAN.md` with lanes by file before the second file, then fan out.
- Never ship private material. No Caleb notes, client names or kit-only paths.
  Grep the repo for names and `~/code` before pushing. Third-party skills keep
  their LICENSE and get a row in `skills/THIRD-PARTY.md`.

## Do

1. Read the full transcript, then write `SPEC.md`: each thing they said
   (quoted) becomes one deliverable.
2. `PLAN.md`: nodes, the files each one writes, a check for each.
3. Fan out the docs and new skills to subagents. Paste the transcript path and
   the facts list into each brief. Build any service yourself, with tests.
4. Deploy a demo of the service with no secrets on it (public repos only),
   give it a clean domain, and read the domain back after renaming. A taken
   name returns `true` and changes nothing.
5. Private repo, invite their GitHub login, then confirm the invite in the API.
6. Every action item from the call goes into `work-ledger` with
   `--source-key <who>-call-<date>-<slug>`. A memory note goes in the brain.
7. Read each doc once as the advisor before calling it done.
