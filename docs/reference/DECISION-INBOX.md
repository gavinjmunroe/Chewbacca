# The decision inbox

Agents run the work. Caleb sees one list: the calls only he can make, each with
the agent's take in plain words, and one receipt line for everything else.
Togari already does this for Jonah on Zeutara replies; this does it for Caleb.

Why: Screen Time for 10/7 to 10/13 had 34 of 64 hours in VS Code and the Claude
app, and on 10/12 he typed "Progress?" or "We good?" into tabs six times.

## Where it shows

| Where      | How                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------- |
| HUD        | `kyber-surfaces open decisions`, or "we good?", "progress?", "what do I need to decide" to the bar  |
| Terminal   | `decision-inbox` (text), `decision-inbox --json`                                                    |
| Phone      | `decision-inbox digest --write`: one text, saved as a draft under `~/.chewbacca/inbox/`, never sent |
| Scoreboard | `decision-inbox scoreboard --write`: a day's row in `~/.chewbacca/inbox/scoreboard.jsonl`           |

## The rules (Daniel's)

- One owner. `bin/lib/decision_inbox.py` builds the feed; the panel, the CLI and
  the digest only draw it.
- Two kinds. A decision has a question, at least two options and a
  recommendation. A receipt has one line, a state and proof. The `Item`
  constructor refuses anything else, a decision with no take included.
- Nothing half-made is drawn. Every source yields a `Draft`; only
  `Draft.ready()` makes an `Item`. A decision without a take, or a receipt
  without proof, goes to `held` with the reason, and the panel shows only the
  count. That count is work for an agent, not for him.

## What it reads (no store of its own)

- The jobs queue: every job submitted that day. An agent job's report is
  `REPORT-<prompt name>.md` next to its prompt. A sha in the report is proof only
  when `git merge-base --is-ancestor` puts it on origin/main.
- The newest overnight morning summary (`overnight/<night>/REPORT.md`) from the
  last 36 hours, for the calls the night handed over.
- The work-ledger: `Decide:` tasks and tasks that say they wait on his call;
  tasks done that day with evidence.
- The verdict log: sends a guard held for his press (dry runs excluded).
- The tab board: tabs seen in the last 15 minutes, as "still working".

## Writing a call so it reaches him

One line, in the report he will read:

```
Ur call: whether the Setup zip gets a public download page. My take: not until the repo is public.
BLOCKED: loading the extension is a click only u can make (chrome://extensions, Load unpacked).
```

The take goes on the call's line or the line right under it (a sub-bullet), or
anywhere in the section when the call is a heading. A take written later by
another agent says so: `My take (takes-gate lane, 10/13): ...`. A ledger call
carries its take in its next action the same way.

A line that says "ur call", "Caleb decides" or "only u can decide", or a
`BLOCKED:` line with no how-to in brackets, and has no take next to it, is
held. On the 10/13 feed, 7 of the 11 calls were held for exactly that.

Three places catch it, all running `untaken()` in the one module:

- `decision-inbox check [REPORT.md...]` prints `file:line` for each one and
  exits 1. With no files it checks that day's job reports.
- `chewbacca jobs` lists them at the end of an agent job's `out.log` when the
  job ends.
- Every lane prompt starts from `config/instructions/unattended-lane.md`, which
  asks for the take and for the check before the lane ends.

Not calls: words in quotes or code, the phrase used as a noun ("one feed of
only ur calls", "the calls only u can make"), an intro line or heading over
calls listed below it, and a recap that already says "my take on each".

## Pressing Go with it

Writes one work-ledger task (owner claude, source key `inbox:<call>`) with his
pick and the take to carry out. It sends nothing and runs nothing. The next
refresh reads the task, drops the call from the list and shows a "you chose"
receipt.
