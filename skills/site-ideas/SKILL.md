---
name: site-ideas
description: "Diverge what a website is before designing it: random-draw idea lanes against a plain-prompt baseline, filtered, then picked blind by a person. Use for site concepts, new angles, or ideas no one has had."
triggers: >-
  Generate genuinely different concepts for a website before any design or build starts: what the site is, how a visitor moves through it, what it asks of them. Use when the user wants website ideas, new angles on a site, a concept nobody has done, to combine UI/UX and lateral or non-linear thinking, to brainstorm a client site, or says every site idea feels the same. Not for styling a chosen concept (ux-gen, interface), building a business site from its own content (site-spec), or copying a site (clone-site).
requires: [claude, python3]
---

# Site ideas: diverge the concept before the design

This produces different answers to what a site is, how a visitor moves through
it and what it asks, then has a person pick blind, before any design starts.

`ux-gen` already diverges the skin: six stances, each with refusals. Nothing
diverged the concept, so every stance styled the same site. Models converge on
the same few concepts, across vendors (Artificial Hivemind, arXiv 2510.22954),
and asking for creativity moves them to a second mode, not out of the cluster.
So the random input comes from a script, each lane works alone, and a plain
prompt with the same brief sets the bar every lane has to clear.

## Steps

1. **Write the brief** to `<project>/ideas/<date>/brief.md`: who they are, what
   they asked for in their own quoted words, who visits, the one main action
   the site exists for and who takes it, material only they have
   (`[NEED: ...]` for anything missing), the genre default to escape, and
   constraints. For the genre default, fetch two or three peers they named or
   the top results for their category, save them in `sources/`, and write what
   they all do. Every fact needs a source. The brief carries ideas: whatever it
   names, both arms build, so write it from sources, not from ideas you like.
2. **Commit expectations** in `EXPECT.md` before reading any output: what the
   baseline will cluster on, how many lane directions will die, and what result
   would show the approach is wrong.
3. **Run the lanes**: `python3 scripts/lanes.py <run> --run --used
   <project>/ideas/used.txt`, so no later run repeats a draw. It draws (with
   `scripts/draw.py`), builds seven prompts from `references/lanes.md` and runs
   them in parallel from empty directories: inversion, stimulus, mechanism,
   concept-fan, subtraction, tension, and the baseline. The first run took
   under three minutes.
4. **Filter by reading**, and write every verdict to `FILTER.md`:
   - Cut any lane direction whose core structure is a baseline concept's,
     whatever it is called. Merge duplicates across lanes.
   - Stimulus lane: if the brief alone could have reached it, the stimulus did
     nothing and the direction is cut.
   - Floor: every direction keeps F01 to F15 (`python3 scripts/draw.py
     functional`). One that cannot is cut.
   - Ignore the stated p. Record counts per lane.
5. **Check prior art**: one or two web searches per survivor, plus any swipe
   files the project keeps. Write `PRIOR-ART.md`, with "not found in these
   sources" or where it already exists.
6. **Build the blind sheet**: list survivors as `lane<TAB>name` in
   `keep.tsv`, then `python3 scripts/blind.py <run> --keep <run>/keep.tsv
   --sheet ~/Downloads/"<Client> site ideas blind pick.md"`. It evens the arms
   at random, strips the draw, rewrites every card to one format and keeps the
   key apart. Read the condensed cards once more: reworded baseline structures
   show here, so cut them from `keep.tsv` and deal again with `--new`. Any
   later call reuses the key, so a second reader gets the same letters. Link
   the sheet by absolute path.
7. **A person picks** a top five with a one-line why. A second reader picks
   before seeing the first's. Score against `EXPECT.md`: four or more of five
   from the lanes supports them, four or more from the baseline says the lanes
   added nothing for this brief, anything else is a tie. A reader with no
   preference lands four of five on one side 28% of the time, so one reader is
   a signal and two who agree are a result. Write it in the run folder.
8. **Build the picks** with the design engine. Each pick becomes an
   `intent.json` (purpose is "what it is", primary_action is the main action,
   first_look is "first ten seconds", plus audience), then `ux-gen "<concept>"
   --intent intent.json --out <run>/gen/<letter>`, which styles it across
   stances and runs its own blind viewer. Run `design-gate <url>` on what gets
   built, and log the person's choice between rendered pages with `ux-trial`.

## Never

- Never let a model pick the random input. It picks from its own mode, and the
  stimulus then does no work. `draw.py` uses the system's random source.
- Never let a model pick the winners or score novelty. LLM judges are weakest
  where human tastes differ, and reward models prefer the typical.
- Never show a lane the baseline or another lane. Seeing examples first anchors
  everything after them.
- Never trust the stated p. On the first run all 30 directions claimed under
  0.10 and 21 were things the baseline produced unasked.
- Never claim nobody has done it. Say which sources were checked.
- Never invent a fact about the client to make a direction work. Mark it
  `[NEED: ...]`.
- Never break the floor for novelty. Inversion only draws arbitrary
  conventions (A01 to A40 in `references/conventions.tsv`).

## What good output looks like

Kept, from the first run (a speaker's site, 2026-10-14): the stimulus lane drew
a wedding invitation suite. A wedding host invites and the guest replies, so on
this site the organizer is the host: the booking form is a formal invitation
sentence they fill in ("[Organization] requests the presence of..."), and the
confirmation is a printable invitation they forward to their team. The brief
alone would not have reached it, no baseline concept has that structure, and
web searches found no speaker form like it.

Cut, same run: the subtraction lane's "Two Doors", a root page with one door for
event organizers and one for podcast hosts. The baseline produced it unasked,
under the same name, at a claimed p of 0.08.

That run's numbers: 30 lane directions, 21 cut as baseline structures, 1
duplicate, 8 kept. Lanes with a draw kept 7 of 15, lanes without one kept 1 of
15. One brief is not enough to drop a lane: see `references/lanes.md`.

## Files

- `references/lanes.md`: every prompt, and what each run taught.
- `references/conventions.tsv`: A01 to A40 arbitrary web habits to invert, F01
  to F15 functional ones always kept, each F with its source.
- `references/stimuli.tsv`: about 100 non-web artifacts in 8 categories.
- `references/mechanisms.tsv`: 38 distant-domain principles with a bridging
  question each.
- `scripts/draw.py`, `scripts/lanes.py`, `scripts/blind.py`.
