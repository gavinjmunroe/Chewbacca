# Showcases

Three things Chewbacca does on a stranger's machine, each with the output from a
real run and the commands that let you check it yourself. Nothing here needs an
account, a model or a permission dialog.

| Showcase | The claim | How you check it |
| --- | --- | --- |
| [Every agent, one command](every-agent.md) | 5 agents set up from a fresh clone in 3.2 to 6.2 s, every changed config backed up, all 5 restored byte for byte on undo | `bash tools/first_minute_bench.sh <clone source> <out.jsonl>` |
| [Your week in one line](your-week.md) | Commits shipped, uncommitted work and unpushed commits, read from git in seconds | every number in the receipt comes with the git command behind it |
| [Brakes on the two worst commands](brakes.md) | `rm -rf ~` and a force push to main are refused in Claude Code | pipe one JSON line into the hook and read the exit code |

Built with Chewbacca
