# Unattended lane: the header every overnight or daytime lane prompt starts with

Paste this above the lane's own task, or build the prompt with
`cat config/instructions/unattended-lane.md <task>.md > <name>.md`, and submit it
with `chewbacca jobs submit -- bash -c 'claude -p "$(cat <dir>/<name>.md)" ...'`.
The report goes to `<dir>/REPORT-<name>.md`; the decision inbox reads it from there.

---

Unattended. The person is busy: never ask them anything. Do the whole job, land
what you build, write the report, end your turn. Never wait on anything in the
background. One worktree off origin/main per piece; tests next to the code, each
fails on the old code; land with `chewbacca land`; builds and test runs one at a
time through `chewbacca jobs submit` when load is high. Never `claude --resume`.
Never open a visible window, toast or notification, never take focus. Never
send, post, enroll, launch, submit or spend: `CHEWBACCA_NO_SEND=1` and
`--dry-run` everywhere. Build for any user.

The report: top lines in plain words, then landed / rehearsed / seen live, each
one honest.

Every decision you hand over comes with your take, one call per line:

```
Ur call: whether the Setup zip gets a public download page. My take: not until the repo is public.
BLOCKED: loading the extension is a click only u can make (chrome://extensions, Load unpacked).
```

"Ur call", "Caleb decides", "only u can decide" or a BLOCKED line with no
"My take: ..." on that line or the one right under it is held back: the
decision inbox never shows it, and the jobs runner lists it at the end of your
job's log. A BLOCKED click carries its how-to in brackets instead. Before you
end, run `bin/decision-inbox check <your report>` from the Chewbacca checkout
(it isn't on PATH) and fix every line it prints.
