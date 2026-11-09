---
name: feedback_hook_heredoc_in_command_sub
description: A hook that runs inline Python must read the script with `IFS= read -r -d '' py <<'PY'`, never a heredoc inside $( ), because macOS bash 3.2 misparses quotes there
metadata:
  type: feedback
---

Hooks run under macOS `/bin/bash`, which is 3.2. A quoted heredoc inside a
command substitution, `msg="$(python3 - <<'PY' ... PY)"`, breaks there as soon
as the Python contains an apostrophe or a quoted dict key: "unexpected EOF while
looking for matching `''". The hook then exits 2 on every call, so a guard meant
to refuse one bad file refuses every Write.

Found 2026-11-02 building `.claude/hooks/lecture-gate.sh`: 8 of 9 tests failed
with that error until the script moved out of the substitution:

```bash
IFS= read -r -d '' py <<'PY'
...python...
PY
msg="$(python3 -I -c "$py")"
```

`py="$(cat <<'PY' ... PY)"` fails the same way, since the heredoc is still inside
$( ). essay-gate gets away with the inline form only because its Python has no
quote that unbalances. Run `bash -n` and the hook's test before landing any new hook.

A new guard also needs a replay or sealed eval registered in
`docs/plans/decision-evals.json`, or pre-push refuses the land. Hooks on Bash
can use a `# gate:` header instead.
