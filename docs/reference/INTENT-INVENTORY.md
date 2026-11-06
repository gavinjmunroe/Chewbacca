# Where the kit reads meaning, and who does the reading

Caleb, 2026-11-05: "its llm and jev powered not if statement powered". This sorts
every hook and tool that pattern matches text into three groups. Swept 2026-11-05
from `.claude/hooks` (101 files) and `bin/` plus `tools/` (word-list regexes ranked,
the top 50 read).

Who reads what:

- **His typed prompt** goes to the model already reading it, as a short note. It
  doesn't go to Jev: a security review pulled prompts off Jev (822ed4c, see
  `skill-route.sh`). A local model or embedding is fine, nothing leaves the Mac.
- **The agent's own reply or brief** goes to Jev through `hook_judge` in `lib.sh`.
  Facts stay in code and come first. Jev down means no refusal.
- **Permission** never goes to a classifier. A gate can use Jev to add a refusal,
  never to allow something (`.claude/rules/agent-neutral.md`).

## Group 1: intent reading

Converted:

- `method-guard.sh`: take phrase list and `bin/method` classifier, now a note.
- `kit-route.sh`: stem matcher, about 135 lines, now a note naming kits and projects.
- `design-context.sh`: word list, now a note. The model pulls the block with `--full`.
- `archive-learn.sh`: note (landed first, the model example).
- `scope-guard.sh`: cut-word lists on the reply, now Jev. His "all" gate is still words, below.
- `voice-guard.sh`: "is this a text" word lists, now Jev, asked only after voice-check fails.
- `lesson-guard.sh`: "is this brief 3D work", now Jev. Its Bash checks are group 3.
- `skim-guard.sh`: the partial read stays code, "does it claim a full read" is now Jev.
- `blocked-route-guard.sh`: route names stay exact, "is this a UI step" is now Jev.
- `dough-brief-gate.sh`: "is this lead work", now Jev. Engine tool names stay exact.

Evals: `tests/eval_intent_notes.py` (haiku, old regex beside it) and
`tests/eval_reply_judges_jev.py`. Jev scores stay off the repo, per TypeSafe's
agreement 2.3(f).

Still words, because they read his typed text and Jev is off the table for that:

- `scope-guard.sh`: whether his recent prompts said all or every.
- `reply-lessons.sh`: `asked_about_school`.
- `bin/durable-check`: whether a prompt is a correction. Biggest list left.
- `chat-approval.sh`: the stop words. See group 3.

Tried on Jev and kept as word lists, bc Jev lost on real data. Each question scored
clean on its incident cases, then fired far past the list on 160 real closing turns,
or on the 196 real asks for `ask-lookup-guard.sh`, where its eval's floor is 1% false
refusals. A refused reply shows Caleb the reply twice, so firing more is the cost:

- `agent-claim-guard.sh`
- `open-work-guard.sh`
- `ask-lookup-guard.sh`

Word gates in converted hooks only keep unrelated text off the network
(`dough-brief-gate.sh`, `lesson-guard.sh`). They decide nothing. They can still miss: a reply that names none of the words never gets asked.

With no TypeSafe key these guards don't refuse at all, `dough-brief-gate.sh` included.

Limits of the evals: only `scope-guard.sh` was checked on real turns. It fires about
as often as its word list did there, on different turns, and those turns aren't
labeled. The other Jev lines come from small incident sets. Refit once real turns are
labeled.

Stays on purpose:

- `skill-route.sh`: meaning is already judged by local embeddings and a learned
  probe. What's left is explicit skill names and a learned phrase table.
- `model-route.sh`: already Jev. It does send his prompt, which contradicts the
  rule above. Open question for Caleb.
- `client-rulings.sh`, `pasted-call-gate.sh`, `youtube-transcript-ready.sh`,
  `ask-capture.sh`: exact client names, transcript shape, URLs. Facts, not meaning.
- `bin/method pick`: only runs when a person asks. No hook calls it now.
- Voice fast paths: `bin/lib/quick.py`, `opener.py`, `surface_intent.py`,
  `text_jobs.py`, `notes_surface.py`, `docs_surface.py`, `bin/hud-music`,
  `bin/lib/route.py`, `bin/kyber-sessions`. Whole-sentence shapes where a miss falls
  through to the model. Measured reason: 123 voice turns, 1.2 s first words with no
  tool and 5.6 s with one (`quick.py`). A miss costs seconds, not a wrong action.

Not converted, reads other people's text, not his intent:

- `bin/lib/gtm_ingest.py` (reply and scheduler classes), `bin/call-listen` (live
  call cues, latency bound), `bin/lib/meeting_actions.py`, `bin/lib/glass_answer.py`,
  `bin/lib/decision_inbox.py`. Worth their own pass, each has its own eval need.

## Group 2: quality scanners, kept

A measured pattern, and the words are the thing being measured:

- `slop-guard.sh` and `bin/slop-check`, `prose-guard.sh`, `ux-guard.sh`,
  `font-guard.sh`, `thinking-dash-guard.sh`, `prayer-guard.sh`, `handoff-guard.sh`,
  `reply-lessons.sh` (his exact spelling rules: u'll, y'all), `assumption-guard.sh`,
  `bin/name-check`, `bin/lib/call_prep_check.py`, `bin/plan-check`, `tools/public_scan.py`.
- `vibe-guard.sh`: phrases tied to an evidence check, and section 3 already asks Jev
  about the claims the phrases miss.
- `draft-source-guard.sh`, `essay-gate.sh`, `lecture-gate.sh`, `learn-on-land.sh`,
  `gtm-reuse-gate.sh`, `site-stack-gate.sh`, `interface-first.sh`, `design-gate.sh`:
  shape and file facts, not meaning.

## Group 3: safety and permission gates, kept as code

A classifier never grants permission. A miss here sends, spends or deletes:

- Send and launch: `launch-guard.sh`, `chat-approval.sh`, `ready-guard.sh`,
  `submit-guard.sh`, `client-post-guard.sh`, `client-ask-guard.sh`,
  `attachment-guard.sh`, `list-guard.sh`, `clay-reply-guard.sh`, `clay-native-guard.sh`.
- Delete and overwrite: `destructive-guard.sh`, `brake-guard.sh`.
- Credentials and data: `env-guard.sh`, `chatdb-guard.sh`, `mail-app-guard.sh`,
  `untrusted-screen.sh`, `fusion-guard.sh`.
- Publish and deploy: `artifact-guard.sh`, `vercel-guard.sh`, `railway-up-guard.sh`,
  `railway-domain-guard.sh`, `pr-guard.sh`, `attribution-guard.sh`.
- Machine and shell: `load-guard.sh`, `machine-budget.sh`, `zsh-guard.sh`,
  `wait-loop-guard.sh`, `focus-guard.sh`, `browser-ux-guard.sh`, `bulk-loop-guard.sh`,
  `use-the-kit-guard.sh`, `lesson-guard.sh` (Bash half).

`chat-approval.sh` has one real weakness: its stop words can miss a stop in other
wording. A miss keeps a send path open, so a note or local model could add a stop,
never a yes. Not built, it's Caleb's call.

## Registration gap, 2026-11-05

In `setup.sh` `_register` but not in the live `~/.claude/settings.json`, so these
don't run on this Mac: `ask-lookup-guard`, `attachment-guard`, `blocked-route-guard`,
`bulk-loop-guard`, `call-prep-guard`, `dough-brief-gate`, `draft-source-guard`,
`gtm-reuse-gate`, `learn-on-land`, `lecture-gate`, `open-work-guard`,
`pasted-call-gate`, `railway-up-guard`, `site-stack-gate`, `skim-guard`. Not disabled:
`~/.chewbacca/skip-hooks` is empty, and setup hasn't run since they were added.
Two of them are send or publish gates (`attachment-guard`, `railway-up-guard`).
