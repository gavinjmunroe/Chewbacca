# Recipes

A skill is instructions an agent reads. A recipe is a file a command runs:
typed parameters, checked before anything starts, and steps that pass or fail
on their exit code.

```bash
chewbacca recipe list
chewbacca recipe check site-says --param url=https://example.com/ --param "text=Example Domain"
chewbacca recipe run site-says --param url=https://example.com/ --param "text=Example Domain"
```

`check` runs nothing and says which steps would need a press. Kit recipes live
in `library/recipes/`, yours in `~/.chewbacca/recipes/`, and any path works too.

## The file

JSON, because Apple's `/usr/bin/python3` has no YAML parser and a recipe has to
run on a bare Mac.

```json
{
  "version": 1,
  "title": "Site says",
  "description": "Check a live page says what we claim.",
  "parameters": [
    { "key": "url", "type": "url" },
    { "key": "text", "type": "string" },
    {
      "key": "max_seconds",
      "type": "integer",
      "min": 1,
      "max": 120,
      "default": 20
    }
  ],
  "steps": [
    {
      "id": "fetch",
      "run": ["curl", "-fsSL", "--max-time", "{{max_seconds}}", "{{url}}"],
      "timeout": 130
    },
    {
      "id": "says",
      "stdin_from": "fetch",
      "run": ["grep", "-qF", "--", "{{text}}"]
    },
    {
      "id": "clean",
      "stdin_from": "fetch",
      "run": ["grep", "-qi", "lorem ipsum"],
      "expect_exit": 1
    }
  ]
}
```

Parameter types: `string` (optional `pattern`), `integer` and `number` (optional
`min`, `max`), `boolean`, `date` (`2026-11-06`), `select` (`options`), `url`
(http or https), `file` (has to exist, and can't have a default). A parameter
with no default is required unless it says `"required": false`.

Step fields: `id`, `run`, and optionally `expect_exit` (a code or a list,
default 0), `timeout` (seconds, default 120), `cwd`, `stdin_from` (an earlier
step's stdout) and `gate` (why this step needs a press). The first failure stops
the run. An unknown field is refused, never ignored.

Exit codes: 0 every step passed, 1 a step failed, 2 the recipe or a value was
refused, 3 no press, 4 the send hold. Each run appends one line to
`~/.chewbacca/recipes/runs.jsonl` with exit codes and no values.

## What a file can't do

There are no trust tiers. A recipe from the kit and one fetched from a stranger
get the same treatment.

**A parameter can't reach a shell.** There's no `shell` option and `run` is a
list, so a value is one argv element. A step that names a shell, a code language,
or a program that runs its arguments (`env`, `xargs`, `find`, `git`, `ssh`, `tar`,
`rsync` and others in `tools/recipe.py`) can't hold a parameter at all, even as
`bash -c '"$1"' -- {{x}}`. A value that reads as a flag is refused unless the
step has a literal `--` before it.

**The press can't be turned off.** A step counts as read only when
`tools/recipe.py` proves it from the rendered command: a program on its `READ_ONLY`
list, with flags that list allows. Everything else stops for a person's press
through `tools/send_approval.py` with `always_press`, so agent send mode doesn't
waive it. That's an allowlist because no list of bad words catches
`sh -c "r''m x"`. One press covers every gated step of one run, is bound to those
exact commands and the file's hash, works once, dies after 15 minutes, and comes
before any step starts. `gate` can add a press, and no field removes one.

**The send hold wins.** While `~/.chewbacca/policy/send-hold` exists, any step
not proven read only is refused with exit 4, and no press gets past it. It's
that broad because the runner can't prove an unknown program doesn't send.

## Known limits

- A program the runner has never heard of that hands an argument to its own
  shell gets past the parameter rule. It still needs a press, and the press shows
  the exact command with the value in it. Add the program to `RUNS_ITS_ARGS`.
- `python3 script.py {{x}}` is allowed behind a press. What the script does with
  `x`, and what the script is by the time it runs, isn't checked.
- A gated step that calls a sink like `mac messages send` still hits that sink's
  own press too. That's two presses, on purpose.
- `pattern` is a regex from the file. A hostile one can hang the run on a long
  value, before any step starts and with nothing written.

The format's parameter types and the rule that a file parameter has no default
come from [goose](https://github.com/block/goose) (Apache-2.0). It renders a
template into a model prompt, while this runs argv with no model. The runner and
its rules are written here.
