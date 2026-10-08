# Chewbacca on your phone

Everything Chewbacca knows about you lives in your personal context repo
(`personal-context`, made by `second-brain/init-brain.sh`). That repo is on
GitHub, so your phone reaches it through GitHub. You don't host a server,
and the data stays a bunch of folders you can read.

There are three ways in, and you'll probably want all three.

## 1. Mac on: Remote Control

Run `claude --remote-control` on the Mac, or type `/remote-control` in a
session that's already open. The session appears in the Claude app under
Code. You type on the phone and everything runs on the Mac, so hooks, local
MCP servers, `mac`, texts and the screen all work, until the Mac sleeps and
the session drops.

## 2. Mac off: a cloud session on your context repo

A cloud session starts from a GitHub repo and has none of `~/.claude`. So
mirror the setup into the repo first:

    phone-mirror --push

That copies your CLAUDE.md, rules, hooks, commands, agents and skills into
`claude/` in the repo, with symlinked skills copied as real folders. It
blanks every value in the `env` block of `settings.json` and refuses to
commit if a known token shape or any of those env values shows up in the
copy. Run it again whenever your setup changes, or call it from whatever
already syncs your brain.

Then add a section to the repo's own `CLAUDE.md` that `@imports` your core
files and `claude/rules/writing.md`, and restates your session opener, since
`~/.claude/CLAUDE.md` won't load in the cloud. Link `.claude/skills` to
`../claude/skills` so the cloud session finds the skills.

For the cloud session to act like the Mac one, give the repo a
`.claude/settings.json` SessionStart hook that runs only when
`CLAUDE_CODE_REMOTE` is `true`: pull, then name the files your Mac session
loads (your CLAUDE.md copy, core files, the memory index) and tell it to commit
and push to main after any turn that writes. Caleb's is `.claude/phone-start.sh`
in his context repo. On the Mac, `brain-sync` rebases onto what the phone
pushed before it pushes, so both sides stay one history. It pulls plain
notes only (`bin/brain-pull-safe`): scripts, dot folders, `claude/`, CLAUDE.md
and non-ASCII names are refused, and you can lock more files, such as the ones
your sessions @import, in a `.brain-pull-protect` file at the repo root. A
refusal leaves `.git/brain-pull-refused` for your session start to report.

In the Claude app, open Code, pick the repo, and start talking.

What a cloud session can't do: anything that needs the Mac itself (texts,
the screen, `mac`, peekaboo, local MCP servers), and anything that needs a
secret, because none are mirrored.

## 3. Any chat: the GitHub connector

For a quick question in a normal chat, or from a Shortcut:

1. On a computer, go to claude.ai, then Settings, then Connectors. Add GitHub.
   If it isn't in the directory, add a custom connector with
   `https://api.githubcopilot.com/mcp/`.
2. Give it read-only access to your context repo and nothing else. If it asks
   for a token, make a fine-grained token for that one repo with Contents set
   to read.
3. In the Claude app, open Settings, then Profile, and write your
   preferences: who you are, your opener, how you talk, and the line "My
   deadlines and notes are in my private GitHub repo <you>/personal-context."

Connectors follow your account, so it works on the phone once it's added on
the web.

## A voice button

Build a Shortcut: Record audio, Transcribe, then Ask Claude with a prompt like
"Voice memo from me, transcribed. Pull out every task, person and date, then
do what I'm asking:" followed by the transcription. Put it on the Action
Button (Settings, Action Button, Shortcut) or Back Tap (Settings,
Accessibility, Touch, Back Tap). Name it Chewbacca and Siri runs it by name.

The Ask Claude step goes to a normal chat, so it knows you through route 3.

Built with Chewbacca
