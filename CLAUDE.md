# Working in this repo

This is a specification, not a program. It describes what a personal
relationship store should be able to answer, and grades Chewbacca's `people`
CLI against it.

## Read this first

`data/use-cases.json` is the source of truth. `USE-CASES.md` and `AUDIT.md` are
generated from it. Never edit the markdown by hand: edit the JSON and re-render.

## Adding a case

An entry is only worth adding if it is a question a person would say out loud.
"Query the contact table by company" is not a use case. "Who do I know at
Anthropic" is.

Every entry needs an honest `status`. The catalogue is worth something only
because `works` means it was executed and it worked. If you have not run the
command, the status is not `works`.

## Changing a status

When you make something work, run the command, confirm the output, then change
the status in the JSON and re-render. Add the command to `evals/evals.json` if
it can be checked without a person reading the output.

## What must not become a use case

Anything that indexes other people's crises, health, addictions, or the
breakdown of their relationships. `people distill` drops those messages before
extraction. Case 95 records that refusal on purpose. Do not "fix" it.
