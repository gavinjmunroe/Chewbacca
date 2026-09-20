# Working in ux-engine

## What this is for

An agent about to generate a UI reads `SYSTEMS.md`, picks one row, and loads
only that row's `DESIGN.md`. Then it generates. Then it runs `ux-lint`.

**Do not load more than one full system.** The average of several systems is
the generated look arriving by a different road.

## The rule the repo exists to enforce

The generated look comes from an empty deny list. So when you pick a system,
**carry its `forbids` list into the code**, not just its palette. A page that
uses Bugatti's colours but keeps `rounded-2xl` and a violet gradient has taken
the decoration and left the identity.

## Before writing any UI

1. `ux-pick "<the brief>"` and read the refusals it prints.
2. Read that one `DESIGN.md`.
3. Read `data/constants.json` for anything timed, animated or loading.
4. Generate.
5. `ux-lint <path> --fix-help` and clear it.

`craft-gate web-ux --why` prints the distilled rules if you are working inside
the kit rather than here.

## Changing the index

`data/systems.json` and `SYSTEMS.md` are both generated. Edit `tools/extract.py`
and rerun, never the outputs.

```
python3 tools/extract.py && python3 tools/index_md.py && ./tests/run.sh
```

**Check the output against brands you know before trusting it.** Every bug
found in the extractor so far was found that way and none of them would have
shown up as a crash: Stripe's accent reading as a shadow colour, Bugatti's as
its warning gold, and ten systems reporting a constraint they had no data for.

## Adding a rule to ux-lint

Every rule carries the tell it came from and the replacement. A rule with no
replacement gets ignored, which is the same as not having it. Add a case to
both fixtures in `tests/fixtures/` so both directions stay tested.

## Provenance

Never add a number to `data/constants.json` without a source in `research/`.
If the trail runs out, leave it out and say so. Several widely repeated figures
in this field do not survive checking, and shipping one as fact is how a
generator states a confident wrong number.
