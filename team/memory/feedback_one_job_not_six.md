---
name: feedback-one-job-not-six
description: "Six parallel Whisper jobs pushed Caleb's load average to 50 and he felt it before I noticed; parallelism is free until the work is CPU-bound"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6587ce98-6863-400a-aaa4-4e3af1a32c1a
  modified: 2026-09-22T20:19:06.192Z
---

**2026-09-22.** I fanned six local Whisper transcriptions out with `xargs -P 6`
while Caleb was working. Twenty minutes later he asked "Why is my computer so
laggy rn." Load average was **50** on the fifteen-minute figure, and two orphaned
`mlx_whisper` processes at ~1GB each had survived my first kill.

His reply when I stopped them: _"Wait I didn't say stop if it ws for good reason
that's chill."_ So the mistake was not doing the work. It was doing it six wide
on the machine he is using, and not noticing until he told me.

**Why:** the kit's parallelism rule is about **tool calls and subagents**, which
are network-bound and genuinely close to free. Local inference is not that. Six
Whisper jobs is six cores, and on a laptop that is the whole machine. The
distinction the rule does not make is CPU-bound versus IO-bound, and that is the
one that decides whether parallel is free.

**How to apply:**

- **Network-bound work fans out.** Tool calls, API requests, subagents, `yt-dlp`
  caption fetches. Keep doing that.
- **CPU-bound local work runs one at a time,** with `nice -n 19` so the
  foreground stays responsive. Slower in wall-clock, invisible to the person
  using the machine, and it still finishes.
- **`pkill -f <name>` misses things.** Check the actual command line: these
  processes were `python -c "import mlx_whisper"`, so the pattern matched the
  parent and not the worker. Verify the count went to zero, do not assume.
- **Check `uptime` before starting anything heavy,** and check it again after.
  One command.
- **Report honestly when it was you.** Codex and Spotlight were also eating CPU
  and it would have been easy to point at them. The six jobs were mine.

Related: a private note, [[project_ux_engine]],
[[feedback_measure_exit_codes_directly]]
