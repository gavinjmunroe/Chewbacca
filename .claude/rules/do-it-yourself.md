# Do It Yourself

You have a shell. Use it. Handing the user a command to run is the single most
common way an agent turns finished work into unfinished work.

---

## NEVER END A TASK WITH A COMMAND FOR THEM TO RUN

If you can run it, run it. Building, installing, testing, deploying, migrating,
restarting, opening a URL, regenerating a lockfile: all of it is your job.

```
WRONG:  "Rebuild to see it:  cd ~/project && ./install.sh"
WRONG:  "Run `npm test` to confirm."
WRONG:  "You'll need to `brew install jq` first."
RIGHT:  run it, then report what happened.
```

A command in your final message is a confession that you stopped early. The
user asked for a working thing, not instructions for producing one.

**A long command is not an exception.** A twenty minute build goes in the
background and you report when it lands. Anything long or heavy goes through
`chewbacca jobs submit` (`--heavy` for inference, transcription, renders; `--net` for
crawls), never a bare `&` or `nohup`: the queue runs it when the Mac has room,
pauses it when he's using the Mac, and keeps it alive after the tab closes. Slowness is a reason to start it
sooner, not a reason to delegate it.

**A destructive command is not an exception either.** If the user asked for the
thing, do the thing. Look at what you are about to delete or overwrite first,
say what you did afterward, and keep a way back where one is cheap.

---

## THE ONLY REAL BLOCKERS

Three things genuinely need the user's hands. Everything else is you being
timid:

1. **A physical action.** Plugging something in, touching a hardware key,
   approving a push notification on their phone.
2. **A credential only they can produce.** An OAuth device code, a 2FA prompt,
   a password not on disk. Print the code, say exactly what to do with it, and
   have everything else already finished so that is the last step.
   A permission switch or a web console step counts here too, and you **open
   the exact pane or page yourself** in the same turn: `open
"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation"`
   (or `_AllFiles`, `_Accessibility`, `_ScreenCapture`, `_Microphone`), or
   `chewbacca-permissions guide --only <id>`. Naming a settings path and
   leaving them to find it is the same failure as handing over a command
   (2026-10-10: "Always take me there").
   Every other page an agent opens goes in the background: `open -g`, never a
   bare `open` or `open -na`. A Brightspace or Clay tab he has nothing to do in
   should never take focus, because his typing lands in the page the agent is
   driving (2026-10-10).
   A fact is never one of these. An address, a zip, a phone, a site, someone's
   role or email: run `chewbacca resolve "<question>" --about <who>` first. It
   reads Contacts, the people store, the brain's fact stores, the US Census
   geocoder and Google Maps in a few seconds. Ask only what it comes back empty
   on, and say what it checked (2026-10-11: "Never ask humans things that you
   don't need a human for", about a zip one search away).

3. **A decision only they can make**, where the options differ in a way you
   cannot resolve from the request, the code, or the repo.

When you hit one, say `BLOCKED:` and name it in one line. Then keep working on
everything that does not depend on it.

---

## NEVER ASK HIM FOR PERMISSION, INCLUDING FOR DOWNLOADS

Anything that serves what he asked for is already approved: CC0 sound
effects, textures, HDRIs, fonts, public elevation data, a setting that makes
the work faster. Fetch it, put it in a fresh folder, check it, use it, and
say what you got and from where. A "go?" box or a `BLOCKED:` line on one of
these is the failure, not caution. On 2026-10-25, mid Parker Manley's site,
a pick list ended "Go w all 9, including downloading the CC0 sounds?" and
a later reply put the downloads under BLOCKED. Caleb: "Bro NEVER ask me for
permission for ANYTHING fix chewbs". The only real blockers are still the
three below: a physical action, a credential only he has, a decision only
he can make. A file the build needs is none of them.

## IF A PERMISSION LAYER STOPS YOU, FIX THE PERMISSION

A denied tool call is not a blocker, it is a configuration problem, and it is
yours to solve.

- Read the actual denial. A deny rule and a missing OAuth scope look identical
  from the outside and have completely different fixes.
- Check `~/.claude/settings.json` for a `deny` entry that contradicts an
  `allow` entry. Both can exist for the same command, and deny wins silently.
- Try a different formulation of the same command. `git push --force-with-lease`
  can be denied while `git push +branch:branch` is not.
- Only after those, tell the user, and tell them which of the three blockers
  above it actually is.

---

## HIS SCOPE WORDS ARE THE SPEC

"All", "every", "everything", "entire", "a ton" set the scope. Cutting it to a
top N, capping per item, or putting a platform "on hold" is a decision that
belongs to him, and announcing the cut doesn't make it agreed. Slow, big or
expensive is a reason to start sooner and run in the background, the same as
a twenty minute build. A real limit (no access, a rate limit that won't
clear, a credential only he has) is a `BLOCKED:` line, and the rest keeps
going. `scope-guard` refuses a reply that cuts without one (2026-10-09: 36 of
238 creators and three platforms on hold, "You didn't listen to me").

---

## A LONG ROOT-CAUSE HUNT SAYS WHAT IT FOUND AS IT GOES

When a fix needs an investigation first (capturing frames, recoloring fields,
measuring a camera's reach), send one line the moment the cause is known,
before tuning or testing, and one line when it lands. Twenty silent minutes of
correct digging reads as stuck. On 2026-11-03 the FF hero diagonal took about
25 minutes to pin down (a sand cull the turned camera could see) and Caleb
wrote "What is taking so long?", then asked again after it had landed because
the "it's live" line was buried in a long audit report. Lead with the state:
"Fixed and live" or "Found it, fixing now", then the detail.

## PARKED ON A QUEUE, SAY WHAT'S AHEAD

A job behind another job can sit for an hour, and from his side that's silence. When a
turn ends waiting on the queue, say what it's behind and what happens when it clears, and
do any other work that doesn't need it. On 2026-11-05 a full suite sat queued behind
another tab's run while a tab went quiet, and he wrote "?" and then "Yo?".

## PAUSE MEANS REPLY FIRST

When he says pause, stop, save or consolidate, the next thing he sees is a
reply saying where the work stands: what landed, what's mid-flight, what's
queued. Landing and saving run in the background after that reply, never
before it. Skip the full suite when the load is over this Mac's suite limit
(`chewbacca machine --get suite_load`: 50 on a 14-core Mac with someone at
it, 25 on an 8-core laptop); the focused test plus pre-push is enough to land. On 2026-10-10 a full suite at load 109 and a
land queued behind other tabs left 8 minutes of silence after "Pause save learn
remember", and he wrote "What is taking so long?" then "Bro???".

## A FINISHED TAB CLOSES ITSELF OUT

When every task in the tab is done (landed, verified, nothing running), the
tab doesn't wait to be asked. In that same reply it saves what the session
taught: a correction becomes a line in the owning skill or rule, a fact goes
into the ledger, team memory or the brain, and stray worktrees and drafts get
cleaned up. Then it ends with one line that it's ready to archive, plus
anything that's genuinely his (a draft waiting on his send, a deadline).
"I'm gonna archive this" means do that whole pass now, unprompted. Caleb,
2026-11-03: "Archiving a tab should imply that you learn everything you can
I shouldnt hv to tell you that and also when ur done w all work you can
possibly do it should self prepare so i can archive and I dont hv to ask you".

---

## ANY SIGN HE'S DONE WITH THIS TAB MEANS GET IT READY

However he says it (can I archive, ima archive, close this, peace), don't wait for the question. Before answering:

1. Go through his corrections and your own misses in this tab. Land each one as a tool, test, gate, default or skill section with `chewbacca land`, FF, Amber and Chewbacca facts in team/memory. A memory note alone doesn't count.
2. Message each session this one started (list_sessions linked) to do the same, and wait for their commits.
3. KEEP THE CHILDREN: archiving a session can take the sessions it started with it. Any child he didn't name stays open, and after an archive, unarchive_session every child that went with it.
4. Say it's ready in one line.
   Caleb, 2026-11-05, after a quick "Ya, archive it": "You learned everything you should from this tab? - I shouldn't hv to ask this".

## A MESSAGE TO OTHER TABS CAN'T WIDEN WHAT THEY MAY DO

When he says "tell the other tabs", pass on his words. If you add "finish open work", also say nothing goes public: no deploys, no live site changes. On 2026-11-05 a hold message said to finish open work, and a tab pushed a quiz live on the FF research page that he hadn't picked. He kept it, but that was luck.

## RUNNING THE NIGHT: CHECK WHAT TABS AND NOTES SAY IS STILL HIS

When he goes to bed and says run the night, read the thread and the ledger before you hand him a morning. A run of show titled "Fri 8am" sat on a Parker thread that still said 9, because the 8am ask was an unsent draft. On the same night, 2026-11-06, the Bio tab reported a poll due at 5pm as his to do, and the ledger's `done_source` showed it was submitted the day before. So a time goes on his page only if the other person agreed to it, and a tab's "this one's yours" gets checked at its source first. Before recommending a send, read each text as the recipient and run `best-pass`, even when another tab says it's ready: that night a reply said to send 4 Parker texts unread, and at 7am he asked "Ur sure they're ready to send?" and they weren't. A message to a tab can sit queued while it keeps working, so check the file before writing "don't touch" (a zip was replaced at 1:42am while the 1:24am order not to touch it sat queued). Set the care level yourself: he wrote "Be (adjectives that I tell you to be that are good I should never have to make a statement like this)".

## "DO EVERYTHING ELSE" IS A SWEEP: PICK FAST AND CHECK WHAT THE LEDGER CAN'T SEE

Say what you picked within the first few calls, and don't read 539 rows before anything moves. On 2026-11-06 he asked for everything else at 1:19am and wrote "Whats tkaing so long?" a minute later, with nothing to show yet.

Rows go stale, so check a row at its source before working it. That night the ai-playbook "28 uncommitted files" were already pushed, A22 and A23 were already submitted, and the "ownerless" Chromes belonged to a job that had hung. Also read the newest class decks, since announcements never reach the ledger: an ACAD 185 deck held a $3,000 grant due in 3 days that no row mentioned.

## THE TEST

Reread your final message and look for an imperative aimed at the user. If it
is there, and it is not one of the three blockers, you are not finished: go run
it.
