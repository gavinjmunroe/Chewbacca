---
name: feedback-stage-only-finished-files
description: "A 0-byte file that a manifest calls data is worse than a missing one, and six agents were sent to mine empty transcripts because of it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6587ce98-6863-400a-aaa4-4e3af1a32c1a
  modified: 2026-09-22T20:18:52.758Z
---

**2026-09-22, building the ux-engine video corpus.** 108 YouTube transcripts
were fetching in parallel. I copied the directory into the repo while the job
was still running, built `data/videos.json` from a glob of what was there, and
committed all of it as a 95-video corpus.

Eight of those files were **0 bytes**. Those eight videos had no captions and
had fallen back to local Whisper, which takes minutes, so `cp *.txt` copied
empty placeholders. The manifest then counted them as corpus.

Six extraction agents were already reading from that directory. Four of them had
been told to mine files with nothing in them, and three of those were files I
had specifically called high value: the Anthropic design lead's talk, a
conference talk on ending AI slop, and one on design taste in AI agents. **The
two most on-point titles in the entire corpus contributed nothing** and nobody
would have noticed, because a video that yields no rules and a video with no
transcript look identical in a findings file.

**Why:** a missing file announces itself. An empty file that a manifest calls
data does not, and everything downstream inherits the lie confidently. This is
a private note and
a private note in a new place: the artifact existed, so it
looked done.

**How to apply:**

- **Never copy from a directory a background job is still writing to.** Wait for
  the job, or copy only files whose producing process has exited.
- **Size-check before staging,** not after. `find dir -name "*.txt" -size -1k`
  is one command and it would have caught all eight.
- **A manifest must distinguish "no content" from "not fetched yet."** The fix
  was a `transcript` field reading `captions`, `whisper` or `pending`, so the
  count of usable sources is honest at every moment.
- **Tell the downstream workers the moment you find it.** Four agents got a
  correction mid-run naming the exact empty files and saying do not infer
  content. One of them re-transcribed its missing file itself and quarantined
  every rule from it pending approval, which is the behaviour to want.
- **Say the real number.** The commit said 87 usable, not 95.

Related: [[project_ux_engine]], [[feedback_verify_the_generated_block]],
[[feedback_measure_exit_codes_directly]]
