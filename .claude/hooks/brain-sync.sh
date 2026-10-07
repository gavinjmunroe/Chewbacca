#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init brain-sync.sh 15
# Stop: commit what THIS session wrote to the context repos, once per turn.
#
# WHY. format-and-sync.sh used to commit every single write as
# "chore: update <file>". On 2026-10-05, 16 of the last 40 commits in the
# personal brain read exactly that, so its history could say neither what
# changed together nor why. It also missed every write made through Bash,
# which is how this kit tells agents to edit, because it only saw Write|Edit.
#
# This reads write-log.tsv (every tool that writes, Bash included) for the
# files this session touched, commits only those, by name, with the turn's
# own prompt as the subject. Another session's edits in the same repo are left
# exactly where they are.
set -uo pipefail

CONFIG="$HOME/.claude/d1-config.sh"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"

BRAIN_SYNC_PAYLOAD="$(cat)"
export BRAIN_SYNC_PAYLOAD PERSONAL_CONTEXT_DIR="${PERSONAL_CONTEXT_DIR:-}" PUBLIC_CONTEXT_DIR="${PUBLIC_CONTEXT_DIR:-}"
export CHEWBACCA_WRITE_LOG="${CHEWBACCA_WRITE_LOG:-$HOME/.chewbacca/write-log.tsv}"

python3 <<'PY'
import json, os, subprocess, sys

try:
    payload = json.loads(os.environ.get("BRAIN_SYNC_PAYLOAD") or "{}")
except ValueError:
    sys.exit(0)
sid = payload.get("session_id") or ""
log = os.environ["CHEWBACCA_WRITE_LOG"]
if not sid or not os.path.isfile(log):
    sys.exit(0)

personal = os.environ.get("PERSONAL_CONTEXT_DIR") or ""
personal = os.path.realpath(personal) if personal else ""
repos = [os.path.realpath(r) for r in (os.environ.get("PERSONAL_CONTEXT_DIR"), os.environ.get("PUBLIC_CONTEXT_DIR"))
         if r and os.path.isdir(os.path.join(r, ".git"))]
if not repos:
    sys.exit(0)

written = set()
REFUSED = []
with open(log, encoding="utf-8", errors="replace") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 3 and parts[1] == sid:
            written.add(os.path.realpath(parts[2]))


def subject():
    """The turn's prompt, first line, trimmed: the why, in the person's words."""
    path = payload.get("transcript_path") or ""
    prompt = ""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                # Hook feedback, agent messages and the compaction summary are
                # user events too. Only the person's own prompt names a commit.
                if event.get("type") != "user" or event.get("isMeta") or event.get("isCompactSummary"):
                    continue
                content = (event.get("message") or {}).get("content")
                if isinstance(content, str) and content.strip() and not content.startswith("<"):
                    prompt = content
    except OSError:
        pass
    prompt = " ".join(prompt.split())[:68]
    return prompt


# Paths come from a log, so git must read them as names, never as patterns:
# a written file called `*.md` would otherwise stage every markdown file.
GIT_ENV = dict(os.environ, GIT_LITERAL_PATHSPECS="1")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, env=GIT_ENV)


# Bash writes are in the log too, so a credential a command dropped into the
# brain would otherwise be committed and pushed. .gitignore is the real guard;
# this catches the names that should never need one.
SECRET_NAMES = (".env", ".pem", ".key", ".p12", "id_rsa", "id_ed25519", "credentials", ".netrc")


def looks_secret(rel):
    name = os.path.basename(rel).lower()
    return name.startswith(".env") or any(token in name for token in SECRET_NAMES)


for repo in repos:
    mine = sorted(os.path.relpath(p, repo) for p in written if p.startswith(repo + os.sep))
    if not mine:
        continue
    # --untracked-files=all: a new file in a new folder is otherwise reported as
    # the folder, and adding the folder sweeps in every other file inside it.
    status = git(repo, "status", "--porcelain", "-z", "--untracked-files=all", "--", *mine).stdout
    dirty = [entry[3:] for entry in status.split("\0") if len(entry) > 3]
    dirty = [rel for rel in dirty if rel in mine and not looks_secret(rel)]
    if not dirty:
        continue
    if git(repo, "add", "--", *dirty).returncode != 0:
        continue
    # The prompt names the commit only in the personal brain. The public context
    # repo is public, and a prompt can say anything.
    gist = subject() if repo == personal else ""
    head = f"brain: {gist}" if gist else f"brain: update {len(dirty)} file(s)"
    body = "\n".join(dirty[:40])
    done = git(repo, "commit", "-q", "-m", head, "-m", body, "--", *dirty)
    if done.returncode != 0:
        # Silent here meant notes sat staged and unpushed: on 2026-10-06 the
        # brain's own lint refused an unindexed memory file and nothing said
        # so. The refusal is the fix list, so hand it back once.
        why = ((done.stderr or "") + (done.stdout or "")).strip().splitlines()[:8]
        REFUSED.append((repo, dirty, why))
        continue
    # Same lock format-and-sync used: a dropped push is safe because the next
    # one sends every local commit, and a lock whose holder died is cleared.
    subprocess.Popen(
        ["sh", "-c", '''lock="$0/.git/chewbacca-push.lock"
if [ -d "$lock" ]; then
  holder="$(cat "$lock/pid" 2>/dev/null)"
  [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null && exit 0
  rm -rf "$lock"
fi
mkdir "$lock" 2>/dev/null || exit 0
echo $$ > "$lock/pid"
git -C "$0" push -q origin HEAD >/dev/null 2>&1
rm -rf "$lock"''', repo],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

if REFUSED and not payload.get("stop_hook_active"):
    for repo, files, why in REFUSED:
        print(f"brain-sync: the commit in {repo} was refused, so {len(files)} file(s) "
              f"this session wrote are staged but not saved: {', '.join(files[:6])}", file=sys.stderr)
        for line in why:
            print(f"  {line}", file=sys.stderr)
    print("Fix what it names, then end the turn again; brain-sync retries once.", file=sys.stderr)
    sys.exit(2)
PY
[ $? -eq 2 ] && exit 2
exit 0
