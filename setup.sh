#!/bin/bash
# Chewbacca: Full Infrastructure Setup
#
# Run this ONCE from the Chewbacca repo.
# It builds your entire Claude Code infrastructure in ~5 minutes.
#
# What it creates:
#   {name}-context      PRIVATE  Your personal second brain (projects, identity, contacts)
#   claude-context      PUBLIC   Operational instructions (CLAUDE.md, rules, commands)
#
# What it wires:
#   ~/.claude/settings.json     All hooks (format, sync, session context, Todoist)
#   ~/.mcp.json or .mcp.json    Composio MCP
#
# Usage:
#   git clone https://github.com/calebnewtonusc/Chewbacca
#   cd Chewbacca
#   chmod +x setup.sh && ./setup.sh

set -e

# A sandboxed HOME must not reach the real agent config.
#
# Tests run this with HOME pointed at a temp directory. A second Claude
# account is run with CLAUDE_CONFIG_DIR=~/.claude-2, and a test started from
# that session inherited it: every `claude` call here then used the real
# account's config while macOS looked for a keychain under the fake HOME,
# which is the "A keychain cannot be found" dialogue that kept appearing
# (2026-09-22), and tools/agent_context.py wrote a temp brain path into the
# real CLAUDE.md. The config dir follows HOME whenever HOME is not the
# account's own.
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  _real_home="$(eval echo "~$(id -un)")"
  if [ "$HOME" != "$_real_home" ]; then
    case "$CLAUDE_CONFIG_DIR" in
      "$HOME"/*) ;;
      *) export CLAUDE_CONFIG_DIR="$HOME/.claude" ;;
    esac
  fi
  unset _real_home
fi

# ── Colors ────────────────────────────────────────────────────────────────────
BLU='\033[0;34m'
GRN='\033[0;32m'
YLW='\033[1;33m'
CYN='\033[0;36m'
RED='\033[0;31m'
BLD='\033[1m'
NC='\033[0m'

log()  { echo -e "  ${GRN}✓${NC} $1"; }
warn() { echo -e "  ${YLW}!${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
section() { echo -e "\n${BLD}${BLU}$1${NC}"; }
sep()  { echo -e "${BLD}────────────────────────────────────────────${NC}"; }

# Cross-platform sed in-place (macOS uses -i '', GNU uses -i)
sedi() {
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# `chewbacca setup` from PATH runs this copy inside the kit runtime, a snapshot
# that is replaced on every update. Installing from it would record the
# snapshot as the repo and link skills into a directory due to be deleted, so
# hand over to the checkout the runtime was built from.
_kr_side="$(cd -P "$SCRIPT_DIR" && pwd).kit-runtime.json"
if [ -f "$_kr_side" ]; then
  _kr_src="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("source",""))' "$_kr_side" 2>/dev/null)"
  if [ -n "$_kr_src" ] && [ -f "$_kr_src/setup.sh" ]; then
    # Catch the checkout up first. On 2026-10-11 it sat 62 commits behind main,
    # so this exec ran an old setup.sh and a hook landed that hour never
    # registered. source_sync clears only copies of already-landed files and
    # leaves real local work alone.
    _kr_sha="$(git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null)"
    if [ -n "$_kr_sha" ] && [ -f "$SCRIPT_DIR/tools/source_sync.py" ]; then
      python3 -I "$SCRIPT_DIR/tools/source_sync.py" "$_kr_src" "$_kr_sha" >&2 \
        || echo "  ! $_kr_src is behind main, so hooks added since then won't register this run" >&2
    fi
    exec bash "$_kr_src/setup.sh" "$@"
  fi
fi
BACKUP_DIR="$HOME/.claude/backups/d1-setup-$(date +%Y%m%d-%H%M%S)"
BACKED_UP=0

# Anyone who already uses Claude Code has a CLAUDE.md, hooks, and commands of
# their own. This script overwrites them by name. Copy first, always, and print
# where the copies went.
backup() {
  local src="$1" rel
  [ -e "$src" ] || return 0
  rel="${src#$HOME/.claude/}"
  mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  cp -R "$src" "$BACKUP_DIR/$rel" 2>/dev/null || return 0
  BACKED_UP=1
}

# ── Inputs ────────────────────────────────────────────────────────────────────
# Every value arrives as a flag or in an answers file. There are no read calls
# anywhere in this script, for three reasons.
#
#   1. An agent could not run it. The old version refused to start without a
#      TTY, so Claude could not set this up on your behalf even when asked to.
#   2. Blank prompts were not blank. A value already exported in the shell
#      survived an empty answer and got written to settings.json as though you
#      had typed it. Credentials now come only from a flag or the answers file.
#   3. A terminal questionnaire is the wrong surface for a Claude Code kit. The
#      /setup skill asks these in chat and calls this script with the answers.
#
# Anything not passed is simply not configured. Nothing is inferred from the
# environment, the keychain, or `gh auth token`.

usage() {
  cat <<'USAGE'
Chewbacca setup. Non-interactive by design.

The easy way, in Claude:

  claude "run the setup skill"

The direct way:

  ./setup.sh --name Jane [options]
  ./setup.sh --answers setup.answers.json

Required:
  --name <first name>          Becomes your private context repo name.

Optional:
  --runtime <name>             Install only the selected runtime adapter:
                               claude-code, codex, cursor, gemini, vscode, both,
                               auto or all. No Mac bootstrap.
  --every-agent                Same as --runtime all: every agent found on this
                               machine, each config backed up first.
                               Use --dry-run to preview; use agent export for other hosts.
  --brain-dir <path>           With --runtime, choose the private context folder.
  --json                      With --runtime, print machine-readable results.
  --team                       With --runtime, also load the shared team memory.
                               Only for Amber, Chewbacca and Firm Foundation teammates.
  --no-team                    Remove the team memory from an install that has it.
  --github-user <login>        Defaults to the logged-in gh account.
  --repo-dir <path>            Where repos live. Default ~/dev
  --anthropic-key <key>        Written to settings.json env. Omit to leave unset.
  --github-token <token>       Written to settings.json env. Omit to leave unset.
  --todoist-token <token>      Written to settings.json env. Omit to leave unset.
  --composio-url <url>         Composio MCP endpoint.
  --composio-key <key>         Composio API key.
  --answers <file.json>        Read every value above from JSON instead.

Who this install is for:
  --skip <section>             skip one section, repeatable
  --profile <name>             personal   Claude for your life. No GitHub, no
                                          repos, no stack rules, no coursework.
                               student    personal plus the coursework ledger
                                          and the study skills.
                               developer  Everything. The default, and what
                                          every previous version did.
  --fast                       Install only what makes the agent know you:
                               settings, rules, skills, subagents. Skips brew
                               packages, plugins, MCP servers and dictation.
                               Takes about two minutes instead of thirty. Run
                               `chewbacca setup` later for the rest.
  --no-github                  Skip GitHub entirely. Your second brain stays a
                               folder on this Mac. Implied by --profile personal
                               and --profile student.
  --full-send                  Alias for --bypass-permissions. Same effect,
                               a name you can remember at the end of a pasted
                               curl line.

Behaviors:
  --session-opener <name>      Opens every response with a line you choose.
                               Shipped: prayer, gratitude. Default: none.
                               Add it later:
                                 ./setup.sh --only settings --session-opener prayer
  --bypass-permissions         Claude runs shell commands and writes files
                               without asking, in the terminal, VS Code, Cursor
                               and the desktop app. Default: ON. Deny rules
                               still block the irreversible operations.
  --ask-permissions            Keep the prompts. Undo later with
                               python3 tools/no_prompts.py --off

Re-running:
  --only <section>             Run one section. Safe to repeat.
                               prereq coding-agent repos settings editor desktop mcp rules
                               plugins tools agents mac plynn verify
  --dry-run                    Print what would run and exit.
  -h, --help                   This text.
USAGE
}

NAME=""; GITHUB_USER=""; REPO_DIR=""; ANTHROPIC_KEY=""; GITHUB_PAT=""
TODOIST_TOKEN=""; COMPOSIO_URL=""; COMPOSIO_KEY=""; ANSWERS=""
# On by default since 2026-10-16. Caleb: "Make this the case for anyone that
# uses chewbs, onboarding needs to be magical", after a day of agents stopping
# to ask on every surface. --ask-permissions keeps the prompts.
SESSION_OPENER="none"; BYPASS_PERMS="yes"; ONLY=""; DRY_RUN=0
PROFILE="developer"; NO_GITHUB=0; ONLY_PORTABLE=0
FAST=0
AGENT_RUNTIME=""
AGENT_BRAIN=""; AGENT_JSON=0
SKIP_SECTIONS=""
declare -a SKIPPED=()
# Only these reach settings.json, and only when passed here in this run.
declare -a CREDS_WRITTEN=()
REQUESTED_ARGS=("$@")

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --runtime) AGENT_RUNTIME="${2:-}"; shift 2 ;;
    # Every agent already on this machine: Claude Code, Codex, Cursor, Gemini
    # CLI and VS Code, each detected, its configs backed up first.
    --every-agent) AGENT_RUNTIME=all; shift ;;
    --brain-dir) AGENT_BRAIN="${2:-}"; shift 2 ;;
    --json) AGENT_JSON=1; shift ;;
    --github-user) GITHUB_USER="${2:-}"; shift 2 ;;
    --repo-dir) REPO_DIR="${2:-}"; shift 2 ;;
    --anthropic-key) ANTHROPIC_KEY="${2:-}"; shift 2 ;;
    --github-token) GITHUB_PAT="${2:-}"; shift 2 ;;
    --todoist-token) TODOIST_TOKEN="${2:-}"; shift 2 ;;
    --composio-url) COMPOSIO_URL="${2:-}"; shift 2 ;;
    --composio-key) COMPOSIO_KEY="${2:-}"; shift 2 ;;
    --answers) ANSWERS="${2:-}"; shift 2 ;;
    --session-opener) SESSION_OPENER="${2:-none}"; shift 2 ;;
    --bypass-permissions) BYPASS_PERMS="yes"; shift ;;
    --ask-permissions) BYPASS_PERMS="no"; shift ;;
    --profile)
      PROFILE="${2:-developer}"
      case "$PROFILE" in
        personal|student|developer|portable) ;;
        *) err "unknown profile: $PROFILE"
           err "  one of: personal, student, developer, portable"
           exit 2 ;;
      esac
      # portable is the neutral half: standards, skills, commands, subagents.
      # No Homebrew, no Mac tools, no MCP, no permissions, no repos. It is the
      # only profile that works on a machine this kit does not otherwise run on,
      # and configures both agent homes without installing Mac tools.
      if [ "$PROFILE" = portable ]; then NO_GITHUB=1; ONLY_PORTABLE=1; fi
      shift 2 ;;
    --no-github) NO_GITHUB=1; shift ;;
    --full-send) BYPASS_PERMS="yes"; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    # --only ran one section and there was no way to run everything except
    # one. Repeatable: --skip plynn --skip mac.
    --skip) SKIP_SECTIONS="$SKIP_SECTIONS ${2:-}"; shift 2 ;;
    # The whole install is a few gigabytes of Homebrew formulae, nineteen Claude
    # plugins and twelve MCP servers, and it ran past thirty minutes in testing
    # on 2026-09-19. That is fine for the person who lives in this kit and
    # useless in a twenty minute call, where the thing being shown is ingestion
    # and nothing else. --fast installs the part that makes the agent know you:
    # settings, rules, skills, subagents. Everything else is one later command.
    --fast|--minimal)
      SKIP_SECTIONS="$SKIP_SECTIONS editor desktop mcp plugins tools plynn"
      FAST=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --team) AGENT_TEAM=1; shift ;;
    --no-team) AGENT_TEAM=0; AGENT_NO_TEAM=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown argument: $1"; echo; usage; exit 2 ;;
  esac
done

# Runtime setup is independent of the historical Mac/Claude bootstrap. A fresh
# Codex install must not need Claude credentials, Homebrew or a GitHub account.
if [ -n "$AGENT_RUNTIME" ]; then
  for ((arg_index=0; arg_index<${#REQUESTED_ARGS[@]}; arg_index++)); do
    case "${REQUESTED_ARGS[$arg_index]}" in
      --runtime|--name|--brain-dir) arg_index=$((arg_index + 1)) ;;
      --dry-run|--json|--team|--no-team|--every-agent|--bypass-permissions|--full-send|--ask-permissions) ;;
      *) err "Runtime setup does not accept ${REQUESTED_ARGS[$arg_index]}; use the full installer or native host settings for that option."
         exit 2 ;;
    esac
  done
  action=setup
  [ "$DRY_RUN" -eq 1 ] && action=plan
  runtime_args=("$action" --runtime "$AGENT_RUNTIME")
  [ -n "$NAME" ] && runtime_args+=(--name "$NAME")
  [ -n "$AGENT_BRAIN" ] && runtime_args+=(--brain-dir "$AGENT_BRAIN")
  [ "$AGENT_JSON" -eq 1 ] && runtime_args+=(--json)
  [ "${AGENT_TEAM:-0}" -eq 1 ] && runtime_args+=(--team)
  [ "${AGENT_NO_TEAM:-0}" -eq 1 ] && runtime_args+=(--no-team)
  if [ "$action" = plan ] || [ "$AGENT_JSON" -eq 1 ]; then
    exec python3 "$SCRIPT_DIR/tools/agent_runtime.py" "${runtime_args[@]}"
  fi
  python3 "$SCRIPT_DIR/tools/agent_runtime.py" "${runtime_args[@]}" || exit $?
  # The one-line install never reached the permission settings, so a new user
  # was prompted on every surface (2026-10-16). Same default as the full path.
  if [ "$BYPASS_PERMS" = "yes" ]; then
    echo
    echo "Turning off permission prompts (keep them: --ask-permissions):"
    python3 "$SCRIPT_DIR/tools/no_prompts.py" || true
  fi
  # The first win, before anyone opens an agent: their own week from the git
  # repos already here, read only, with a receipt of the commands behind it.
  echo
  python3 "$SCRIPT_DIR/tools/first_win.py" || true
  exit 0
fi
if [ -n "$AGENT_BRAIN" ] || [ "$AGENT_JSON" -eq 1 ]; then
  err "--brain-dir and --json require --runtime"
  exit 2
fi

# A profile is a set of defaults, not a separate code path. It decides what a
# section does rather than whether the script runs, so every section stays
# reachable with --only and the whole thing stays one file.
case "$PROFILE" in
  personal|student) NO_GITHUB=1 ;;
  portable) NO_GITHUB=1; ONLY_PORTABLE=1 ;;
  developer) ;;
  *) err "unknown profile: $PROFILE"
     err "  one of: personal, student, developer, portable"
     exit 2 ;;
esac

# The answers file fills anything a flag did not. Flags win, so a one-off
# override never means editing the file.
if [ -n "$ANSWERS" ]; then
  [ -f "$ANSWERS" ] || { err "answers file not found: $ANSWERS"; exit 2; }
  eval "$(python3 - "$ANSWERS" <<'PYEOF'
import json, shlex, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f'err "answers file is not valid JSON: {e}"; exit 2')
    raise SystemExit(0)
pairs = {
    "name": "NAME", "github_user": "GITHUB_USER", "repo_dir": "REPO_DIR",
    "anthropic_key": "ANTHROPIC_KEY", "github_token": "GITHUB_PAT",
    "todoist_token": "TODOIST_TOKEN", "composio_url": "COMPOSIO_URL",
    "composio_key": "COMPOSIO_KEY", "session_opener": "SESSION_OPENER",
}
for k, var in pairs.items():
    v = d.get(k)
    if v:
        print(f'[ -n "${{{var}:-}}" ] || {var}={shlex.quote(str(v))}')
if d.get("bypass_permissions") is True:
    print('BYPASS_PERMS=yes')
PYEOF
)"
fi

if [ -z "$NAME" ] && [ "${ONLY:-}" = "repos" ]; then
  err "--only repos still needs --name: it is what the repo is called"
  exit 2
fi

# A RE-INSTALL HAS ALREADY ANSWERED THESE QUESTIONS.
#
# `chewbacca update` pulls and then runs this file with no arguments, which hit
# the --name guard below and exited 2. Every time, on every machine. So update
# fast-forwarded new hooks, skills, commands and tools and then installed none
# of them, and the only symptom was an exit code in a command nobody reads the
# tail of. Found 2026-09-22 while making pull-and-push the default, which is
# exactly the thing that made it matter: pulling code you never install is
# worse than not pulling, because now the repo and the machine disagree and
# every surface reports the new version.
#
# --name exists to name the personal context repo, which only the `repos`
# section creates. On a machine that already has an install manifest that repo
# exists, so the section has nothing left to do and its one input is not
# needed. Skip it and let the rest of the install proceed.
REINSTALL=0
if [ -z "$NAME" ] && [ -z "$ONLY" ] && [ -z "$ANSWERS" ] && \
   [ -f "$HOME/.chewbacca/install-manifest.json" ]; then
  REINSTALL=1
  SKIP_SECTIONS="$SKIP_SECTIONS repos"
fi

if [ -z "$NAME" ] && [ -z "$ONLY" ] && [ "$NO_GITHUB" -eq 0 ] && [ "$REINSTALL" -eq 0 ]; then
  err "--name is required (or --answers, or --only <section>)"
  echo
  usage
  exit 2
fi

USER_NAME="$(printf '%s' "$NAME" | tr -cd '[:alnum:] _-' | xargs)"
if [ -n "$USER_NAME" ]; then
  USER_NAME_LOWER=$(printf '%s' "$USER_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
  PERSONAL_REPO="${USER_NAME_LOWER}-context"
fi

WORKSPACE_DIR="${REPO_DIR:-$HOME/dev}"
WORKSPACE_DIR="${WORKSPACE_DIR/#\~/$HOME}"
case "$WORKSPACE_DIR" in /*) ;; *) WORKSPACE_DIR="$PWD/$WORKSPACE_DIR" ;; esac
# A dry run must not touch the disk. This mkdir ran before the dry-run branch,
# so `--dry-run --repo-dir /somewhere` created /somewhere and then printed that
# it would not do anything.
if [ "$DRY_RUN" -eq 0 ] && [ "$ONLY" != agents ]; then
  mkdir -p "$WORKSPACE_DIR"
  WORKSPACE_DIR="$(cd "$WORKSPACE_DIR" && pwd)"
fi

# --only runs one section. Everything here is written to be safe to repeat, so
# a run that died halfway, or a tool that arrived after the first run, is one
# flag away rather than a hand-copied block from this file.
# PLYNN IS OUT OF THE DEFAULT INSTALL, 2026-09-21.
#
# Dictation moved into the HUD, which draws its own pill. Plynn kept running as
# a separate app drawing the legacy indicator, so two overlapping systems were
# live at once and the one people saw was the retired one: "Secure field,
# dictation paused", from PlynnKit/IndicatorView.swift.
#
# The source stays in plynn/ and the installer still works if asked for by
# name, because the parts worth folding into the HUD are listed in
# plynn/SALVAGE.md. It just no longer installs and auto-starts behind a second
# indicator nobody asked for.
#
#     ./setup.sh --only plynn     still installs it
SECTIONS="prereq coding-agent repos settings editor desktop mcp rules skills plugins tools agents verify manifest"
if [ -n "$ONLY" ]; then
  case " $SECTIONS " in
    *" $ONLY "*) ;;
    *) err "unknown section: $ONLY"; err "one of: $SECTIONS"; exit 2 ;;
  esac
fi
PORTABLE_SECTIONS=" settings rules skills agents manifest verify "
should_run() {
  case " $SKIP_SECTIONS " in
    *" $1 "*) SKIPPED+=("$1 (--skip)"); return 1 ;;
  esac
  if [ "$ONLY_PORTABLE" -eq 1 ]; then
    case "$PORTABLE_SECTIONS" in
      *" $1 "*) ;;
      *) SKIPPED+=("$1 (portable profile)"); return 1 ;;
    esac
  fi
  if [ -n "$ONLY" ] && [ "$ONLY" != "$1" ]; then
    SKIPPED+=("$1 (--only $ONLY)")
    return 1
  fi
  return 0
}

initialize_personal_context() {
  # Modern second brains already own their layout. Flat templates are additive.
  [ -d "$PC_DIR/core" ] && return 0
  mkdir -p "$PC_DIR/memory"
  local context_file
  for context_file in YOU NOW PEOPLE VOICE SYSTEM STACK SCHOOL; do
    if [ ! -e "$PC_DIR/$context_file.md" ]; then
      cp "$SCRIPT_DIR/second-brain/context/$context_file.md" "$PC_DIR/$context_file.md"
      if [ "$context_file" = YOU ] && [ -n "$USER_NAME" ]; then
        sedi "s/YOUR_NAME/$USER_NAME/g" "$PC_DIR/YOU.md"
        sedi "s/YOUR_GITHUB_USERNAME/${GITHUB_USER:-}/g" "$PC_DIR/YOU.md"
      fi
    fi
  done
  if [ ! -e "$PC_DIR/memory/MEMORY.md" ]; then
    printf '# Memory index\n\nAdd links to shared personal memory here as it is recorded.\n' > "$PC_DIR/memory/MEMORY.md"
  fi
}

# Telling somebody their PATH is wrong, at the end of an install, is handing
# them a chore. start.sh already writes this line into their shell; setup.sh
# run on its own did not, so it warned twice about something it could have
# fixed in three lines. Do the edit, then say what it did.
ensure_local_bin_on_path() {
  local rc added=0
  case ":$PATH:" in *":$HOME/.local/bin:"*) return 0 ;; esac
  for rc in "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    grep -q '.local/bin' "$rc" 2>/dev/null && continue
    printf '\n# Added by Chewbacca\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    added=1
  done
  export PATH="$HOME/.local/bin:$PATH"
  [ "$added" -eq 1 ] && log "Added ~/.local/bin to your PATH. New terminals pick it up automatically."
  return 0
}

# A Terminal.app started from inside a Claude Code session hands its
# environment to every window it opens afterwards, and the login shell keeps
# it. On 2026-09-20 the voice agent, itself carrying a session's variables,
# ran `open -a Terminal -n` twice (21:34, 23:22); each started a second
# Terminal.app instance, and the `claude` opened in one of them at 00:47 drew
# a block under every word (FORCE_COLOR=3 is 24-bit colour Terminal.app cannot
# parse) and saved no transcript (CLAUDE_CODE_CHILD_SESSION=1).
#
# The block is rewritten rather than appended when it is already there, so a
# machine that took an earlier version of this guard gets the current one.
TERMINAL_GUARD_MARK="# Added by Chewbacca: a window is not a Claude Code child session"
TERMINAL_GUARD_END="# End of the Chewbacca terminal guard"
write_terminal_guard() {
  cat <<'GUARD'

# Added by Chewbacca: a window is not a Claude Code child session
# A Terminal.app opened from inside a Claude Code session hands that session's
# environment to every window it opens. Two halves, because the two kinds of
# variable are wrong for different reasons.
#
# The session marker, for a shell a person opened. A shell whose parent is
# login is one of those. Claude's own tool shells have claude as a parent and
# keep theirs, because CLAUDE_CODE_MESSAGING_SOCKET is how their tools reach
# the session they belong to.
if [ "$(ps -o comm= -p "$PPID" 2>/dev/null)" = "login" ]; then
  unset CLAUDECODE
  for _chewbacca_var in $(env | sed -n 's/^\(CLAUDE_CODE_[A-Za-z0-9_]*\)=.*/\1/p'); do
    unset "$_chewbacca_var"
  done
  unset _chewbacca_var
fi
# The colour, for every shell in Terminal.app. Terminal.app declares
# xterm-256color and its terminfo carries no 24-bit entry, so FORCE_COLOR=3 or
# COLORTERM=truecolor in one of its windows was inherited and is always wrong:
# Claude Code writes 24-bit escapes the terminal cannot parse and leaves a
# block behind every word. This half is not gated on the parent, because a
# nested shell, a tmux pane, and a window opened before this guard existed all
# have the same broken colour and a different parent.
if [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ]; then
  unset FORCE_COLOR COLORTERM CLICOLOR_FORCE
fi
# End of the Chewbacca terminal guard
GUARD
}
ensure_terminal_shell_guard() {
  # Strip any previous copy, then write the current one. Rewriting rather than
  # skipping is what upgrades a machine that took an earlier version.
  local rc had tmp
  for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
    [ -f "$rc" ] || continue
    had=0
    if grep -qF "$TERMINAL_GUARD_MARK" "$rc" 2>/dev/null; then
      had=1
      tmp="$(mktemp)" || return 0
      # The first version (29bb83ee) wrote no end marker; its block ends at
      # its one `fi`. Stripping to an end marker that isn't there deleted the
      # rest of the user's rc (break-it, 2026-10-19), so without one the strip
      # stops at that `fi`. Blank lines right before the block go with it, or
      # every refresh added one. A copy of the rc is kept either way.
      local hasend=0
      grep -qF "$TERMINAL_GUARD_END" "$rc" 2>/dev/null && hasend=1
      cp -p "$rc" "$rc.chewbacca-bak"
      awk -v s="$TERMINAL_GUARD_MARK" -v e="$TERMINAL_GUARD_END" -v hasend="$hasend" '
        index($0,s) { f=1; blank=""; next }
        f { if (hasend ? index($0,e) : ($0 ~ /^fi[[:space:]]*$/)) f=0; next }
        /^[[:space:]]*$/ { blank = blank $0 "\n"; next }
        { printf "%s", blank; blank=""; print }
        END { printf "%s", blank }' "$rc" > "$tmp"
      cat "$tmp" > "$rc"
      rm -f "$tmp"
    fi
    write_terminal_guard >> "$rc"
    if [ "$had" -eq 1 ]; then
      log "Refreshed the terminal guard in $(basename "$rc")."
    else
      log "Added the terminal guard to $(basename "$rc"): a window opened by a Claude session no longer inherits its colour and session variables."
    fi
  done
  return 0
}

link_tool() {
  local name="$1" src="$SCRIPT_DIR/bin/$1" dst="$HOME/.local/bin/$1"
  [ -f "$src" ] || return 1
  mkdir -p "$HOME/.local/bin"
  # Through the kit runtime when it has the tool (see "Kit runtime" below), so
  # PATH never runs a tab's uncommitted edit. A tool only on this branch
  # links here until it reaches origin/main and kit-autopull moves the link.
  local target="$src"
  [ -f "${KIT_RUNTIME:-$HOME/.chewbacca/kit}/current/bin/$name" ] &&
    target="${KIT_RUNTIME:-$HOME/.chewbacca/kit}/current/bin/$name"
  # -n so that when dst is already a symlink to a DIRECTORY we replace it rather
  # than writing inside it; -f to replace an existing copy from an older setup.
  ln -sfn "$target" "$dst"
  chmod +x "$src"
}

install_backend_launchers() {
  local backend_tool
  for backend_tool in chatgpt-tab chatgpt-gateway perplexity-tab jev-browse chewbacca-bridge chewbacca-browser mac-use chrome-js; do
    link_tool "$backend_tool"
  done
  # The native host for ChatGPT and Claude in Chrome. Registering it writes one
  # file naming one extension id; loading the extension stays a person's click.
  { python3 "$SCRIPT_DIR/bin/chewbacca-browser" install || warn "chewbacca browser install failed; run it again once Chrome is installed"; } |
    while read -r line; do log "$line"; done
  log "Chewbacca backend launchers refreshed in ~/.local/bin"
}

# Shared standards apply to every runtime even when lifecycle hooks are disabled.
# Keep one installed source; do not scope universal guidance to Codex file paths.
install_agent_neutral_rule() {
  local dst="$HOME/.claude/rules/agent-neutral.md"
  mkdir -p "$HOME/.claude/rules"
  cp "$SCRIPT_DIR/config/instructions/agent-neutral.md" "$dst"
}

install_agent_instructions() {
  install_agent_neutral_rule
  python3 "$SCRIPT_DIR/tools/agents_md.py"
  initialize_personal_context
  python3 "$SCRIPT_DIR/tools/agent_runtime.py" setup --runtime both --brain-dir "$PC_DIR" $( [ "${AGENT_TEAM:-0}" -eq 1 ] && echo --team )
  if ! command -v jq >/dev/null 2>&1; then
    warn "jq is missing: context loading works, but shared file and reply checks require jq"
  fi
  if command -v codex >/dev/null 2>&1; then
    log "Codex installed; shared context and runtime configuration ready"
  else
    log "Codex absent (optional); configuration ready for installation"
  fi
}


if [ "$DRY_RUN" -eq 1 ]; then
  echo "Would run: ${ONLY:-all sections}${SKIP_SECTIONS:+, skipping$SKIP_SECTIONS}"
  echo "  profile:         $PROFILE$([ "$ONLY_PORTABLE" -eq 1 ] && echo "  (Claude and Codex configuration, no Mac tools)")"
  echo "  github:          $([ "$NO_GITHUB" -eq 1 ] && echo "skipped, brain stays local" || echo "two repos created and pushed")"
  echo "  name:            ${USER_NAME:-<unset>}"
  echo "  repo dir:        $WORKSPACE_DIR"
  echo "  session opener:  $SESSION_OPENER"
  echo "  bypass perms:    $BYPASS_PERMS"
  _dry_agent=""
  for a in claude codex gemini; do command -v "$a" &>/dev/null && { _dry_agent="$a"; break; }; done
  [ -z "$_dry_agent" ] && [ -x "$HOME/.local/bin/claude" ] && _dry_agent="claude"
  _dry_installs=1
  [ "$ONLY_PORTABLE" -eq 1 ] && _dry_installs=0
  [ -n "$ONLY" ] && [ "$ONLY" != coding-agent ] && _dry_installs=0
  case " $SKIP_SECTIONS " in *" coding-agent "*) _dry_installs=0 ;; esac
  if [ -n "$_dry_agent" ]; then echo "  agent:           $_dry_agent"
  elif [ "$_dry_installs" -eq 1 ]; then echo "  agent:           none found, Claude Code would be installed (needs a paid Claude plan)"
  else echo "  agent:           none found, and this run would not install one"; fi
  for pair in "anthropic:$ANTHROPIC_KEY" "github:$GITHUB_PAT" "todoist:$TODOIST_TOKEN"; do
    [ -n "${pair#*:}" ] && echo "  credential:      ${pair%%:*} (would be written to settings.json)"
  done
  exit 0
fi

# Kit runtime, unguarded on purpose: every link_tool below reads it, under
# any --only. PATH tools run from ~/.chewbacca/kit/current, a locked worktree of
# origin/main that no agent edits, never from this checkout's working tree. On
# 2026-10-10 every tool in ~/.local/bin linked into the shared checkout, which
# could not fast-forward under six tabs' edits, so `chewbacca` on PATH ran code
# main had replaced. Built here, before the first link_tool, so a fresh install
# gets the same layout kit-autopull and the launchd timer keep current. A
# checkout with no origin/main (a tarball, a fork mid-setup) falls back to
# linking this tree, as before. CHEWBACCA_NO_RUNTIME=1 skips it.
KIT_RUNTIME="${CHEWBACCA_KIT_RUNTIME:-$HOME/.chewbacca/kit}"
# Only for runs that link tools: `--only coding-agent` and friends never call
# link_tool, and the hermetic tests run those against a scratch HOME.
case "${ONLY:-}" in ""|agents|tools) _kr_wanted=1 ;; *) _kr_wanted=0 ;; esac
if [ "$_kr_wanted" = 1 ] && [ "${CHEWBACCA_NO_RUNTIME:-0}" != 1 ] && [ -f "$SCRIPT_DIR/tools/kit_runtime.py" ]; then
  if _kr_out="$(python3 -I "$SCRIPT_DIR/tools/kit_runtime.py" update --repo "$SCRIPT_DIR" --adopt 2>&1)"; then
    log "Kit runtime: $_kr_out ($KIT_RUNTIME/current)"
  else
    warn "Kit runtime not built ($_kr_out). Tools will link into $SCRIPT_DIR"
  fi
fi

if [ -n "${CHEWBACCA_BRAIN_DIR:-}" ]; then
  PC_DIR="$(python3 "$SCRIPT_DIR/tools/codex_context.py" path)"
elif [ -n "$USER_NAME" ]; then
  PC_DIR="$WORKSPACE_DIR/$PERSONAL_REPO"
else
  PC_DIR="$(python3 "$SCRIPT_DIR/tools/codex_context.py" path)"
fi

if [ "$ONLY" = agents ]; then
  if [ "$ONLY_PORTABLE" -eq 0 ]; then install_backend_launchers; fi
  install_agent_instructions
  exit 0
fi

echo ""
sep
echo -e "  ${BLD}Chewbacca: Infrastructure Setup${NC}"
sep
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
if should_run prereq; then
section "Checking prerequisites"
MISSING=0

# Each of these used to print its own error and its own brew command, on a
# machine that might not have brew either. "Install: brew install gh" is a dead
# end for the person this kit is aimed at. bootstrap.sh installs the lot, and
# names the two steps that genuinely need a human.
# gh is only a prerequisite when we are going to talk to GitHub. Requiring the
# GitHub CLI from someone who does not have a GitHub account is the same
# blocker as requiring the account, one layer down.
REQUIRED="git:git python3:python3 jq:jq"
[ "$NO_GITHUB" -eq 0 ] && REQUIRED="gh:GitHub-CLI $REQUIRED"
for pair in $REQUIRED; do
  cmd="${pair%%:*}"
  command -v "$cmd" &>/dev/null || { err "missing: ${pair##*:} ($cmd)"; MISSING=1; }
done
if ! command -v bun &>/dev/null && ! command -v node &>/dev/null; then
  err "missing: node or bun"
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "  Run this first. It installs all of them:"
  echo ""
  echo "      ./bin/bootstrap.sh"
  echo ""
  echo "  Or let Claude do it:  claude \"run the setup skill\""
  exit 1
fi

# Two hard exits used to live here, and together they were the reason someone
# with a Claude subscription and no GitHub account could not run this at all.
# Neither is needed unless we are actually going to create and push repos.
if [ "$NO_GITHUB" -eq 0 ] && ! gh auth status &>/dev/null; then
  err "Not signed in to GitHub. This needs a browser, so it cannot run from here:"
  err "  gh auth login"
  err "Then re-run. ./bin/bootstrap.sh checks this too."
  err ""
  err "Or skip GitHub. Your second brain becomes a folder on this Mac:"
  err "  ./setup.sh --profile personal --name <your name>"
  exit 1
fi

# gh auth login lets you decline git credential setup, and every remote this
# script writes is HTTPS. Without this, push blocks on a username prompt.
[ "$NO_GITHUB" -eq 0 ] && { gh auth setup-git &>/dev/null || true; }

# A clean macOS install has no git identity. Without one, every commit below
# fails with "Author identity unknown", both repos get created and pushed empty,
# and the sync hook then fails silently forever because it swallows the error.
# Catch it here where there is still someone at the keyboard to answer.
if [ "$NO_GITHUB" -eq 1 ]; then
  # Nothing gets pushed on this path, so a missing identity costs nothing. Set
  # a local one anyway if git is present, so the brain folder can still keep
  # history for the user without ever asking them what an email address is for.
  if command -v git &>/dev/null && [ -z "$(git config --global user.name 2>/dev/null)" ]; then
    log "No git identity set, and none needed: nothing here is pushed anywhere"
  fi
elif [ -z "$(git config --global user.name 2>/dev/null)" ] ||
  [ -z "$(git config --global user.email 2>/dev/null)" ]; then
  err "No global git identity is set. Every commit this script makes would fail."
  err "Set one, then re-run:"
  err "  git config --global user.name \"Your Name\""
  err "  git config --global user.email \"you@example.com\""
  err ""
  err "Or skip GitHub entirely:  ./setup.sh --profile personal --name <your name>"
  exit 1
else
  log "Git identity: $(git config --global user.name) <$(git config --global user.email)>"
fi

# A passed --github-user wins; the logged-in account is only the fallback.
#
# `VAR="$(failing-cmd)"` as a standalone assignment exits under set -e, and
# `gh api user` exits 4 on a machine where gh is installed but nobody has
# signed in, which is every machine running the personal profile. The whole
# install died right here, silently, with no error and exit 4, after printing
# one line about git identity. The same mistake was already found and fixed
# thirteen lines below this one; this copy was missed.
#
# NO_GITHUB means no repo is ever created, so there is nothing to look up.
if [ "$NO_GITHUB" -eq 0 ]; then
  GITHUB_USER="${GITHUB_USER:-$(gh api user --jq .login 2>/dev/null || true)}"
fi
fi

# Outside the agent section on purpose. Claude Code's native installer lands
# in ~/.local/bin, which a shell opened before it ran does not have on PATH,
# and `--only plugins` skips the agent section, so the plugins step would
# report no claude on a Mac that has one.
KIT_AGENT=""
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  [ -x "$HOME/.local/bin/claude" ] && export PATH="$HOME/.local/bin:$PATH" ;;
esac

# ── An agent to drive all of this ────────────────────────────────────────────
if should_run coding-agent; then
  # INSTALL AN AGENT ONLY IF THEY HAVE NONE, AND SAY WHAT IT COSTS FIRST.
  #
  # This used to install Claude Code whenever `claude` was missing, full
  # stop. On 2026-09-19 that put Sam, who runs Codex, in front of a
  # Claude credits purchase during the install of a kit sold as model
  # agnostic. He said so and stopped: "how is this model agnostic? i
  # don't want to add claude credits." A second tester said the same.
  # So an agent already here is used and nothing is installed.
  #
  # With no agent at all the kit does nothing, and Kyber's voice runs on
  # `claude -p`, so a bare Mac still gets Claude Code (Gavin, 2026-10-05). Two
  # things changed from the npm version that lived in the plugins section:
  # it ran only when npm existed and only when plugins ran, so `--fast` got
  # no agent and a dead end on the last screen;
  # and it said "the free tier works", which Anthropic's setup page
  # contradicts: "The free claude.ai plan does not include Claude Code
  # access." Anthropic's native installer needs no Node, lands in
  # ~/.local/bin, and is signed and notarized. The plan requirement is
  # printed before the download, so nobody meets it as a surprise.
  #
  # Not in the portable profile: that one promises to write ~/.claude and
  # nothing else, on machines this kit does not otherwise run on.
  CLAUDE_CODE_INSTALLER="${CHEWBACCA_CLAUDE_CODE_INSTALLER:-https://claude.ai/install.sh}"
  section "Your agent"
  # Codex that came inside ChatGPT.app or Codex.app has no `codex` on PATH, so
  # a USC student with free ChatGPT Edu Codex looked agentless and got Claude
  # Code plus a paid-plan warning. Put a shim on PATH first (2026-10-10).
  if ! command -v claude &>/dev/null && ! command -v codex &>/dev/null; then
    python3 "$SCRIPT_DIR/tools/agent_runtime.py" shims >/dev/null 2>&1 || true
    export PATH="$HOME/.local/bin:$PATH"
  fi
  for a in claude codex gemini; do
    if command -v "$a" &>/dev/null; then KIT_AGENT="$a"; break; fi
  done

  if [ -n "$KIT_AGENT" ]; then
    log "using the agent already installed: $KIT_AGENT"
  else
    log "No coding agent on this machine, so Chewbacca is installing Claude Code from Anthropic."
    warn "Claude Code is free to download. Using it needs a paid Claude plan: Pro, Max,"
    warn "  Team or Enterprise, or an Anthropic Console account. The free claude.ai plan"
    warn "  does not include it. You sign in the first time it opens."
    if curl -fsSL --connect-timeout 15 --max-time 300 "$CLAUDE_CODE_INSTALLER" 2>/dev/null | bash >/dev/null 2>&1 \
      && [ -x "$HOME/.local/bin/claude" ]; then
      export PATH="$HOME/.local/bin:$PATH"
      KIT_AGENT="claude"
      log "Claude Code installed"
    else
      warn "Claude Code did not install. Everything else still installs. To add it later:"
      warn "  curl -fsSL https://claude.ai/install.sh | bash"
    fi
  fi
fi

# ── Collect info ──────────────────────────────────────────────────────────────
# Nothing to collect. Every value came in as a flag or from the answers file,
# and anything absent stays absent rather than being guessed at.
section "About you"
# `VAR="$(failing-cmd)"` as a standalone assignment exits under set -e. With
# --only settings the prereq check never runs, so an unauthenticated gh killed
# the script here with no output at all.
GITHUB_USER="${GITHUB_USER:-$(gh api user --jq .login 2>/dev/null || true)}"
log "Name: ${USER_NAME:-<unset>}"
log "GitHub: ${GITHUB_USER:-<unknown>}"
log "Repos: $WORKSPACE_DIR"

# ── Repo 1: {name}-context (private) ─────────────────────────────────────────
if should_run repos && [ -n "${USER_NAME:-}" ]; then
section "Creating $PERSONAL_REPO (private personal brain)"

export D1_PC_DIR="$PC_DIR"
initialize_personal_context

log "Templates copied to $PC_DIR"

echo ""
echo "  Claude and Codex read the same personal context at session start."
echo ""
# This used to launch $EDITOR, falling back to nano and then vi, and block until
# the file was closed. On a Mac with no EDITOR set that is vi, and someone who
# has never seen vi cannot get out of it. The install appeared to hang, in a
# text editor, with no instructions. Nothing here is worth that: Claude fills
# this file in by asking, which is the whole design of the kit anyway.
if [ "$PROFILE" = "developer" ] && [ -n "${EDITOR:-}" ] && command -v "${EDITOR%% *}" &>/dev/null; then
  log "Opening YOU.md in $EDITOR"
  $EDITOR "$PC_DIR/YOU.md" || true
else
  log "YOU.md is a template. Ask Claude to fill it in with you."
fi

if [ "$NO_GITHUB" -eq 1 ]; then
  log "Staying local: $PC_DIR is a folder on this Mac, not a repo"
elif gh repo view "$GITHUB_USER/$PERSONAL_REPO" &>/dev/null; then
  warn "Repo $GITHUB_USER/$PERSONAL_REPO already exists, using existing"
else
  gh repo create "$GITHUB_USER/$PERSONAL_REPO" \
    --private \
    --description "$USER_NAME's personal context for Claude, identity, projects, contacts" \
    2>/dev/null || true
  if gh repo view "$GITHUB_USER/$PERSONAL_REPO" &>/dev/null; then
    log "Created github.com/$GITHUB_USER/$PERSONAL_REPO (private)"
  else
    warn "Could not create $GITHUB_USER/$PERSONAL_REPO. Check your token scopes."
    warn "  Local files are still written; create the repo and push by hand."
  fi
fi

cd "$PC_DIR"
git init -q 2>/dev/null || true
if [ "$NO_GITHUB" -eq 0 ]; then
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$GITHUB_USER/$PERSONAL_REPO.git"
fi

# This repo is private and personal. Keep OS cruft and any stray secret out of
# it from the first commit, and stage by filename per .claude/rules/git.md
# instead of sweeping the directory with `git add .`.
cat > "$PC_DIR/.gitignore" << 'GITIGNORE'
.DS_Store
Thumbs.db
.env
.env.*
!.env.example
*.log
GITIGNORE

git add -- .gitignore YOU.md NOW.md PEOPLE.md VOICE.md SYSTEM.md STACK.md SCHOOL.md memory/MEMORY.md
# A commit needs an identity. On the no-GitHub path we may not have one, and
# asking for an email to make a local commit nobody will ever read is exactly
# the kind of question this profile exists to delete.
if [ -n "$(git config user.name 2>/dev/null)" ] || [ "$NO_GITHUB" -eq 0 ]; then
  git diff --cached --quiet || git commit -q -m "init: $USER_NAME personal context"
  git branch -M main
fi
if [ "$NO_GITHUB" -eq 1 ]; then
  log "$PC_DIR"
else
  git push -u origin main -q 2>/dev/null || warn "Push failed, you may need to push manually"
  log "https://github.com/$GITHUB_USER/$PERSONAL_REPO"
fi
fi

# Skipped without GitHub: this one exists only to be a public repo, so there is
# no local half of it worth writing.
# ── Repo 2: claude-context (public) ──────────────────────────────────────────
if should_run repos && [ -n "${USER_NAME:-}" ] && [ "$NO_GITHUB" -eq 0 ]; then
section "Creating claude-context (public operational rules)"

CC_DIR="$WORKSPACE_DIR/claude-context"
mkdir -p "$CC_DIR/.claude/commands" "$CC_DIR/.claude/rules" "$CC_DIR/.claude/hooks"

cp "$SCRIPT_DIR/CLAUDE.md" "$CC_DIR/CLAUDE.md"
cp "$SCRIPT_DIR/.claude/commands/"*.md "$CC_DIR/.claude/commands/" 2>/dev/null || true
cp "$SCRIPT_DIR/.claude/rules/"*.md    "$CC_DIR/.claude/rules/"    2>/dev/null || true
cp "$SCRIPT_DIR/.claude/hooks/"*       "$CC_DIR/.claude/hooks/"    2>/dev/null || true

cat > "$CC_DIR/README.md" << READMEOF
# claude-context

Operational instructions for Claude Code: design system, coding standards, slash commands, and hooks.

Forked from [Chewbacca](https://github.com/calebnewtonusc/Chewbacca).

## What's here

- \`CLAUDE.md\`, full design system, behavioral rules, coding standards
- \`.claude/commands/\`: slash commands covering the dev lifecycle, coursework, and the weekly review
- \`.claude/rules/\`: always-on standards (unscoped ones load on their own, a few are imported by CLAUDE.md), plus some that load on demand
- \`.claude/hooks/\`: PostToolUse formatters and linters

## How to use

Copy \`CLAUDE.md\` and \`.claude/\` into any project:

\`\`\`bash
cp CLAUDE.md /path/to/project/
cp -r .claude/ /path/to/project/.claude/
\`\`\`

Or copy globally:

\`\`\`bash
cp CLAUDE.md ~/.claude/CLAUDE.md
\`\`\`

## Source

Built and maintained at [Chewbacca](https://github.com/calebnewtonusc/Chewbacca).
READMEOF

if gh repo view "$GITHUB_USER/claude-context" &>/dev/null; then
  warn "Repo $GITHUB_USER/claude-context already exists, using existing"
else
  gh repo create "$GITHUB_USER/claude-context" \
    --public \
    --description "Claude Code operational instructions, design system, rules, commands" \
    2>/dev/null || true
  if gh repo view "$GITHUB_USER/claude-context" &>/dev/null; then
    log "Created github.com/$GITHUB_USER/claude-context (public)"
  else
    warn "Could not create $GITHUB_USER/claude-context. Check your token scopes."
    warn "  Local files are still written; create the repo and push by hand."
  fi
fi

cd "$CC_DIR"
git init -q 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$GITHUB_USER/claude-context.git"

cat > "$CC_DIR/.gitignore" << 'GITIGNORE'
.DS_Store
Thumbs.db
.env
.env.*
!.env.example
*.log
GITIGNORE

git add -- .gitignore CLAUDE.md README.md .claude
git diff --cached --quiet || git commit -q -m "init: claude-context from Chewbacca"
git branch -M main
git push -u origin main -q 2>/dev/null || warn "Push failed, you may need to push manually"
log "https://github.com/$GITHUB_USER/claude-context"
fi

# ── iMessage agent ────────────────────────────────────────────────────────────
if should_run repos && [ -n "${USER_NAME:-}" ]; then
# Not bundled. This used to clone calebnewtonusc/imessage-agent, which does not
# exist, so every user who said yes got a warning and nothing else. The pattern
# is documented in second-brain/agents/imessage.md if you want to build one;
# setup.sh will not pretend to install it.
IMSG_DIR=""
SETUP_IMESSAGE=0
fi

# ── Wire ~/.claude/settings.json ─────────────────────────────────────────────
if should_run settings; then
section "Wiring ~/.claude/settings.json"

for existing in "$HOME/.claude/settings.json" "$HOME/.claude/CLAUDE.md" \
  "$HOME/.claude/commands" "$HOME/.claude/rules" "$HOME/.claude/hooks" \
  "$HOME/.claude/agents" "$HOME/.claude/skills" "$HOME/.claude.json"; do
  backup "$existing"
done
if [ "$BACKED_UP" -eq 1 ]; then
  log "Existing config backed up to $BACKUP_DIR"
fi

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude/hooks"

# Hook logic lives in script files, not in escaped one-liners inside JSON. The
# SessionStart command used to be a single string with seven levels of
# backslash escaping: it worked, and nobody could read or safely change it.
cp "$SCRIPT_DIR/.claude/hooks/"*.sh "$HOME/.claude/hooks/" 2>/dev/null || true
chmod +x "$HOME/.claude/hooks/"*.sh 2>/dev/null || true
log "Hooks installed to ~/.claude/hooks/"

# Symlink, never copy.
#
# On 2026-09-07 the installed `people` was a stale COPY of the repo's, three days
# behind it. `events` and `merge` existed in the repo and not on PATH, so the
# nightly scan was silently dead for three days while every surface reported a
# healthy install: `command -v people` said yes, and it was pointing at the wrong
# file. `cp` here is what produced that, and a `cp` in an installer is a promise
# to reproduce it on the next `chewbacca update`.
#
# A symlink makes the repo the only copy, so pulling the repo IS updating the
# tool. `tests/live/people.sh` asserts the link, so this cannot quietly regress.
# link_tool is defined above, before its first caller in the agents section.

# Both scanners score something with no model in the loop, so a cheap
# deterministic check can run before anything spends tokens. ai-scan reads prose
# for AI-writing tells; skill-scan reads skills for whether they will fire.
_installed_scanners=""
# prose-check is the third scanner and the one that knows Caleb's own list.
# ai-scan and skill-scan score generic AI-writing tells; on 2026-09-16 a draft
# passed both while carrying six kickers, three not-X-but-Y constructions and
# two announced turns, because neither knows what a kicker is. prose-check
# encodes voice.md and the fifteen 180DC corrections. Python, so no node needed.
#
# code-slop is the fourth, and the only one that reads CODE. The other three all
# score a README: vocabulary, structure, and the house list, every one of them
# over prose. Code has its own AI-authorship tells, a comment narrating the line
# below it or a section banner in a 40-line file, and nothing here looked for
# them until 2026-09-16. It pairs with the `deslop` skill, which holds the
# judgement calls.
# demo-shoot is a wrapper, not a scanner, but it installs the same way: a
# small executable in bin/ that needs to reach ~/.local/bin.
for _tool in ai-scan skill-scan prose-check voice-check code-slop demo-shoot craft-gate site-gate ui-proof claude-tab gtme-math gtme-graph gtme-learning gtme-library gtme-signals clay-fixture-check task-graph ux-learning phone-mirror brain-pull-safe brain-rerank mac-db screen-time tab-rescue sim-reap agent-nice; do
  if [ -f "$SCRIPT_DIR/bin/$_tool" ]; then
    link_tool "$_tool"
    _installed_scanners="$_installed_scanners $_tool"
  fi
done
# The crafts this kit has already studied. Seeded so the research happens once
# and every machine inherits it; craft-gate refuses to produce in a craft with
# no notes, so an empty store would block the demo tooling on a fresh install.
if [ -d "$SCRIPT_DIR/library/crafts" ]; then
  mkdir -p "$HOME/.chewbacca/craft"
  cp "$SCRIPT_DIR/library/crafts/"*.md "$HOME/.chewbacca/craft/" 2>/dev/null || true
  log "seeded $(ls "$SCRIPT_DIR/library/crafts" | wc -l | tr -d ' ') craft notes"
fi

# The opener gate reads the word a reply must open with from here. Written
# only when the person's own CLAUDE.md asks for a prayer ending in Amen, so
# prayer-guard.sh stays inert for everyone who did not ask for one.
if grep -qiE "prayer|pray" "$HOME/.claude/CLAUDE.md" 2>/dev/null && grep -q "Amen" "$HOME/.claude/CLAUDE.md" 2>/dev/null; then
  mkdir -p "$HOME/.chewbacca"
  echo "Amen" > "$HOME/.chewbacca/opener-marker"
  log "opener gate on: replies must open with a prayer, as CLAUDE.md asks"
fi

# ux-engine lives in apps/ux-engine, outside this repo's bin/, so its tools
# cannot go through link_tool. Link them from the same path ux-guard.sh reads.
#
# WHY THIS MATTERS AND IS NOT COSMETIC. ux-guard blocks a UI write and then
# tells the agent what to do next: "Derive the constraints first: ux-constrain"
# and "load the behaviour spec: ux-preset form". Neither was on PATH, so the
# remediation was a dead end and the only move left after a refusal was to
# guess again. A gate that refuses without a runnable next step trains people
# to route around it.
UX_ENGINE_DIR="${UX_ENGINE_DIR:-$SCRIPT_DIR/apps/ux-engine}"
if [ -d "$UX_ENGINE_DIR/bin" ]; then
  mkdir -p "$HOME/.local/bin"
  _ux_linked=""
  for _ux in "$UX_ENGINE_DIR/bin/"*; do
    [ -f "$_ux" ] || continue
    ln -sfn "$_ux" "$HOME/.local/bin/$(basename "$_ux")"
    chmod +x "$_ux"
    _ux_linked="$_ux_linked $(basename "$_ux")"
  done
  [ -n "$_ux_linked" ] && log "ux-engine tools linked to ~/.local/bin/:$_ux_linked"
  unset _ux _ux_linked
  ensure_local_bin_on_path
fi

if [ -n "$_installed_scanners" ]; then
  if command -v node &>/dev/null; then
    log "Installed to ~/.local/bin/:$_installed_scanners"
  else
    warn "Installed$_installed_scanners but node is missing, so they will not run until you install node >= 18"
  fi
  ensure_local_bin_on_path
fi
unset _tool _installed_scanners

# brief-audio renders text to a listenable MP3 with Kokoro-82M, locally. It is
# deliberately not in the scanner loop above: those need node, this needs python
# and ffmpeg, and warning about the wrong missing dependency sends people to fix
# something unrelated. It builds its own venv at ~/.chewbacca/audio-venv on first
# run, so nothing heavy is installed here.
if [ -f "$SCRIPT_DIR/bin/brief-audio" ]; then
  link_tool brief-audio
  log "brief-audio installed to ~/.local/bin/"
  ensure_local_bin_on_path
fi

# scrape reads one public page as Markdown through Scrapling, headless. Like
# brief-audio it builds its own venv on first run, so nothing is installed here.
if [ -f "$SCRIPT_DIR/bin/scrape" ]; then
  link_tool scrape
  log "scrape installed to ~/.local/bin/"
  ensure_local_bin_on_path
fi

# reddit reads posts and comments from Reddit's public feeds. Stdlib only.
if [ -f "$SCRIPT_DIR/bin/reddit" ]; then
  link_tool reddit
  log "reddit installed to ~/.local/bin/"
  ensure_local_bin_on_path
fi

# list-audit is pure stdlib python, no venv and no network, so it installs with
# no dependency check at all. list-gate ships with it: audit reads a bought file,
# gate refuses to ship a generated one, and the Stop hook calls the gate by name.
# gtme-dedupe is the exception: it builds a splink venv with uv on first run, like
# scrape, and still runs exact passes on plain python3 when that build fails.
# The names after ig-read are tools a skill or rule tells agents to run by
# bare name; none were linked, so each was "command not found" on a fresh
# install (backlog 26 audit, 2026-10-16). tests/test_doc_commands_linked.py
# fails when a doc names a bin/ tool this file never links.
for _tool in orphan-reap list-audit list-gate gtme-dedupe gtme-reply gtme-rules gtme-dnc gtme-score gtme-lookup kit-debt handoff-check learn durable-check corpus preflight gtme-graph gtme-math discovery case-study llms-txt rfp-extract gtme-library gtme-signals gtme-grade gtme-learning clay-fixture-check review-gate task-graph graph-fuse work-ledger ux-learning jev decision-lab ux-decision ux-policy clay-review clay-build fanout site-fast untrusted-screen api-grow model-route intro list-sift ux-do decisions web-record bb brand-grab oss-apps team peel ig-read call-listen chewbacca-permissions clay-go decision-inbox gtm gtme gtme-interview gtme-investors kyber-surfaces qr railway-domain railway-attach logo-fetch texts-photos recur reel-assemble reel-check tabs contacts-bulk; do
  if [ -f "$SCRIPT_DIR/bin/$_tool" ]; then
    link_tool "$_tool"
    log "$_tool installed to ~/.local/bin/"
  fi
done
# The Clay front door behind `chewbacca clay`, on PATH under its own name so
# `readlink ~/.local/bin/chewbacca-clay` shows which kit a write runs from.
# On 2026-10-10 the copy that ran was the dirty shared checkout's, hours behind.
link_tool chewbacca-clay && log "chewbacca-clay installed to ~/.local/bin/"
ensure_local_bin_on_path
unset _tool

# The display: hud draws interfaces on top of everything on screen, hud-listen
# turns what is said to it into an answer, hud-context reports what is in front
# of the person, hud-speak reads the answer aloud. They go in together because
# hud calls the others by path, so installing one alone gives a command that
# fails halfway. Kyber.app itself runs hud-listen, kyber-sessions and
# text-command from ~/.local/bin; text-command was missing from this list until
# 2026-10-05, so a text to yourself woke Kyber and ran a path that did not exist.
# meeting-autopilot is the same: Kyber keeps it running so a meeting records
# under Kyber's own Microphone and Screen Recording grants, and it drives
# room-capture; granola-import brings Granola's past meetings across once.
_installed_hud=""
for _tool in hud hud-listen hud-runtime hud-codex hud-gemini hud-ollama hud-accounts hud-context hud-watch hud-verse hud-speak hud-guide hud-music kyber-sessions text-command superassistant chewbacca-mcp portal hud-autostart meeting-autopilot room-capture granola-import realm-engine realm-ui; do
  if [ -f "$SCRIPT_DIR/bin/$_tool" ]; then
    link_tool "$_tool"
    _installed_hud="$_installed_hud $_tool"
  fi
done

# Register the MCP server with every client already on this machine, so the
# person never sees a port or pastes a URL. Caleb's reaction to the localhost
# transport was "that means someone would have to open a browser, that's
# terrible UX", and he was right: once is still once too many. Idempotent, and
# it backs up each config before touching it.
if [ -x "$HOME/.local/bin/chewbacca-mcp" ]; then
  "$HOME/.local/bin/chewbacca-mcp" --register 2>/dev/null | sed 's/^/    /'
fi
if [ -n "$_installed_hud" ]; then
  log "Installed to ~/.local/bin/:$_installed_hud"
  # The commands are useless without the app that draws. Say so once, here,
  # rather than letting the first `hud draw` fail with a socket error.
  # On 2026-09-21 Caleb had merged the presence field and could not see it.
  # His Mac had the `hud` commands on it and no app for them to draw on,
  # because this section linked the commands and then warned about the app in
  # two lines, in the middle of a setup that prints hundreds, and nothing he
  # could run afterwards would have told him. An install that ends in an
  # instruction has not installed anything.
  if [ ! -d "/Applications/Kyber.app" ] && [ ! -d "$HOME/Applications/Kyber.app" ]; then
    if command -v swift >/dev/null 2>&1 && [ -x "$SCRIPT_DIR/hud/scripts/bundle.sh" ]; then
      log "Building the display. About a minute, once."
      if (cd "$SCRIPT_DIR/hud" && ./scripts/bundle.sh release >/dev/null 2>&1); then
        _dest="/Applications"
        [ -w "$_dest" ] || { _dest="$HOME/Applications"; mkdir -p "$_dest"; }
        if cp -r "$SCRIPT_DIR/hud/build/Kyber.app" "$_dest/" 2>/dev/null; then
          log "Installed Kyber.app to $_dest/. Open it, or run: hud open"
        else
          warn "built the display but could not copy it into $_dest"
        fi
        unset _dest
      else
        warn "the display did not build. Run it by hand to see why:"
        warn "  cd $SCRIPT_DIR/hud && ./scripts/bundle.sh"
      fi
    else
      warn "no Swift toolchain here, so the display cannot be built."
      warn "  xcode-select --install, then: cd $SCRIPT_DIR/hud && ./scripts/bundle.sh"
    fi
  fi
  # The voice with nothing to install: hud-speak needs uv and espeak-ng,
  # hud-voice is one Swift binary. Built rather than shipped, like the app.
  if [ ! -x "$HOME/.local/bin/hud-voice" ]; then
    warn "hud-voice is not built; replies are read by hud-speak, which needs uv and espeak-ng."
    warn "Build it: $(dirname "$0")/voice/build.sh, then HUD_SPEAKER=hud-voice for hud-listen."
  fi
  # Wake mode asks Smart Turn whether a pause means finished, and ends the
  # turn there instead of waiting out its 1.1s silence timer. About 17 MB,
  # pinned and hash-checked; without it wake mode keeps the timer.
  if [ -x "$SCRIPT_DIR/hud/scripts/fetch-smart-turn.sh" ]; then
    if "$SCRIPT_DIR/hud/scripts/fetch-smart-turn.sh" >/dev/null 2>&1; then
      log "Smart Turn end-of-turn model in ~/.bob/smart-turn"
    else
      warn "could not fetch Smart Turn; wake mode keeps its silence timer ($SCRIPT_DIR/hud/scripts/fetch-smart-turn.sh)"
    fi
  fi
  ensure_local_bin_on_path
  ensure_terminal_shell_guard
fi
unset _tool _installed_hud

# coursework reads a semester ledger built from your syllabi: what is due, what
# an absence costs, what each course allows you to use AI for. Deterministic, so
# Claude spends its tokens on judgment instead of re-reading a PDF.
# kits finds every kit on this machine by its .kit marker, so a session knows
# what has already been built instead of rebuilding it or answering turn by turn.
if [ -f "$SCRIPT_DIR/bin/kits" ]; then
  link_tool kits
  log "kits installed to ~/.local/bin/"
fi

# The real `chewbacca` CLI. start.sh writes a six-verb stub (update, doctor,
# setup, uninstall, where, version) so a half-finished install still has a way
# back, and nothing ever replaced it: on every fresh install `chewbacca usc`,
# `chewbacca api` and the `chewbacca welcome questions` start.sh hands the
# agent printed the stub's help instead (found 2026-10-10 walking the USC
# student path from a scratch HOME). ln -sfn replaces the stub file.
link_tool chewbacca
# Hooks and skills name these by bare command (lesson-guard says run
# `closeout --fast`, method-guard says `method debug`), but none were in a link
# list, so tests/test_doc_commands_linked.py now reads hooks too. On 2026-10-29
# the night wrap-up tab got "command not found: closeout".
for _tool in closeout backlog method evolve clay-inbox app-revive chewbacca-daemon gtme-portfolio text-blast; do
  [ -f "$SCRIPT_DIR/bin/$_tool" ] && link_tool "$_tool"
done
if [ -f "$SCRIPT_DIR/bin/coursework" ]; then
  link_tool coursework
  COURSEWORK_HOME="${COURSEWORK_DIR:-$HOME/coursework}"
  mkdir -p "$COURSEWORK_HOME/courses" "$COURSEWORK_HOME/syllabi" "$COURSEWORK_HOME/templates"
  cp "$SCRIPT_DIR/library/templates/coursework/"*.yml "$COURSEWORK_HOME/templates/" 2>/dev/null || true
  mkdir -p "$COURSEWORK_HOME/texts"
  # A course textbook is half a million words, so it is ingested once into
  # $COURSEWORK_HOME/texts and searched from there. See apps/texts/README.md.
  [ -f "$SCRIPT_DIR/bin/textbook" ] && link_tool textbook
  # Slides, files and transcripts come straight off Brightspace. Neither tool
  # was ever linked here, so on 2026-10-10 "pull my lecture slides" turned into
  # a find across ~ while brightspace-sync sat in bin/ as command-not-found.
  for _tool in brightspace brightspace-sync; do
    [ -f "$SCRIPT_DIR/bin/$_tool" ] && link_tool "$_tool"
  done
  log "coursework installed to ~/.local/bin/, ledger at $COURSEWORK_HOME"
  echo "    Next: run /syllabus on a syllabus PDF to fill the ledger."
fi

# people keeps what you know about the people in your life: notes, circles, and
# who you are drifting out of touch with. One SQLite file on this machine, no
# account and no network. Needs node 22.5+ for the built-in sqlite module.
if [ -f "$SCRIPT_DIR/bin/people" ]; then
  link_tool people
  PEOPLE_HOME="${PEOPLE_DIR:-$HOME/.chewbacca/people}"
  mkdir -p "$PEOPLE_HOME"
  if node -e "require('node:sqlite')" >/dev/null 2>&1; then
    log "people installed to ~/.local/bin/, data at $PEOPLE_HOME"
    echo "    Next: people import --mac to pull in your contacts."
  else
    warn "people installed, but this node has no node:sqlite (needs 22.5+)."
    echo "    Fix with: brew upgrade node"
  fi
fi

# guide builds interactive study guides that remember what was missed, so the
# next session opens on the three questions they got wrong instead of the top.
if link_tool guide; then
  log "guide installed to ~/.local/bin/"
fi

# Hooks read their paths from here instead of having them baked in by string
# substitution. Edit this file to move your context repos later.
cat > "$HOME/.claude/d1-config.sh" << D1CONFIG
# Written by Chewbacca setup.sh. Safe to edit by hand.
PERSONAL_CONTEXT_DIR="$PC_DIR"
PUBLIC_CONTEXT_DIR="$CC_DIR"
CONTEXT_OWNER="$USER_NAME"

# Where this kit's own checkout lives, so kit-autopush.sh can push fixes to it
# without anybody remembering to. It falls back to the repo path in
# ~/.chewbacca/install-manifest.json, so moving the checkout and re-running
# setup is enough; this line is the override for a second checkout.
CHEWBACCA_REPO_DIR="$SCRIPT_DIR"
D1CONFIG
log "Hook config written to ~/.claude/d1-config.sh"

# write-log runs `git status` on the context repo before and after every tool
# call. On 2026-10-11 that cost 0.85 s CPU per status on a 61,752-file brain;
# with git's builtin fsmonitor daemon kept current by the repo's own config,
# 0.17 s. The daemon only keeps that speed if every git command there (brain
# sync included) carries the setting, so it lives in the repo's config.
# macOS only: the builtin daemon does not exist on Linux.
if [ "$(uname)" = "Darwin" ] && [ -z "${CHEWBACCA_SUITE:-}" ] && [ -n "$PC_DIR" ] && [ -e "$PC_DIR/.git" ]; then
  git -C "$PC_DIR" config core.fsmonitor true
  git -C "$PC_DIR" config core.untrackedCache true
fi

# hookd decides in under a millisecond whether a gated guard needs to run at
# all (crates/hookd). It has no dependencies, so it builds offline in ~10 s
# (2026-10-11, M-series, release). No cargo means no hookd, and every guard
# then runs directly, exactly as before.
if [ -z "${CHEWBACCA_SUITE:-}" ] && command -v cargo >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/crates/hookd/Cargo.toml" ]; then
  if CARGO_TARGET_DIR="$HOME/.chewbacca/build/hookd" cargo build --quiet --release \
       --manifest-path "$SCRIPT_DIR/crates/hookd/Cargo.toml" 2>/dev/null; then
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$HOME/.chewbacca/build/hookd/release/hookd" "$HOME/.local/bin/hookd.new" &&
      mv -f "$HOME/.local/bin/hookd.new" "$HOME/.local/bin/hookd"
    log "hookd built to ~/.local/bin/hookd"
  else
    warn "hookd did not build; guards run directly, as before."
  fi
fi
# terminal-loop.sh hands its Pre/Post rows to hookd only behind this marker,
# written only for a binary that answers the probe (an older hookd answers an
# unknown verb with exit 0, and the agent board would get no rows).
if [ "$("$HOME/.local/bin/hookd" terminal-event --probe 2>/dev/null)" = "hookd terminal-event 1" ]; then
  mkdir -p "$HOME/.chewbacca" && : > "$HOME/.chewbacca/hookd-terminal-event"
else
  rm -f "$HOME/.chewbacca/hookd-terminal-event"
fi

# chewbacca-writelog (crates/writelog) answers write-log in Rust and reads the
# brain from an FSEvents journal instead of running git status before and
# after every call: 0.61 s of CPU per Bash call (Pre plus Post) became
# 0.018 s, and 415 ms of wall per event 28 ms, on a 6,000 dirty-file test
# brain (2026-10-11, load 6, tests/test_writelog_rust.py). The watcher
# runs as one daemon service. Who writes the real log is the one-word file
# ~/.chewbacca/writelog.mode (python, shadow or rust), which setup never
# changes. No cargo, no binary: write_log.py runs, exactly as before.
if [ -z "${CHEWBACCA_SUITE:-}" ] && command -v cargo >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/crates/writelog/Cargo.toml" ]; then
  if CARGO_TARGET_DIR="$HOME/.chewbacca/build/writelog" cargo build --quiet --release \
       --manifest-path "$SCRIPT_DIR/crates/writelog/Cargo.toml" 2>/dev/null; then
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$HOME/.chewbacca/build/writelog/release/chewbacca-writelog" "$HOME/.local/bin/chewbacca-writelog.new" &&
      mv -f "$HOME/.local/bin/chewbacca-writelog.new" "$HOME/.local/bin/chewbacca-writelog"
    # The kit's own main checkout (not a runtime snapshot, which is a
    # worktree) is the other repo most calls run in, so it is watched too.
    WL_COMMON="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    WL_KIT="${WL_COMMON%/.git}"
    if [ -n "$WL_COMMON" ] && [ "$WL_KIT" != "$WL_COMMON" ] && [ -d "$WL_KIT/.git" ]; then
      mkdir -p "$HOME/.chewbacca/watch" && chmod 700 "$HOME/.chewbacca/watch"
      grep -qxF "$WL_KIT" "$HOME/.chewbacca/watch/roots" 2>/dev/null || printf '%s\n' "$WL_KIT" >> "$HOME/.chewbacca/watch/roots"
    fi
    # A running watcher keeps the old binary and roots; the daemon starts
    # the new one within its 10 s keepalive backoff.
    pkill -f "^$HOME/.local/bin/chewbacca-writelog serve" 2>/dev/null || true
    if [ "$(uname)" = "Darwin" ]; then
      python3 - "$SCRIPT_DIR" "$HOME/.local/bin/chewbacca-writelog" <<'PY' || warn "writelog watcher not registered; write-log keeps using git status."
import sys
sys.path.insert(0, sys.argv[1] + "/bin/lib")
import daemon_register
print(daemon_register.register("writelog-watch", [sys.argv[2], "serve"], keepalive=True))
PY
    fi
    log "chewbacca-writelog built to ~/.local/bin/chewbacca-writelog"
  else
    warn "chewbacca-writelog did not build; write-log runs in Python, as before."
  fi
fi

# chewbacca-bashparse (crates/bashparse) reads a shell command with
# tree-sitter-bash so destructive-guard, load-guard and zsh-guard can tell a
# command from a word inside data. Unlike hookd it has two pinned crates, so
# the first build needs the network (12 s wall, 30 s CPU cold on 2026-10-12,
# M-series, release). No cargo, no network, no binary: those guards read the raw
# command, exactly as before.
if [ -z "${CHEWBACCA_SUITE:-}" ] && command -v cargo >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/crates/bashparse/Cargo.toml" ]; then
  if CARGO_TARGET_DIR="$HOME/.chewbacca/build/bashparse" cargo build --quiet --release --locked \
       --manifest-path "$SCRIPT_DIR/crates/bashparse/Cargo.toml" 2>/dev/null &&
     [ "$("$HOME/.chewbacca/build/bashparse/release/chewbacca-bashparse" --probe 2>/dev/null)" = "chewbacca-bashparse 1" ]; then
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$HOME/.chewbacca/build/bashparse/release/chewbacca-bashparse" "$HOME/.local/bin/chewbacca-bashparse.new" &&
      mv -f "$HOME/.local/bin/chewbacca-bashparse.new" "$HOME/.local/bin/chewbacca-bashparse"
    log "chewbacca-bashparse built to ~/.local/bin/chewbacca-bashparse"
  else
    warn "chewbacca-bashparse did not build; the shell guards read commands as before."
  fi
fi

# chewbacca-sendpolicy (crates/sendpolicy) reads config/send-policy.cedar, the
# one file of rules about who, when and how much a send may go. Cedar is a
# crate, so the first build needs the network (2 min wall on 2026-10-12,
# M-series, release, at load 26). No cargo, no network, no binary: every sink
# keeps its inline checks exactly as before, and `chewbacca send-policy`
# says it can't answer.
if [ -z "${CHEWBACCA_SUITE:-}" ] && command -v cargo >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/crates/sendpolicy/Cargo.toml" ]; then
  if CARGO_TARGET_DIR="$HOME/.chewbacca/build/sendpolicy" cargo build --quiet --release --locked \
       --manifest-path "$SCRIPT_DIR/crates/sendpolicy/Cargo.toml" 2>/dev/null &&
     [ "$("$HOME/.chewbacca/build/sendpolicy/release/chewbacca-sendpolicy" --probe 2>/dev/null)" = "chewbacca-sendpolicy 1" ]; then
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$HOME/.chewbacca/build/sendpolicy/release/chewbacca-sendpolicy" "$HOME/.local/bin/chewbacca-sendpolicy.new" &&
      mv -f "$HOME/.local/bin/chewbacca-sendpolicy.new" "$HOME/.local/bin/chewbacca-sendpolicy"
    log "chewbacca-sendpolicy built to ~/.local/bin/chewbacca-sendpolicy"
  else
    warn "chewbacca-sendpolicy did not build; each send path keeps its own checks, as before."
  fi
fi

# Merge drivers for SHA256SUMS.txt and the README counts block. On 2026-10-09
# about ten tabs pushed main and nearly every merge stopped on those two
# generated files. .gitattributes names the drivers; git config holds the
# commands, which git never clones, so every checkout registers them here.
# Idempotent; the kit-autopull session hook repeats it for clones that
# predate this line.
# Not under the suite: its sandboxed setup runs must not write this checkout's
# real git config.
if [ -z "${CHEWBACCA_SUITE:-}" ] && [ -e "$SCRIPT_DIR/.git" ] && [ -f "$SCRIPT_DIR/tools/merge_regen.py" ]; then
  python3 "$SCRIPT_DIR/tools/merge_regen.py" install --repo "$SCRIPT_DIR" >/dev/null 2>&1 &&
    log "Git merge drivers registered for SHA256SUMS.txt and README counts"
fi

# ── What this run turns on ────────────────────────────────────────────────────
# Both of these used to be on with no way to say no, announced in a wall of
# text after they had already been written. Each is a flag now, each defaults
# to off, and this prints the state it is actually about to write.
echo ""
echo "  This run will configure:"
if [ "$SESSION_OPENER" = "none" ]; then
  echo "    Session opener     off"
else
  echo "    Session opener     $SESSION_OPENER, on every response"
fi
if [ "$BYPASS_PERMS" = "yes" ]; then
  echo "    Permission prompts OFF. Claude runs shell commands and writes files"
  echo "                       without asking, in every project on this machine."
  echo "                       Undoing it means editing three files."
else
  echo "    Permission prompts on. Claude asks before acting."
fi
CRED_COUNT=0
for v in "$ANTHROPIC_KEY" "$GITHUB_PAT" "$TODOIST_TOKEN"; do
  [ -n "$v" ] && CRED_COUNT=$((CRED_COUNT + 1))
done
if [ "$CRED_COUNT" -gt 0 ]; then
  echo "    Credentials        $CRED_COUNT written to ~/.claude/settings.json in plain text"
else
  echo "    Credentials        none. Nothing is read from your shell or keychain."
fi
echo ""

# Secrets and paths reach python through the environment. Interpolating them
# into python source breaks the moment a token contains a quote or backslash.
# An expired or wrong-scoped PAT written into env breaks gh in every future
# session, and confusingly, because the env var beats the keyring.
if [ -n "${GITHUB_PAT:-}" ] && ! GH_TOKEN="$GITHUB_PAT" gh api user &>/dev/null; then
  warn "That GitHub token failed a live check. Leaving GITHUB_TOKEN unset so it"
  warn "  cannot break gh in every session. Add a working one later if needed."
  GITHUB_PAT=""
fi
export D1_GITHUB_PAT="${GITHUB_PAT:-}"
export D1_ANTHROPIC_KEY="${ANTHROPIC_KEY:-}"
export D1_TODOIST_TOKEN="${TODOIST_TOKEN:-}"
export D1_PC_DIR="${PC_DIR:-}"
export D1_CC_DIR="${CC_DIR:-}"
export D1_IMSG_DIR="${IMSG_DIR:-}"
export D1_HOOKS="$HOME/.claude/hooks"
export D1_SESSION_OPENER="$SESSION_OPENER"
export D1_BYPASS_PERMS="$BYPASS_PERMS"

python3 << 'PYEOF'
import json, os, re, shlex

settings_path = os.path.expanduser("~/.claude/settings.json")
# A settings.json this can't read is never replaced. Break-it, 2026-10-19: a
# file with a BOM, a // comment or a trailing comma failed json.load, became
# {}, and every user key was gone under "Settings written." Those three are
# read through; anything else stops the install with the file untouched.
def _tolerant_json(text):
    text = text.lstrip("\ufeff")
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1]); i += 2; continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True; out.append(c)
        elif text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        else:
            out.append(c)
        i += 1
    cleaned = re.sub(r",(\s*[}\]])", r"\1", "".join(out))
    return json.loads(cleaned)

settings = {}
if os.path.exists(settings_path):
    with open(settings_path, encoding="utf-8", errors="replace") as f:
        _raw = f.read()
    if _raw.strip():
        try:
            settings = json.loads(_raw)
        except ValueError:
            try:
                settings = _tolerant_json(_raw)
                print("Read settings.json past a BOM, comments or trailing commas; it is rewritten as plain JSON.")
            except ValueError as exc:
                raise SystemExit(f"setup: ~/.claude/settings.json isn't valid JSON ({exc}). Nothing was changed; "
                                 f"fix it or move it aside and run setup again.")
    if not isinstance(settings, dict):
        raise SystemExit("setup: ~/.claude/settings.json isn't a JSON object. Nothing was changed.")

env = os.environ.get
hooks_dir = env("D1_HOOKS") or os.path.expanduser("~/.claude/hooks")

# Only what was passed to this run. Nothing is read from the ambient shell,
# the keychain, or `gh auth token`. A value already exported under one of these
# names used to survive an empty prompt and land here as though it were typed.
settings.setdefault("env", {})
for key, var in (("GITHUB_TOKEN", "D1_GITHUB_PAT"),
                 ("ANTHROPIC_API_KEY", "D1_ANTHROPIC_KEY"),
                 ("TODOIST_API_TOKEN", "D1_TODOIST_TOKEN")):
    val = env(var, "").strip()
    if val:
        settings["env"][key] = val
        print(f"Wrote credential to settings.json: env.{key}")

# "permissions": null crashed the install halfway (break-it, 2026-10-19).
if not isinstance(settings.get("permissions"), dict):
    settings["permissions"] = {}
perms = settings["permissions"]
# On unless --ask-permissions was passed (default since 2026-10-16, see the
# BYPASS_PERMS default). The deny list below still blocks what has no undo.
# AskUserQuestion is denied too, so an agent can't stop to pop a question card.
# tools/no_prompts.py --off undoes all of it.
if env("D1_BYPASS_PERMS", "no") == "yes":
    perms["defaultMode"] = "bypassPermissions"
    settings["skipDangerousModePermissionPrompt"] = True
    perms.setdefault("deny", [])
    if "AskUserQuestion" not in perms["deny"]:
        perms["deny"].append("AskUserQuestion")
    print("Permission prompts disabled: Claude will not ask before acting.")
else:
    perms.setdefault("defaultMode", "default")

perms.setdefault("additionalDirectories", [])
for d in (env("D1_PC_DIR", ""), env("D1_CC_DIR", ""), env("D1_IMSG_DIR", "")):
    if d and d not in perms["additionalDirectories"]:
        perms["additionalDirectories"].append(d)

perms.setdefault("allow", [])
# Deliberately NOT granted here: Read(~/Library/Messages/**), Bash(osascript:*),
# and Bash(sqlite3:*). Under bypassPermissions those would let every future
# session read the user's entire message history without ever asking. Add them
# yourself if you build something that needs them.
if "WebSearch" not in perms["allow"]:
    perms["allow"].append("WebSearch")

# Bypass mode alone still prompted for MCP tools. Caleb, 2026-10-04, three
# times in an hour: "Fix vscode, you shouldn't be asking for permission to do
# anything", "you just asked for permission again...", "you keep asking for
# permission when you shouldn't be" (feedback_no_permission_prompts). The fix
# that held was one `mcp__<server>` allow rule per server, written by hand on
# this Mac, so every other install still prompted. Every MCP server configured
# at user scope gets its rule here. `mcp__*` is not a valid rule, so it is one
# per server (feedback_no_permission_prompts, 2026-10-04).
if env("D1_BYPASS_PERMS", "no") == "yes":
    servers = set()
    for cfg in (os.path.expanduser("~/.claude.json"), os.path.expanduser("~/.claude/.mcp.json")):
        try:
            with open(cfg) as f:
                servers.update((json.load(f).get("mcpServers") or {}).keys())
        except Exception:
            pass
    for name in sorted(servers):
        rule = "mcp__" + name
        if name and rule not in perms["allow"]:
            perms["allow"].append(rule)

# Nothing prompts under bypassPermissions, so the deny list is the only brake
# left. It covers operations with no undo, and reads that would pull a secret
# into context where it can be echoed back or logged. deny wins over allow.
perms.setdefault("deny", [])
for rule in [
    "Bash(rm -rf /)", "Bash(rm -rf /*)", "Bash(rm -rf ~)", "Bash(rm -rf ~/*)",
    "Bash(sudo rm:*)",
    "Bash(git push --force*)", "Bash(git push -f*)", "Bash(git reset --hard origin*)",
    "Bash(gh repo delete:*)", "Bash(dropdb:*)",
    "Read(./.env)", "Read(./.env.*)",
    "Read(" + settings_path + ")",
    "Read(" + os.path.expanduser("~") + "/.claude/.credentials.json)",
    "Read(" + os.path.expanduser("~") + "/.ssh/**)",
    "Read(" + os.path.expanduser("~") + "/.aws/**)",
]:
    if rule not in perms["deny"]:
        perms["deny"].append(rule)

settings["enableAllProjectMcpServers"] = True
settings["alwaysThinkingEnabled"] = True

h = settings.setdefault("hooks", {})

# The user's own hooks survive. Several events below are assigned outright
# (h["Stop"] = [...]), so on 2026-10-19 a break-it run from a temp home lost
# the user's SessionStart, PostToolUse, PreToolUse, Stop, Notification and
# UserPromptSubmit hooks and their statusLine. An entry is the kit's when a
# command in it points into the kit's hooks dir, runs hookd, or is the
# session opener; everything else is put back after the kit's are written.
def _is_kit_entry(e):
    for hk in (e.get("hooks") or []) if isinstance(e, dict) else []:
        c = str(hk.get("command", ""))
        if hooks_dir in c or "/.claude/hooks/" in c or "hookd" in c or "MANDATORY FIRST ACTION" in c:
            return True
    return False
_user_hooks = {ev: [e for e in entries if isinstance(e, dict) and not _is_kit_entry(e)]
               for ev, entries in list(h.items()) if isinstance(entries, list)}
_user_status = settings.get("statusLine")


def gated(command):
    """Route a guard that declares `# gate:` words through hookd.

    On 2026-10-11 twenty guards ran before every Bash call at ~70 ms of CPU
    each, most exiting 0 because the command had nothing to do with them.
    hookd decides that in under a millisecond (crates/hookd). Without the
    binary the shell runs the guard directly, so a guard never stops guarding
    because hookd is missing. The command still ends in the script path, so
    _register's basename dedupe and D1_SKIP_HOOKS keep matching it."""
    try:
        with open(command, errors="replace") as f:
            head = f.read(8192)
    except OSError:
        return command
    if "\n# gate:" not in head and "\n# gate-file:" not in head:
        return command
    script = shlex.quote(command)
    return ('H="$HOME/.local/bin/hookd"; [ -x "$H" ] && exec "$H" gate ' + script
            + '; exec ' + script)


def _register(event, command, timeout=None, matcher=None, status=None):
    """Register one hook for `event`, replacing any earlier copy of it.

    `matcher` limits a PreToolUse/PostToolUse hook to the tools it has an
    opinion about. Without it a gate runs on every tool call in the session and
    pays a process spawn each time to exit 0.

    The events this file assigns outright (`h[event] = [...]`) reset their
    list every run. The ones it adds to did not: `setdefault(...).append(...)`
    appended another copy on every re-run, and `chewbacca update` re-runs
    setup by design. Two PermissionRequest hooks then fire for one prompt,
    the one that loses the ask-file race records the prompt as not held, and
    a voice "yes" presses Return in a tab that is showing no dialog.

    Matched on the command's basename, so moving the hooks directory still
    replaces rather than duplicates.
    """
    name = os.path.basename(command)
    entries = h.setdefault(event, [])
    entries[:] = [
        e for e in entries
        if not any(os.path.basename(str(hook.get("command", ""))) == name
                   for hook in e.get("hooks", []))
    ]
    hook = {"type": "command", "command": gated(command)}
    if timeout is not None:
        hook["timeout"] = timeout
    if status is not None:
        hook["statusMessage"] = status
    entry = {"hooks": [hook]}
    if matcher is not None:
        entry["matcher"] = matcher
    entries.append(entry)

# Session opener: off unless --session-opener names one. This used to be wired
# unconditionally, so a stranger running the installer got every reply opening
# with a prayer and found out from two lines in a wall of setup output. That is
# the author's own practice, not a default anyone else agreed to.
# A vague instruction here produces a vague line every time. "Begin with a
# prayer" gets you the same sentence forever; naming what makes it real is
# what makes the model write a different one each turn.
OPENERS = {
    "prayer": (
        "MANDATORY FIRST ACTION: The very first text you write in this "
        "response must be a prayer to Jesus Christ. Not after a preamble, not "
        "after a tool call. The prayer IS the first sentence. Make it specific "
        "to what is actually being worked on right now, speak warmly and "
        "directly rather than in formal religious register, vary the phrasing "
        "every time, and end with Amen. Then answer."
    ),
    "gratitude": (
        "MANDATORY FIRST ACTION: Open every response with one sentence naming "
        "something specific to be grateful for in what is being worked on "
        "right now. Concrete, never generic, never the same twice. Then answer."
    ),
}
opener = env("D1_SESSION_OPENER", "none").strip().lower()
if opener in ("", "none", "no", "off"):
    h.pop("UserPromptSubmit", None)
elif opener in OPENERS:
    opener_payload = json.dumps({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": OPENERS[opener],
    }})
    h["UserPromptSubmit"] = [{"hooks": [{
        "type": "command",
        "command": "printf '%s' " + shlex.quote(opener_payload),
        "statusMessage": "Session opener",
    }]}]
    print(f"Session opener enabled: {opener}")
else:
    print(f"Unknown session opener {opener!r}, leaving it off. "
          f"Known: {', '.join(sorted(OPENERS))}")

h["PostToolUse"] = [
    {"matcher": "Write|Edit", "hooks": [{
        "type": "command",
        "command": hooks_dir + "/format-and-sync.sh",
        "statusMessage": "Formatting and syncing...",
        "async": True,
    }]},
    # write-log records which session wrote which path. Both authorship
    # guards read ~/.chewbacca/write-log.tsv: .githooks/pre-commit refuses an
    # index holding two authors, and stop-check attributes dirty files.
    #
    # THIS WAS MISSING UNTIL 2026-09-21 AND BOTH GUARDS WERE INERT EVERYWHERE.
    # The kit's settings/settings.json registered it; this installer never did,
    # so ~/.chewbacca/write-log.tsv did not exist on the author's own machine
    # and pre-commit silently allowed every commit. Its own test covers that
    # state as "no write log: stays silent", so nothing failed and nothing said
    # anything. Three commits swallowed another session's work while the guard
    # meant to stop it had never run once.
    #
    # Matcher includes Bash and NotebookEdit because this kit tells agents to
    # edit through Bash heredocs and sed, so Write|Edit alone misses the
    # dominant write path. That was the first version's bug: it logged nothing.
    #
    # $HOME, not $CLAUDE_PROJECT_DIR. Two sessions can collide in any repo, not
    # only one that happens to ship this hook, and the other three hooks here
    # are already installed to $HOME.
    {"matcher": "Write|Edit|Bash|NotebookEdit", "hooks": [{
        "type": "command",
        "command": hooks_dir + "/write-log.sh",
    }]},
]

h["SessionStart"] = [{"hooks": [{
    "type": "command",
    "command": hooks_dir + "/session-context.sh",
    "statusMessage": "Loading your context...",
}, {
    # Open todos for this workspace plus the person's own (scope ~). Separate
    # from session-context.sh because that output is cached across workspaces.
    "type": "command",
    "command": hooks_dir + "/work-ledger-context.sh",
}]}]

h["Stop"] = [{"hooks": [{
    # Finished work sitting on the machine because nobody asked the right
    # question. This pushes commits to the user's OWN origin only, never to an
    # upstream fork, never auto-committing, and only from directories listed in
    # AUTOPUSH_DIRS. Off by default: the variable is empty until someone sets it.
    "type": "command",
    "command": hooks_dir + "/auto-push.sh",
    "timeout": 30,
    "statusMessage": "Pushing finished work...",
}]}, {"hooks": [{
    "type": "command",
    "command": hooks_dir + "/stop-check.sh",
    "statusMessage": "Checking for unpushed work...",
}]}, {"hooks": [{
    # The writing rules live in CLAUDE.md, which is a user message competing
    # with everything else in a long session. By hour three the drama beats
    # come back. This reads what Claude actually wrote and refuses the turn,
    # deterministically and with no model call, so the rule cannot decay.
    "type": "command",
    "command": hooks_dir + "/slop-guard.sh",
    "timeout": 15,
    "statusMessage": "Checking the reply against the writing rules...",
}]}, {"hooks": [{
    # The session opener in CLAUDE.md decayed across one long session on
    # 2026-09-27: replies went out without the prayer and Caleb had to say
    # "UR NOT PRAYIN" twice. Same lesson as slop-guard: read the reply, do not
    # trust the rule to be remembered. Inert unless ~/.chewbacca/opener-marker
    # exists, which is written below only when CLAUDE.md asks for a prayer.
    "type": "command",
    "command": hooks_dir + "/prayer-guard.sh",
    "timeout": 5,
    "statusMessage": "Checking the reply opens the way you asked...",
}]}, {"hooks": [{
    # 2026-10-09: texts drafted for Jonah and Ryan went into chat reading
    # nothing like him, and he said "i should never send a text that doesn't
    # sound like me". Quoted drafts in a reply go through bin/voice-check,
    # measured against his own sent texts.
    "type": "command",
    "command": hooks_dir + "/voice-guard.sh",
    "timeout": 30,
    "statusMessage": "Checking drafted texts sound like you...",
}]}, {"hooks": [{
    # 39 hooks were registered on 2026-09-27 and not one of them looked at a
    # rendered image. slop-guard blocked a reply that night over a single em
    # dash while a page shipped across four commits with a collapsed figure,
    # six over-dense plates and no scroll motion at all. The kit could
    # describe a good page in four documents and could not see one.
    #
    # design-gate was written in ux-engine on 2026-09-23 to close exactly this
    # hole. It exits 2 and it was registered nowhere, so it had never fired.
    # Per feedback_built_but_never_fires: the bug is wiring, not capability.
    #
    # It renders only when the turn edited a rendered file AND a URL for that
    # project is available, so a shell session pays nothing. When it cannot
    # see, it reports blind rather than green.
    "type": "command",
    "command": hooks_dir + "/design-gate.sh",
    "timeout": 120,
    "statusMessage": "Looking at the page that was just edited...",
}]}, {"hooks": [{
    # SendMessage returning success means a message was accepted, not that an
    # agent is alive. On 2026-09-23 a resume of a subagent from a dead session
    # returned {"success": true}, nothing started, and the reply went out
    # saying it was running. Caleb caught it; ListAgents then showed zero
    # subagents. This refuses a reply claiming background work is in flight
    # unless something in the turn actually launched or a listing shows it.
    "type": "command",
    "command": hooks_dir + "/agent-claim-guard.sh",
    "timeout": 15,
    "statusMessage": "Checking claims about running agents...",
}]}, {"hooks": [{
    # A claim of a verified state needs evidence in the session, not
    # confidence. On 2026-09-21 a fix was reported as done three times and the
    # next screenshot showed the same bug, and several more "fixed" claims were
    # made while the code path being described was not executing at all. This
    # refuses a reply saying something is fixed, verified or passing unless a
    # command RAN after the last file was written, and refuses "safe to close"
    # without a passing closeout receipt for the current commits.
    "type": "command",
    "command": hooks_dir + "/vibe-guard.sh",
    "timeout": 15,
    "statusMessage": "Checking claims of doneness against evidence...",
}]}, {"hooks": [{
    # Caleb, 2026-10-16: "When they build something and say it's done, chewbs
    # should attack it from every angle trying to break it before it concludes
    # anything". A done claim over a change in a repo is attacked on the spot
    # (garbage input to the touched commands, uncommitted files, the copy that
    # runs, unbacked claims) unless a full break-it receipt for this exact tree
    # names every open break. Replay numbers: tests/fixtures/break_it/REPLAY.md.
    "type": "command",
    "command": hooks_dir + "/break-it-guard.sh",
    "timeout": 30,
    "statusMessage": "Attacking the change before it is called done...",
}]}, {"hooks": [{
    # A closing message that hands over a command is a confession of stopping
    # early. The shell was right there.
    "type": "command",
    "command": hooks_dir + "/handoff-guard.sh",
    "timeout": 15,
    "statusMessage": "Checking the reply does not hand you a command...",
}]}, {"hooks": [{
    # A correction that changes only the reply changes nothing. This checks
    # that being corrected actually moved something in the kit.
    "type": "command",
    "command": hooks_dir + "/durable-guard.sh",
    "timeout": 15,
    "statusMessage": "Checking a correction actually changed the kit...",
}]}, {"hooks": [{
    # An outbound list reported as finished, unread. On 2026-09-20 five
    # investor lists were called done four times running, and reading the
    # OUTPUT each time found what the code review had missed: 2,121 people on
    # more than one list, eleven partners at one fund, info@ mailboxes, and 843
    # rows whose company name was the literal string "Company". It was written
    # up as guidance in a skill and then never fired, which is the failure it
    # exists to prevent, and it was registered nowhere at all until now.
    "type": "command",
    "command": hooks_dir + "/list-guard.sh",
    "timeout": 20,
    "statusMessage": "Checking an outbound list was actually read...",
}]}]

# Coursework context loads when a prompt mentions a class, so the ledger is in
# context before Claude answers rather than after it guesses.
# prayer-guard.sh catches a missing opener, but it is a Stop hook, so the only
# thing it can do is refuse the turn, and refusing re-sends the whole reply.
# Caleb then sees both copies back to back. Measured over 785 assistant
# messages in one session: four duplicate pairs, every one a guard refusal,
# two of them this one. So the guard both works and produces the duplicate,
# and catching it later cannot be the fix.
#
# prayer-guard's own comment names the cause: the rule decays across a long
# session, because CLAUDE.md is read once at the start and eight hundred
# messages later it is the furthest thing in the window. A UserPromptSubmit
# hook runs immediately before every reply is composed, so the opener is never
# more than one message away however long the session runs.
#
# Inert without ~/.chewbacca/opener-marker, same as prayer-guard.
_register("UserPromptSubmit", hooks_dir + "/prayer-remind.sh", timeout=5)
# A compaction resumes the turn with no prompt, so neither reminder above runs
# and the next replies forget both. On 2026-10-11 ten blocks went out unprayed
# right after a compaction and the guard's refusal showed Caleb the answer
# twice. SessionStart with the "compact" matcher fires right then.
_register("SessionStart", hooks_dir + "/prayer-remind.sh", timeout=5, matcher="compact")
_register("SessionStart", hooks_dir + "/voice-remind.sh", timeout=5, matcher="compact")
# The current time on every prompt; the harness only states the date once.
_register("UserPromptSubmit", hooks_dir + "/time-context.sh", timeout=5)
# The disk filled three times on 2026-10-09 and the third time Bash could not
# start at all. Prunes regenerable caches in the background below 20 GB free.
_register("UserPromptSubmit", hooks_dir + "/disk-guard.sh", timeout=5)
# Two Desktop tabs died on another account's weekly limit on 2026-10-10 and
# nothing said so for an hour. Tells the next tab, with resume prompts, and
# shuts down simulators booted with nothing using them.
_register("UserPromptSubmit", hooks_dir + "/tab-rescue.sh", timeout=5)
# Nine tabs, their subagents and a forgotten simulator took the Mac to load 37
# with 15% memory free on 2026-10-10 ("My slow af rn"). When the Mac is warm it
# refuses workflows, when hot subagents too, with limits that are a share of
# the Mac (bin/lib/machine_profile.py). bin/agent-nice (run by tab-rescue.sh)
# keeps agents at nice 10 so the person's apps win the CPU. Its PreToolUse
# half is registered below the PreToolUse reset, which wiped it until 10/13.
_register("UserPromptSubmit", hooks_dir + "/machine-budget.sh", timeout=5)
# A pasted call transcript gets the whole pasted-call method: the method as
# context at prompt time, and a refused Stop if the turn skipped the skill,
# the texts, the ledger or the brain. Roy call, 2026-10-29: "READ EVERY WORD
# BRUH DONT SKIM", the third skim in five days with the skill sitting unread.
_register("UserPromptSubmit", hooks_dir + "/pasted-call-gate.sh", timeout=5)
_register("Stop", hooks_dir + "/pasted-call-gate.sh", timeout=5)
# Archive or close asks get the learn-first closeout (2026-10-29, "I should never have to say this again").
_register("UserPromptSubmit", hooks_dir + "/archive-learn.sh", timeout=5)
_register("UserPromptSubmit", hooks_dir + "/client-rulings.sh", timeout=5)
# Caleb's "do it yourself" in chat approves Clay writes for 12 hours, in place
# of typing at a terminal agent shells don't have (2026-10-10).
_register("UserPromptSubmit", hooks_dir + "/chat-approval.sh", timeout=5)

# coursework-context.sh is not registered for Claude Code. It emits a
# SessionStart payload, and on UserPromptSubmit Claude Code dropped it on every
# prompt: a process start and a ledger read per prompt for nothing.
# session-context.sh already puts the same deadlines in at session start. The
# Codex adapter still calls it (tools/codex_hooks.py), which reads the text
# whatever the event name says.

# A kit already built is worth nothing if the next session answers the question
# in a chat window instead. This matches the prompt against every kit's
# use-when line and says nothing at all unless there is a real match.
_register("UserPromptSubmit", hooks_dir + "/kit-route.sh", timeout=10)

h["PreToolUse"] = [{"matcher": "Write", "hooks": [{
    "type": "command",
    "command": hooks_dir + "/env-guard.sh",
    "statusMessage": "Checking file safety...",
}]}]

# Every _register("PreToolUse", ...) goes below the reset above, or the reset
# throws it away (tests/hooks_registered.sh refuses one that doesn't).
_register("PreToolUse", hooks_dir + "/machine-budget.sh", timeout=5,
          matcher="Agent|Task|Workflow",
          status="Checking the Mac has room...")
# A GTM subagent brief names the engine (gtme, Togari, Jev) or is refused with
# the block to paste. The 10/29 Medrano enrichment went out as "web search is
# fine" and Caleb: "I SHOULD NEVER HAVE TO SAY THIS ... IT SHOULD BE BUILT IN".
_register("PreToolUse", hooks_dir + "/dough-brief-gate.sh", timeout=5,
          matcher="Agent|Task|Workflow")

# Layer 6. A browser hands you an addressable model of its own contents, and
# reading it as an image throws that away. On 2026-09-21 a form the user had
# open in Chrome got filled by screenshots and pixel clicks, one field per round
# trip, while `chewie web` sat unused: the routing table named no command for a
# browser, so the agent fell back to the layer that had one. The table was fixed
# the same day, which is exactly why this exists as well. Any use of the bridge
# clears the gate for the session, and `visual:` in the command declares real
# canvas work and goes through.
_register("PreToolUse", hooks_dir + "/browser-ux-guard.sh", timeout=10,
          matcher="Bash|mcp__peekaboo__.*",
          status="Checking this browser work is not being done through pixels...")

# An agent's `open` stole Caleb's screen at 1:38am on 2026-10-11 ("waking up
# the entire city with a flashbang tab"), a day after the background rule was
# written as prose. Refuses a foreground open or a browser activate.
_register("PreToolUse", hooks_dir + "/focus-guard.sh", timeout=10,
          matcher="Bash",
          status="Checking nothing jumps to the front of the screen...")

# A `repeat with p in people` reading six fields per card ran 5+ minutes on
# 2026-10-21; the bulk read took 3.7 s. Refuses per-item Apple Event loops
# over a whole collection and names the bulk form and contacts-bulk.
_register("PreToolUse", hooks_dir + "/bulk-loop-guard.sh", timeout=10,
          matcher="Bash",
          status="Checking this script reads in bulk, not one item at a time...")

# "Downloading font Nanum Brush Script" popped over Caleb's work at 7:11pm on
# 2026-10-11 ("permission should never be asked to download things"). Refuses
# code that names a macOS font that is downloadable but not installed.
_register("PreToolUse", hooks_dir + "/font-guard.sh", timeout=10,
          matcher="Write|Edit|MultiEdit|Bash",
          status="Checking no font download pops up...")

# Stage 8 of graph-engineering, knowledge fusion, which the skill calls the #1
# cause of useless graphs and which this machine kept skipping. On 2026-09-21 a
# session wrote a paying client's name into the notes off a FIRST NAME match
# and got the wrong person. Refuses a write that introduces "First Last" where
# that first name is already on the roster under a different surname.
_register("PreToolUse", hooks_dir + "/fusion-guard.sh", timeout=15,
          matcher="Write|Edit|MultiEdit",
          status="Checking a name against the roster...")

# The generated look is an empty deny list, so this refuses a UI write that
# carries it. It blocks ONLY on findings that cite a standard this kit did not
# write (WCAG, W3C, MDN), because a build-breaking gate made of house opinion
# is roughly 3.4x over the false-positive rate where tools get switched off;
# everything else prints and lets the write through.
#
# It was copied to ~/.claude/hooks by the block above and never registered
# here, so it only ever fired on the one machine where it had been added to
# settings.json by hand. That is the same class as hud.listening and
# kit-route.sh: the capability was present, good, and wired to nothing.
# Six local Whisper jobs at once took Caleb's load average to 50 on 2026-09-22
# while he was working, and he found out before this kit did. Network-bound
# fan-out stays free; this refuses only CPU-bound local inference and transcode
# run three or more wide, or run at all while the machine is already loaded.
_register("PreToolUse", hooks_dir + "/load-guard.sh", timeout=10,
          matcher="Bash",
          status="Checking this will not take over the machine...")

# zsh is the shell here and the agent writes bash. Three traps cost a full
# re-run each on 2026-09-27: `for path in` rebinding $PATH, "$G[v]" parsing as
# a subscript, and a flags variable passed as one argument. The third was
# already a memory note from 2026-09-22; it recurred because notes do not fire.
# Git commands that destroy uncommitted work other tabs may own, and removing
# another session's worktree (2026-10-09). See the hook's header.
_register("PreToolUse", hooks_dir + "/destructive-guard.sh", timeout=5,
          matcher="Bash", status="Checking nothing unsaved gets thrown away...")
# 2026-10-10: Erik's site draft went to Vercel; "never do anything on vercel
# ever again". Railway is the host. See the hook's header.
# write-log needs its Pre snapshot to see what a call changed. Registered here
# from the installed copy, which runs the kit runtime's code. Left out, the
# agent adapter added it as `python3.14 <checkout>/tools/shared_checks.py run
# write-log.sh`, which ran the shared checkout's copy: on 2026-10-11 that
# checkout was 87 commits behind and the Pre cost 1.6 s CPU against 0.37 s for
# the Post running current code.
_register("PreToolUse", hooks_dir + "/write-log.sh", matcher="Write|Edit|Bash|NotebookEdit")
_register("PreToolUse", hooks_dir + "/vercel-guard.sh", timeout=5,
          matcher="Bash", status="Checking this deploys to Railway, not Vercel...")
# 2026-10-12, reengineer step 15: two prose rules that no check backed
# (docs/plans/context-budget.md). git.md bans AI attribution in commits and
# CLAUDE.md bans publishing Artifacts; the host's prompt asks for both.
_register("PreToolUse", hooks_dir + "/attribution-guard.sh", timeout=5,
          matcher="Bash", status="Checking the message has no AI attribution...")
_register("PreToolUse", hooks_dir + "/artifact-guard.sh", timeout=5,
          matcher="Artifact", status="Checking this ships as a repo...")
# 2026-10-11: two Togari fixes sat as PRs while Railway deploys main;
# Karthik: never PR on BMA or Amber, push to main. See the hook's header.
_register("PreToolUse", hooks_dir + "/pr-guard.sh", timeout=5,
          matcher="Bash", status="Checking BMA and Amber work goes straight to main...")
# 2026-10-11: a post tagged a client for decks he had DM'd the day before.
# A post that tags a client waits for a fresh, clean gtme done. See the hook.
_register("PreToolUse", hooks_dir + "/client-ask-guard.sh", timeout=5,
          matcher="Bash", status="Checking the client has nothing unanswered first...")
# 2026-10-28: the next-step box asked "What time Friday?" about a call on his
# calendar. A question about a findable fact waits for a lookup this turn.
_register("PreToolUse", hooks_dir + "/ask-lookup-guard.sh", timeout=5,
          matcher="mcp__ccd_turn__wrap_up|AskUserQuestion")
# 2026-10-12: 13 automated posts from Caleb's account in #zeutara-cold-replies.
# "Everything should be togari": agents never post in client conversations.
_register("PreToolUse", hooks_dir + "/client-post-guard.sh", timeout=5,
          matcher="Bash|mcp__claude_ai_Slack__slack_send_message|mcp__claude_ai_Slack__slack_schedule_message",
          status="Checking this isn't posting as Caleb in a client channel...")
# 2026-10-11: a PDF took minutes by hand while chewbacca pdf-grade code sat in
# the GTM report. A job the kit already does is pointed at its command.
_register("PreToolUse", hooks_dir + "/use-the-kit-guard.sh", timeout=5,
          matcher="Bash", status="Checking the kit does not already do this...")
# 2026-10-11: generated prose went into a team Google Doc and a teammate
# called it "the slop version". Long Doc writes now pass slop-check --essay
# first. See the hook's header.
_register("PreToolUse", hooks_dir + "/essay-gate.sh", timeout=15,
          matcher="Bash", status="Checking this reads like a person wrote it...")
# 2026-11-02: ACAD 185 A20 was built from the dropbox brief while the W10S20
# lecture that assigned it sat unpulled. A coursework SPEC now has to cite it,
# and a `brightspace submit` needs such a SPEC, so skipping the SPEC fails too.
_register("PreToolUse", hooks_dir + "/lecture-gate.sh", timeout=10,
          matcher="Write|Edit|MultiEdit|Bash", status="Checking this spec read the lecture that assigned it...")
# 2026-10-11: the corrections Caleb repeated most in the fortnight before
# (docs/plans/REPEAT-MISTAKES.md). A long check in the foreground ("Wtf taking
# so long?", eight times), 3D work without Nalana, a new project with no look
# for the existing one. See the hook's header.
_register("PreToolUse", hooks_dir + "/lesson-guard.sh", timeout=5,
          matcher="Bash|Agent|Task",
          status="Checking this isn't a mistake he already corrected...")
# Same day, the chat repeats: u'll, unasked study nudges, asking for his
# paper draft. See the hook's header.
_register("Stop", hooks_dir + "/reply-lessons.sh", timeout=5)
_register("PreToolUse", hooks_dir + "/zsh-guard.sh", timeout=5,
          matcher="Bash",
          status="Checking this reads right in zsh...")

# suite-rerun-guard.sh is gone (2026-10-13): tests/run.sh asks
# bin/lib/suite-gate.sh itself before a full run, so no Bash call is read for it.

# 2026-10-03: three Claude tabs and Codex shared one checkout and collided.
_register("PreToolUse", hooks_dir + "/repo-overlap-guard.sh", timeout=5,
          matcher="Edit|Write|MultiEdit|NotebookEdit",
          status="Checking no other session is editing this checkout...")

# 2026-10-09, five tabs open at once: "Fix chewbs so tabs always know what other
# tabs are doing even across llms". The overlap guard above says SOMEONE edited
# the checkout; tabs.sh says who, in which runtime, on what ask, and which
# files, at session start and on every prompt. Codex reads the same board
# through tools/codex_hooks.py.
for _event in ("SessionStart", "UserPromptSubmit", "SessionEnd"):
    _register(_event, hooks_dir + "/tabs.sh", timeout=5)
_register("PreToolUse", hooks_dir + "/tabs.sh", timeout=5,
          matcher="Edit|Write|MultiEdit|NotebookEdit")

# 99.6% of iMessages since 2025 keep their words in attributedBody, not
# `text`. A `text LIKE` search of chat.db on 2026-10-03 found 1 Pasadena
# message where decoding found 2,213, and that silence reads as an answer.
_register("PreToolUse", hooks_dir + "/chatdb-guard.sh", timeout=5,
          matcher="Bash",
          status="Checking this chat.db search reads attributedBody...")

# Mail.app holds only the accounts added to it: on 2026-10-08 its newest
# message was 9/22, and on 2026-10-13 it was searched for USC invites it never
# had. Email goes through Gmail (chewbacca email).
_register("PreToolUse", hooks_dir + "/mail-app-guard.sh", timeout=5,
          matcher="Bash",
          status="Checking this email read goes through Gmail...")

_register("PreToolUse", hooks_dir + "/ux-guard.sh", timeout=15,
          matcher="Write|Edit",
          status="Checking this UI is not the generated look...")

# Two plans in a row on one repo opened with a measurement phase, and both
# times the measurement was skipped and the building started anyway. Seven
# sections got built from impressions overnight; the next day went on
# measuring them one at a time and finding every one wrong.
#
# Writing the plan was never the problem. Two good plans existed. Neither was
# followed, and nothing in the session could tell that it was not being
# followed, because a plan is prose and prose does not fail. So a PLAN.md may
# now carry a machine readable PLAN-GATES block naming, per phase, the
# artifacts that must exist and the paths writable until they do. Inert in
# any repo whose plan has no such block, which is nearly all of them.
_register("PreToolUse", hooks_dir + "/plan-guard.sh", timeout=10,
          matcher="Write|Edit",
          status="Checking this is the phase the plan is actually on...")

# Coursework is never turned in without being asked. This was a rule in prose
# that got broken twice in one night, so it became a gate.
_register("PreToolUse", hooks_dir + "/submit-guard.sh", timeout=10,
          matcher="mcp__chrome-devtools__.*|Bash|mcp__peekaboo__.*",
          status="Checking this is not a coursework submission...")

# An outbound campaign never launches on a list the pre-send gate did not pass
# in full. On 2026-10-04 lists called verified still carried 19 false
# personalized lines, refused sender domains and two CFOs; the client caught it.
_register("PreToolUse", hooks_dir + "/launch-guard.sh", timeout=10,
          matcher="Bash|mcp__peekaboo__.*|mcp__chrome-devtools__.*|"
                  "mcp__plugin_playwright_playwright__.*|Write|Edit|MultiEdit|NotebookEdit",
          status="Checking a campaign launch has a full pre-send gate pass...")

# Bulk Clay work goes through Clay tables, not shell loops of per-row workflow
# or action test runs. On 2026-10-05 that pattern took a night and a Claygent
# loop burned ~3,400 client credits on 150 rows before a row was priced.
_register("PreToolUse", hooks_dir + "/clay-native-guard.sh", timeout=5,
          matcher="Bash")

# A polling loop has to be able to stop. On 2026-10-09 an uncapped `until` deploy
# wait hit a zsh parse error, never passed, and polled Railway every 10s for an
# hour in the background.
_register("PreToolUse", hooks_dir + "/wait-loop-guard.sh", timeout=5,
          matcher="Bash")

# A deploy goes out on a clean name. On 2026-10-10 the prayer tool shipped as
# web-production-331de.up.railway.app; bin/railway-domain renames it.
_register("PostToolUse", hooks_dir + "/railway-domain-guard.sh", timeout=5,
          matcher="Bash")

# A founder call script is checked after every Google Doc write. On 2026-10-28
# the Firebox script went out too dense, with Gavin in a solo call and three
# founders in one tab, because the checker only ran when someone remembered.
_register("PostToolUse", hooks_dir + "/call-prep-guard.sh", timeout=20,
          matcher="Bash")

# Deploys go through GitHub. On 2026-10-27 kyber-landing's service had no repo
# because it was fed with railway up, and a pushed fix never deployed.
_register("PreToolUse", hooks_dir + "/railway-up-guard.sh", timeout=5,
          matcher="Bash")

# Say the ranking rule out loud before ranking, and name what would falsify
# the answer. Running someone's list top to bottom is not a method.
_register("UserPromptSubmit", hooks_dir + "/method-guard.sh", timeout=8,
          status="Naming the process and the falsifier...")

# FOUR HOOKS THAT WERE LIVE ON THE AUTHOR'S MACHINE AND REGISTERED NOWHERE.
#
# Found 2026-09-22 by diffing every .sh in .claude/hooks against every
# _register call, after ux-guard turned out to have the same hole. The cp above
# puts all of them on disk, so `command -v` and a file-exists check both say
# installed, and on any machine but the one where they were hand-added to
# settings.json they never ran once.
#
# skill-route is the expensive one. kit-route was fixed on 2026-09-21 after 105
# skills sat unnamed while work started; skill-route is the half that routes to
# the skills themselves and it still had no registration.
_register("UserPromptSubmit", hooks_dir + "/skill-route.sh", timeout=8,
          status="Checking whether a skill already covers this...")

# brain-recall pulls the memories that answer a prompt into context by meaning,
# so MEMORY.md's byte budget stops deciding what a session can recall. Built
# 2026-10-03 and registered nowhere until 2026-10-05 (CHW-140), the same
# built-but-never-fires failure as skill-route above. Silent below its cosine
# bar and when Ollama or the brain index is missing.
_register("UserPromptSubmit", hooks_dir + "/brain-recall.sh", timeout=5,
          status="Recalling what the brain knows about this...")

# The router's advice for graph-engineering was skipped twice in two sessions.
# skill-gate refuses the first tool call once until the named skill is loaded.
_register("PreToolUse", hooks_dir + "/skill-gate.sh", timeout=5)

# A study app shipped as a flat card grid on 2026-10-11 with the interface
# skill named and never loaded. A whole UI page waits for that skill.
_register("PreToolUse", hooks_dir + "/interface-first.sh", matcher="Write", timeout=5)

# A Kyber landing page went out on 2026-10-27 as a Tailwind CDN index.html with
# ux-pick never run. A site page waits for ux-pick plus the house stack.
_register("PreToolUse", hooks_dir + "/site-stack-gate.sh", matcher="Write", timeout=5)
_register("PreToolUse", hooks_dir + "/gtm-reuse-gate.sh", matcher="Write", timeout=5)

# ux-engine holds 18 research files, six stances, a motion constant table, a
# 24-entry effects catalog and 106 psychology principles, and a whole session
# of UI work on 2026-09-23 consulted none of it: the page shipped at 3
# animations against a reference's 214 while its own linter returned clean,
# because the linter scores the absence of tells and nothing scored ambition.
# Caleb: "no point of research if it doesn't get implemented."
#
# Puts two things in front of design work and only two, because a wall of
# doctrine reads the same as none: the constants that get violated most, and
# the avoid list of features that have actually lost a blind comparison here.
# The second one is the part that compounds.
_register("UserPromptSubmit", hooks_dir + "/design-context.sh", timeout=8)

# slop-guard can only refuse a reply that is already on screen, and the rewrite
# lands beside it as a duplicate. This puts the same rules, plus whatever the
# guard caught last turn, in front of the model before the reply is written.
_register("UserPromptSubmit", hooks_dir + "/voice-remind.sh", timeout=5)

_register("UserPromptSubmit", hooks_dir + "/ask-capture.sh", timeout=5)

# Jev's read of the task class where claude-model-router-hook's keywords are
# unsure, in 0.3 s instead of that router's 8 s haiku fallback. Advice only.
_register("UserPromptSubmit", hooks_dir + "/model-route.sh", timeout=6)

_register("Stop", hooks_dir + "/kit-autopush.sh", timeout=30,
          status="Pushing the kit...")

# The global instructions say never WebFetch a YouTube URL, because it returns
# no transcript. This hook makes that automatic instead of something to
# remember, and it had never been registered on any machine at all.
_register("UserPromptSubmit", hooks_dir + "/youtube-transcript-ready.sh", timeout=8)

# The kit learns from the session or the session did not finish. Caleb asked
# four times on 2026-09-20 whether Chewbacca had been updated with what a
# session learned and then said "I shouldn't hv to keep asking this bruv", so
# this was built to stop him having to ask. bin/kit-debt was installed and
# tested; the hook that calls it was never registered, so the gate built to
# answer that complaint has not fired once.
_register("Stop", hooks_dir + "/kit-debt.sh", timeout=15,
          status="Checking the kit learned something...")

# Written 2026-09-26 after a background job's empty output file was read four
# times and reported as a silent death; the job was buffering until the end of
# a twenty minute run. The hook shipped that day and was never registered, so
# it had not fired once by 2026-10-03, when hooks_registered.sh caught it.
# slop-guard reads the reply only; 80 thinking blocks in a day carried em
# dashes he reads in the editor (2026-10-10). Feeds forward, never refuses.
_register("Stop", hooks_dir + "/thinking-dash-guard.sh", timeout=5)
# The same hook mid-turn: a 40 minute overnight turn on 2026-10-19 never
# reached Stop, so 7 thinking dashes went unflagged while Caleb read them.
# Throttled to one 2 MB tail read per 20 seconds (about 140 ms).
_register("PostToolUse", hooks_dir + "/thinking-dash-guard.sh", timeout=5)
_register("Stop", hooks_dir + "/stale-read-guard.sh", timeout=5,
          status="Checking no unfinished job was called silent...")

# Jobs a closed tab left running get stopped when the next tab opens.
# 2026-10-10: a Clay crawler, a Nalana render and a transcription run outlived
# a force-quit and kept the Mac swapping.
_register("SessionStart", hooks_dir + "/orphan-reap.sh", timeout=10,
          status="Stopping jobs a closed tab left running...")

# A reply may not shrink scope he set as "all" unless each cut is a named
# BLOCKED: line. 2026-10-09: a creator ingest he asked for in full went out as
# 36 of 238 with three platforms on hold, and he said "You didn't listen to me."
_register("Stop", hooks_dir + "/scope-guard.sh", timeout=10,
          status="Checking the scope he asked for...")

# A reply may not say everything was read when this session read a source only
# in part. 2026-10-22: two ACAD 185 decks went through head -260 and the reply
# said the class was in. Caleb: "Did you ingest everything or just skim?"
_register("Stop", hooks_dir + "/skim-guard.sh", timeout=10,
          status="Checking every source was read whole...")

# A launch is ready only when `chewbacca gtme ready` says READY, signed and
# under 2 hours old. 2026-10-12: a Zeutara launch was called good "until Jonah
# responds" with 1 of 14 campaigns graded, gates 3 to 5 NOT CHECKED and an
# expired pre-send receipt. Caleb: "DONT TELL ME UR READY IF THIS SHIT IS HAPPENING?"
_register("Stop", hooks_dir + "/ready-guard.sh", timeout=10,
          status="Checking any launch-ready claim against gtme ready...")

# Every file link in a reply has to open from the session root. 2026-10-11: a
# render link written relative to ~/Downloads (the shell had cd'd there) gave
# "Couldn't open that file" when Caleb clicked it.
_register("Stop", hooks_dir + "/link-guard.sh", timeout=5,
          status="Checking every link in the reply opens...")

# Three defaults from the 2026-10-16 steering study
# (team/memory/feedback_caleb_steering_2026_10_16.md): 99 of his messages that
# day steered an agent, 2.59 per active agent hour.
# A turn may not end naming its own leftover. 22 pushes that day ("Are you
# done with your work? There's noting more you could do?") answered recaps
# that each listed one.
_register("Stop", hooks_dir + "/open-work-guard.sh", timeout=10,
          status="Checking nothing in the recap is left undone...")
# A turn that lands code saves its lesson. He typed "Learn and remember
# everything you should" 26 times that day.
_register("Stop", hooks_dir + "/learn-on-land.sh", timeout=10,
          status="Checking the lesson from this land was saved...")
# A BLOCKED: that hands him a click names two kit routes tried first. Before a
# live demo a Clay sort went to him twice: "Why can't you do it?"
_register("Stop", hooks_dir + "/blocked-route-guard.sh", timeout=10,
          status="Checking every route was tried before handing over a click...")
# A draft he'll send names where each number came from. 2026-10-16: eleven
# Zeutara drafts went by with none, and "about 100 replied personally" was an
# estimate. Caleb: "Wait is 1% actually the bar where did u get that".
_register("Stop", hooks_dir + "/draft-source-guard.sh", timeout=10,
          status="Checking every number in the draft has a source...")

# One brain commit per turn, named after the turn, in place of format-and-sync's
# one commit per write. See the hook's header for the 2026-10-05 history count.
_register("Stop", hooks_dir + "/brain-sync.sh", timeout=15,
          status="Saving the brain...")

# The pull half. kit-autopush made the remote the default for work leaving this
# machine; nothing made it the default for work arriving. `chewbacca update`
# could always pull and always needed somebody to remember, which is the exact
# sentence kit-autopush was written to retire.
#
# Fast-forward only, main only, origin only, and it refuses outright on a dirty
# working tree, so it cannot cost uncommitted work. Throttled to once an hour.
_register("SessionStart", hooks_dir + "/kit-autopull.sh", timeout=20,
          status="Pulling the kit...")

# The prose rules apply to files too, not only to replies. A draft that passes
# every detector can still carry six kickers.
_register("PostToolUse", hooks_dir + "/prose-guard.sh", timeout=20,
          matcher="Write|Edit",
          status="Checking the prose against the writing rules...")

# Caleb, 2026-09-27, three messages in a row: "Don't assume anything to be
# linear." "Don't expect any placements to be uniform." "Don't assume
# patterns." All three about one page that shipped 42 identical rectangles in
# a lattice where every fourth one failed, because the code said `i % 4 === 1`.
# The hook reads `.tool_input.file_path`, so it belongs here. It was registered
# under Stop until 2026-10-05, where that field never exists, so it exited 0 on
# every turn and had never checked a file.
_register("PostToolUse", hooks_dir + "/assumption-guard.sh", timeout=15,
          matcher="Write|Edit",
          status="Checking for invented structure...")

# The untrusted-content rule, checked instead of hoped for. A page, a text or a
# mail body that addresses the agent gets its excerpt put in front of the model
# with the rule attached. Warns, never blocks. See the hook for the tool list.
_register("PostToolUse", hooks_dir + "/clay-reply-guard.sh", timeout=5,
          matcher="Bash",
          status="Checking campaign replies are read as text, not as a category...")

# Above: an analytics reply category is not a reply. On 2026-10-05 "Interested"
# was a canned apply-on-our-site redirect and got reported as a lead.
_register("PostToolUse", hooks_dir + "/untrusted-screen.sh", timeout=15,
          matcher="WebFetch|Bash|mcp__claude-in-chrome__.*|mcp__plugin_playwright_playwright__.*",
          status="Screening what was just read for instructions aimed at the agent...")

# Every site browsed grows the API layer (Caleb, 2026-10-11: "it should
# reverse engineer an api so moving forward it gets more and more cracked").
# Before a browse, a host with taught ops is pointed at them; after one, a host
# with none is logged and the agent is nudged once per session to teach a
# read-only op or record why not. Context only, never blocks.
for _event in ("PreToolUse", "PostToolUse"):
    _register(_event, hooks_dir + "/api-grow.sh", timeout=5,
              matcher="WebFetch|Bash|mcp__claude-in-chrome__navigate|mcp__plugin_playwright_playwright__browser_navigate|mcp__chrome-devtools__navigate_page|mcp__chrome-devtools__new_page")

h["Notification"] = [{"hooks": [{
    "type": "command",
    "command": "say 'Claude Code task complete' 2>/dev/null || true",
    "async": True,
}]}]

# The terminal loop: hud-listen hears when the remembered Claude Code tab is
# waiting on a permission, answers it by voice, and says when a turn ends.
# One wrapper for six events. Every session gets one line in
# agent-events.jsonl for the agent board (bin/agents); only the remembered
# tab's events reach the voice, and only its prompts are held. 45 s: the hook holds a
# permission prompt for 30 s while the voice asks, and needs room above that.
for _event in ("PermissionRequest", "PreToolUse", "PostToolUse", "PermissionDenied", "Stop", "SessionEnd"):
    _register(_event, hooks_dir + "/terminal-loop.sh", timeout=45)

# Your commits are yours. Claude Code appends a Co-Authored-By trailer and a
# "Generated with Claude Code" line to pull requests by default, and stripping
# those out of a history later means rewriting every commit and force-pushing.
# Turn it off before the first commit instead of after the hundredth.
settings["includeCoAuthoredBy"] = False

# Auto-memory writes into the private context repo instead of a directory
# nobody ever reads. Without this key Claude's own learnings land somewhere
# outside the brain and never get committed with the rest of it.
_pc = env("D1_PC_DIR") or ""
if _pc:
    settings["autoMemoryDirectory"] = os.path.join(_pc, "memory")

# One status line: model, directory, branch, context used, session cost.
if not (isinstance(_user_status, dict) and _user_status.get("command")
        and "statusline.sh" not in str(_user_status.get("command"))):
    settings["statusLine"] = {"type": "command", "command": hooks_dir + "/statusline.sh"}

# Hooks this machine has opted out of, by basename, one per line in
# ~/.chewbacca/skip-hooks or space-separated in D1_SKIP_HOOKS. Without this,
# removing a hook from settings.json lasted until the next `chewbacca update`,
# which re-runs this block and registers everything again. Applied last, so it
# wins over every registration above. Only hooks named here are touched.
_skip = set(env("D1_SKIP_HOOKS", "").split())
_skip_file = os.path.expanduser("~/.chewbacca/skip-hooks")
if os.path.exists(_skip_file):
    with open(_skip_file) as f:
        _skip |= {line.split("#")[0].strip() for line in f} - {""}
if _skip:
    for _event in list(h):
        for _entry in h[_event]:
            # Any token, not only the first: a shared check is registered as
            # `python3 shared_checks.py run write-log.sh`.
            _entry["hooks"] = [hook for hook in _entry.get("hooks", [])
                               if not {os.path.basename(t) for t in str(hook.get("command", "")).split()} & _skip]
        h[_event] = [e for e in h[_event] if e.get("hooks")]
        if not h[_event]:
            del h[_event]
    print("Hooks skipped by ~/.chewbacca/skip-hooks: " + ", ".join(sorted(_skip)))

# One hookd for every gated guard sharing a matcher (crates/hookd/src/
# dispatch.rs). On 2026-10-12 twenty gated PreToolUse entries each cost the
# host a shell, a bash start and a hookd start, ~6 ms of CPU apiece, to say
# "skip" before every Bash call; the 13 on matcher Bash now answer in one
# process. Each guard keeps its timeout. Built after the skip list,
# so a skipped guard is never folded in, and only when the installed hookd
# answers the probe: an older binary answers an unknown verb with exit 0,
# which would skip every guard. Without the binary at call time the entry
# runs hookd-fallback.sh, every guard, ungated.
import subprocess as _sp
_hookd = os.path.expanduser("~/.local/bin/hookd")
_GATED = 'H="$HOME/.local/bin/hookd"; [ -x "$H" ] && exec "$H" gate '
_DISPATCH = 'H="$HOME/.local/bin/hookd"; [ -x "$H" ] && exec "$H" dispatch '


def _probe():
    try:
        r = _sp.run([_hookd, "dispatch", "--probe"], capture_output=True, text=True, timeout=10)
    except (OSError, _sp.SubprocessError):
        return False
    return r.returncode == 0 and r.stdout.strip() == "hookd dispatch 1"


def _foldable(entry):
    """(matcher, timeout, script) for an entry that is one gated guard."""
    hooks = entry.get("hooks") or []
    if len(hooks) != 1 or set(entry) - {"hooks", "matcher"}:
        return None
    hook = hooks[0]
    # A status line is cosmetic and gated guards answer in milliseconds, so
    # it is dropped; async or any other key keeps the entry as it is.
    if set(hook) - {"type", "command", "timeout", "statusMessage"} or hook.get("type", "command") != "command":
        return None
    command = str(hook.get("command", ""))
    if not command.startswith(_GATED):
        return None
    script = shlex.split(command)[-1]
    if gated(script) != command:
        return None
    # The host's own default when a hook names none (Claude Code docs).
    return entry.get("matcher") or "", int(hook.get("timeout") or 60), script


_dispatching = _probe()


def _dispatch_entry(matcher, guards):
    # Every guard here shares the entry's matcher, so the host's own matching
    # (regex, legacy names, tool families) decides when they run, exactly as
    # it did per guard; inside, each is '*'. A security review of the first
    # version (2026-10-12) found its in-process matcher anchored where the
    # host's regex is not, and blind to the host's tool aliases.
    argv = " ".join("--guard '*' %d %s" % (t, shlex.quote(sc)) for t, sc in guards)
    fallback = shlex.quote(hooks_dir + "/hookd-fallback.sh")
    entry = {"hooks": [{
        "type": "command",
        "command": _DISPATCH + argv + "; exec /bin/bash " + fallback + " " + argv,
        # Longest guard plus the second of grace hookd gives each one plus
        # slack for hookd itself, so the host never kills the whole answer.
        "timeout": max(t for t, _ in guards) + 3,
    }]}
    if matcher not in ("", "*"):
        entry["matcher"] = matcher
    return entry


for _event in ("PreToolUse", "PostToolUse"):
    if _event not in h:
        continue
    # An earlier run's dispatch entry is rebuilt from what is registered now.
    entries = [e for e in h[_event] if not any(str(x.get("command", "")).startswith(_DISPATCH)
                                               for x in e.get("hooks", []))]
    folded = [(e, _foldable(e)) for e in entries]
    groups = {}
    for _, g in folded:
        if g:
            groups.setdefault(g[0], []).append(g[1:])
    out, placed = [], set()
    for e, g in folded:
        if not _dispatching or not g or len(groups[g[0]]) < 2:
            out.append(e)
        elif g[0] not in placed:
            placed.add(g[0])
            out.append(_dispatch_entry(g[0], groups[g[0]]))
    h[_event] = out
    for m in placed:
        print(f"{_event}: {len(groups[m])} gated guards on matcher {m or '*'} answer through one hookd")

for _ev, _entries in _user_hooks.items():
    for _e in _entries:
        if _e not in h.setdefault(_ev, []):
            h[_ev].append(_e)

# The file now holds an Anthropic key and a GitHub PAT. Write it atomically so
# a crash cannot truncate it, and 0600 so it is not world-readable.
# Through a symlink to its target (a dotfiles repo keeps settings.json there;
# os.replace on the link swapped it for a plain file), and never over a file
# the user made read-only (break-it, 2026-10-19).
real_settings = os.path.realpath(settings_path)
if os.path.exists(real_settings) and not os.access(real_settings, os.W_OK):
    raise SystemExit(f"setup: {real_settings} is read-only, so it was left as it is. "
                     "Make it writable and run setup again to update it.")
tmp_path = real_settings + ".tmp"
with open(tmp_path, "w") as f:
    json.dump(settings, f, indent=2)
os.chmod(tmp_path, 0o600)
os.replace(tmp_path, real_settings)

print("Settings written.")
PYEOF

unset D1_GITHUB_PAT D1_ANTHROPIC_KEY D1_TODOIST_TOKEN
fi
log "~/.claude/settings.json configured"


# ── Wire the editor extension ─────────────────────────────────────────────────
if should_run editor; then
# permissions.defaultMode above is only half of it. The VS Code extension gates
# bypass mode behind its own setting, so with the CLI configured and the editor
# not, you still get prompted inside the editor. This merges the keys from
# config/settings/vscode-settings.json into whichever editors are installed.
section "Wiring editor settings"

export D1_EDITOR_TEMPLATE="$SCRIPT_DIR/config/settings/vscode-settings.json"

python3 << 'PYEDITOR'
import json, os, re, shutil

template_path = os.environ.get("D1_EDITOR_TEMPLATE", "")
try:
    with open(template_path) as f:
        template = json.load(f)
except Exception:
    print("  ! config/settings/vscode-settings.json not readable, skipping editors")
    raise SystemExit(0)

# Keys starting with _comment document the template. They are not settings.
desired = {k: v for k, v in template.items() if not k.startswith("_comment")}

# The editor is the second of the three places permission prompts get turned
# off. Without --bypass-permissions, drop those two keys and keep the rest of
# the template, which is ordinary editor configuration.
if os.environ.get("D1_BYPASS_PERMS") != "yes":
    for k in ("claudeCode.allowDangerouslySkipPermissions",
              "claudeCode.initialPermissionMode"):
        desired.pop(k, None)
    print("  Permission prompts left on in the editor extension.")

home = os.path.expanduser("~")
if os.name == "nt":
    base = os.path.join(os.environ.get("APPDATA", ""), "")
elif os.uname().sysname == "Darwin":
    base = os.path.join(home, "Library", "Application Support")
else:
    base = os.path.join(home, ".config")

editors = [
    ("VS Code", "Code"),
    ("VS Code Insiders", "Code - Insiders"),
    ("Cursor", "Cursor"),
    ("VSCodium", "VSCodium"),
    ("Windsurf", "Windsurf"),
]

def strip_jsonc(text):
    # VS Code writes real JSON but accepts JSONC, and people hand-edit these
    # files with comments in them. Strip // and /* */ outside strings, then
    # trailing commas, so a commented file is updated instead of clobbered.
    out, i, n = [], 0, len(text)
    in_str = escaped = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
        elif text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
        else:
            out.append(c)
            i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))

touched = 0
for label, dirname in editors:
    user_dir = os.path.join(base, dirname, "User")
    if not os.path.isdir(user_dir):
        continue
    path = os.path.join(user_dir, "settings.json")

    current = {}
    if os.path.exists(path):
        with open(path) as f:
            raw = f.read()
        for candidate in (raw, strip_jsonc(raw)):
            try:
                parsed = json.loads(candidate) if candidate.strip() else {}
            except Exception:
                continue
            if isinstance(parsed, dict):
                current = parsed
                break
        else:
            # Unparseable. Adding keys blind would destroy real settings.
            print("  ! " + label + " settings.json could not be parsed. Left alone.")
            print("    Add these by hand: claudeCode.allowDangerouslySkipPermissions,")
            print("    claudeCode.initialPermissionMode")
            continue
        shutil.copy2(path, path + ".d1-backup")

    # The user's own choices win, except for the two keys that are the whole
    # point of this step. Reruns of setup.sh should not undo a deliberate
    # "actually, prompt me" decision on the cosmetic keys.
    forced = {"claudeCode.allowDangerouslySkipPermissions",
              "claudeCode.initialPermissionMode"}
    for key, value in desired.items():
        if key in forced or key not in current:
            current[key] = value

    os.makedirs(user_dir, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(current, f, indent=2)
    os.replace(tmp, path)
    print("  " + label + " configured")
    touched += 1

if touched == 0:
    print("  No supported editor found. Nothing to do.")
else:
    print("  Restart the editor for the change to take effect.")
PYEDITOR

unset D1_EDITOR_TEMPLATE
log "Editor settings configured"
fi

# ── Wire the Claude desktop app ───────────────────────────────────────────────
if should_run desktop; then
# The desktop app runs its own copy of the CLI and reads ~/.claude/settings.json,
# so permissions.defaultMode above already covers its chat and code sessions.
# What it does NOT cover is coding tasks dispatched from the app, which have a
# separate preference of their own that ships defaulting to "acceptEdits", so
# bash commands still stop and ask. That preference lives in the app's own
# config store, not in settings.json.
section "Wiring the Claude desktop app"

if pgrep -x "Claude" >/dev/null 2>&1; then
  warn "Claude is running. It rewrites its config on quit, which would drop this"
  warn "  change. Quit Claude, then rerun setup.sh, or set Code tasks to bypass"
  warn "  from the app's own settings."
fi

python3 << 'PYDESKTOP'
import json, os, shutil

home = os.path.expanduser("~")
if os.name == "nt":
    appdata = os.environ.get("APPDATA", "")
    base = os.path.join(appdata, "Claude") if appdata else ""
elif os.uname().sysname == "Darwin":
    base = os.path.join(home, "Library", "Application Support", "Claude")
else:
    base = os.path.join(home, ".config", "Claude")

if not base or not os.path.isdir(base):
    print("  Claude desktop app not installed. Nothing to do.")
    raise SystemExit(0)

path = os.path.join(base, "config.json")
config = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            config = json.load(f)
    except Exception:
        # The app renames an unparseable config to .corrupt-<ts> and starts
        # fresh. Writing over it here would throw away whatever it could still
        # recover, and the app will rebuild it anyway.
        print("  ! config.json is not valid JSON. Left alone; the app will rebuild it.")
        raise SystemExit(0)
    if not isinstance(config, dict):
        print("  ! config.json is not an object. Left alone.")
        raise SystemExit(0)
    shutil.copy2(path, path + ".d1-backup")

# Enum the app accepts: default, acceptEdits, plan, auto, bypassPermissions.
# Anything else fails its schema check and the app discards the whole file.
#
# Only written when --bypass-permissions was passed. This was the third of
# three files that turned off the safety net, and the one nobody would think
# to look in.
if os.environ.get("D1_BYPASS_PERMS") != "yes":
    print("  Permission prompts left on in the desktop app.")
    raise SystemExit(0)
config["dispatchCodeTasksPermissionMode"] = "bypassPermissions"

tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(config, f, indent=2)
# The store holds account identifiers. Keep it owner-only, the way the app
# writes it, instead of inheriting the umask.
os.chmod(tmp, 0o600)
os.replace(tmp, path)
print("  Code tasks set to bypassPermissions")
PYDESKTOP

log "Claude desktop app configured"
fi

# ── Wire .mcp.json ────────────────────────────────────────────────────────────
if should_run mcp; then
section "Wiring .mcp.json"

MCP_FILE="$HOME/.claude.json"

export D1_MCP_FILE="${MCP_FILE:-}"
export D1_COMPOSIO_URL="${COMPOSIO_URL:-}"
export D1_COMPOSIO_KEY="${COMPOSIO_KEY:-}"

python3 << 'PYEOF2'
import json, os

# Same reason as the settings block: values come through the environment so a
# key containing a quote or backslash cannot break the script.
env = os.environ.get

mcp_path = env("D1_MCP_FILE", "")
if not mcp_path:
    raise SystemExit(0)

parent = os.path.dirname(mcp_path)
if parent:
    os.makedirs(parent, exist_ok=True)

try:
    with open(mcp_path) as f:
        mcp = json.load(f)
except Exception:
    mcp = {"mcpServers": {}}

# This file carries the user's whole Claude Code state, not just MCP. Touch
# exactly one key and write atomically; a truncated write here is expensive.
mcp.setdefault("mcpServers", {})

composio_url = env("D1_COMPOSIO_URL", "").strip()
composio_key = env("D1_COMPOSIO_KEY", "").strip()

# One server that needs no account, no key, and no running service, so it can
# be wired unconditionally. sequential-thinking and blender were dropped
# 2026-10-05: zero calls across two weeks of transcripts on the machine that
# had them, and every listed tool is paid for in context each session. setdefault, so an existing entry is never clobbered.
# Everything else is left to the user: ~/.claude.json is where client hostnames
# and API keys live.
# filesystem was dropped 2026-10-09: every Claude tab boots its own copy of
# each MCP server, and a 12-tab restart put 252 MCP processes on the Mac at
# load 106. Read, Write and Edit already cover the whole home directory.

if composio_url:
    mcp["mcpServers"]["composio"] = {
        "url": composio_url,
        "headers": {"x-api-key": composio_key} if composio_key else {},
    }

# The iMessage agent is a CLI (bun run agent.ts --mode scan/inbox/run). It does
# not speak MCP stdio, so Claude invokes it through Bash and it gets no entry here.

tmp_path = mcp_path + ".tmp"
with open(tmp_path, "w") as f:
    json.dump(mcp, f, indent=2)
os.replace(tmp_path, mcp_path)

print("MCP config written.")
PYEOF2

unset D1_MCP_FILE D1_COMPOSIO_URL D1_COMPOSIO_KEY
log ".mcp.json configured"
fi

# ── Install D1 rules globally ─────────────────────────────────────────────────
if should_run rules; then
section "Installing rules and commands globally"

GLOBAL_CLAUDE="$HOME/.claude"
mkdir -p "$GLOBAL_CLAUDE/commands" "$GLOBAL_CLAUDE/rules"

cp "$SCRIPT_DIR/.claude/commands/"*.md "$GLOBAL_CLAUDE/commands/" 2>/dev/null || true
cp "$SCRIPT_DIR/.claude/rules/"*.md    "$GLOBAL_CLAUDE/rules/"    2>/dev/null || true
install_agent_neutral_rule
# Inside the kit's own checkout the project CLAUDE.md and rules duplicate what
# was just copied to ~/.claude: 14,624 tokens loaded twice on a kit
# session's first turn (2026-10-16). Skip the project copies whose bytes match.
python3 "$SCRIPT_DIR/tools/claude_md_dedupe.py" excludes --apply --root "$SCRIPT_DIR" >/dev/null 2>&1 || true
mkdir -p "$GLOBAL_CLAUDE/agents"
cp "$SCRIPT_DIR/.claude/agents/"*.md   "$GLOBAL_CLAUDE/agents/"   2>/dev/null || true

# Output styles replace Claude Code's software-engineering system prompt rather
# than adding to it, which is what the other four layers cannot do. Installed,
# never selected: picking one is a per-project choice made in /config.
mkdir -p "$GLOBAL_CLAUDE/output-styles"
cp "$SCRIPT_DIR/.claude/output-styles/"*.md "$GLOBAL_CLAUDE/output-styles/" 2>/dev/null || true
# Which standards file lands here decides what every future session costs and
# what it optimizes for. The developer one mandates Next.js, Tailwind, shadcn,
# a design system and a deploy checklist, on every prompt including the ones
# about someone's calendar. That is the right file for people who write code
# and the wrong file for everyone else.
case "$PROFILE" in
  personal|student) STANDARDS="$SCRIPT_DIR/docs/reference/CLAUDE-PERSONAL.md" ;;
  *)                STANDARDS="$SCRIPT_DIR/CLAUDE.md" ;;
esac
# Merge, do not clobber. Anyone who already had a CLAUDE.md lost it here, with
# no backup and no warning. The logic lives in its own file so it can be tested;
# it could not be, buried in a 1,700-line installer.
# It prints one word and exits 1 on refused, so `|| true` keeps that word
# rather than appending a second one.
MERGE_RESULT="$(bash "$SCRIPT_DIR/bin/lib/merge-claude-md.sh" "$GLOBAL_CLAUDE/CLAUDE.md" "$STANDARDS" 2>/dev/null || true)"
case "$MERGE_RESULT" in
  merged) warn "You already had a CLAUDE.md. It is kept below the standards, and"
          warn "  the original is backed up next to it as CLAUDE.md.yours-*" ;;
  updated) log "Standards region updated, your own additions left alone" ;;
  unchanged) log "Standards already current in ~/.claude/CLAUDE.md" ;;
  refused) warn "Left ~/.claude/CLAUDE.md alone: it is read-only or its Chewbacca"
           warn "  markers are unbalanced. Fix that, then re-run setup." ;;
  wrote|adopted) ;;
  *) warn "Could not write ~/.claude/CLAUDE.md" ;;
esac
# doctor.sh reads this. Without it, it checks for the coursework ledger and the
# GitHub repos that a personal install deliberately never creates, and reports
# their absence as warnings on a perfectly healthy machine.
echo "$PROFILE" > "$GLOBAL_CLAUDE/.chewbacca-profile"

# Count what LANDED, not what was offered.
#
# Every cp above is `2>/dev/null || true`, so a failure is silent by
# construction. These lines used to count the SOURCE directory and report that
# as the install, which means a run where nothing copied still printed "Rules
# installed to ~/.claude/rules/ (12 files)". On this machine seven of the nine
# rules CLAUDE.md imports were absent while setup had reported success, so every
# session silently loaded two standards instead of nine.
installed_count() {
  local src="$1" dst="$2" label="$3"
  local want have
  want=$(ls "$src"/*.md 2>/dev/null | wc -l | tr -d ' ')
  have=$(ls "$dst"/*.md 2>/dev/null | wc -l | tr -d ' ')
  if [ "$have" -lt "$want" ]; then
    warn "$label: $have of $want landed in $dst"
    warn "  Check permissions on that directory, then re-run setup."
  else
    log "$label installed to $dst ($have files)"
  fi
}
installed_count "$SCRIPT_DIR/.claude/commands" "$GLOBAL_CLAUDE/commands" "Commands"
installed_count "$SCRIPT_DIR/.claude/rules"    "$GLOBAL_CLAUDE/rules"    "Rules"
installed_count "$SCRIPT_DIR/.claude/agents"   "$GLOBAL_CLAUDE/agents"   "Subagents"
log "CLAUDE.md installed to ~/.claude/CLAUDE.md ($(basename "$STANDARDS"))"
fi

# ── Shared agent context ─────────────────────────────────────────────────────
if should_run agents; then
if [ "$ONLY_PORTABLE" -eq 0 ]; then install_backend_launchers; fi
install_agent_instructions
fi

# ── Skills and plugins ────────────────────────────────────────────────────────
if should_run skills; then
section "Installing skills"

mkdir -p "$GLOBAL_CLAUDE/skills"
# Symlink each skill, and count what landed.
#
# This was `cp -R ... 2>/dev/null || true`, which produced two failures at once
# and reported neither. Copies froze at whatever existed when setup last ran, so
# a skill fixed in the repo stayed broken on disk; and skills added since the
# last run were simply absent. Seven of twenty-seven were missing on this
# machine, `people`, `texts`, `study-guide` and `stack-rules` among them, which
# is why sentences about those subjects loaded no skill: there was nothing to
# load. A skill that is not installed is not a skill with a bad description.
#
# Only this repo's own skills are touched. ~/.claude/skills holds many skills
# from elsewhere and nothing here may remove or overwrite one of those.
_skills_want=0; _skills_have=0
for _sk in "$SCRIPT_DIR"/skills/*/; do
  [ -d "$_sk" ] || continue
  _skn="$(basename "$_sk")"
  _skills_want=$((_skills_want + 1))
  _dst="$GLOBAL_CLAUDE/skills/$_skn"
  # A real directory here is a copy from an older setup, or someone else's skill
  # of the same name. Replace our own copies; never touch a foreign one.
  if [ -d "$_dst" ] && [ ! -L "$_dst" ] && [ ! -f "$_dst/.chewbacca" ] && [ -f "$_sk/SKILL.md" ]; then
    if cmp -s "$_dst/SKILL.md" "$_sk/SKILL.md" 2>/dev/null || grep -q "^name: $_skn$" "$_dst/SKILL.md" 2>/dev/null; then
      rm -rf "$_dst"
    else
      warn "skill '$_skn' already exists and is not ours, leaving it alone"
      continue
    fi
  fi
  ln -sfn "$_sk" "$_dst"
  [ -f "$_dst/SKILL.md" ] && _skills_have=$((_skills_have + 1))
done
if [ "$_skills_have" -lt "$_skills_want" ]; then
  warn "skills: $_skills_have of $_skills_want linked into $GLOBAL_CLAUDE/skills"
else
  log "Skills linked to ~/.claude/skills/ ($_skills_have)"
fi
unset _sk _skn _dst _skills_want _skills_have
# The gtm-engineering skill ships in Dough with the gtme engine (Dough SPEC section 5).
# Linked through ~/.chewbacca/dough/current, which the kit runtime installs, so the
# link follows every Dough update. A real directory of the same name is left alone;
# an old link (into a checkout's skills/) is repointed, here and in the shared library.
_dough_cur="${CHEWBACCA_DOUGH_RUNTIME:-$HOME/.chewbacca/dough}/current"
for _sk in "$_dough_cur"/skills/*/; do
  [ -f "$_sk/SKILL.md" ] || continue
  _skn="$(basename "$_sk")"
  for _dst in "$GLOBAL_CLAUDE/skills/$_skn" "$HOME/.chewbacca/skills/$_skn"; do
    [ -d "$(dirname "$_dst")" ] || continue
    if [ -e "$_dst" ] && [ ! -L "$_dst" ]; then
      warn "skill '$_skn' at $_dst is not a link, leaving it alone"
      continue
    fi
    ln -sfn "$_dough_cur/skills/$_skn" "$_dst"
  done
done
[ -d "$_dough_cur/skills" ] && log "Dough's skills linked from $_dough_cur/skills"
unset _sk _skn _dst _dough_cur
log "Skills installed to ~/.claude/skills/"

fi

# Split out from the skills above on 2026-09-19. Skills are plain markdown and
# work on any machine any agent runs on, but they lived inside this section, so
# the portable profile, which is the only non-macOS path, installed 57 commands
# and 14 rules and zero skills. The largest single piece of the kit was missing
# from every Windows and Linux install.
#
# The comment goes above the header, not below it: a section header has to be
# immediately followed by `if should_run` or the guard closes early and the
# section runs on every invocation, including --only.
# ── Plugins and MCP ───────────────────────────────────────────────────────────
if should_run plugins; then

# Nothing this installs may open a window or a browser tab on somebody's
# machine without being asked. Serena's upstream default does exactly that, and
# it is why a browser window appeared on a tester's computer on 2026-09-19 and
# he concluded the kit was dangerous. The logic lives in its own file so it can
# be tested; it could not be, inside a shell function in a 2,000-line installer.
if [ -x "$SCRIPT_DIR/bin/lib/seed-serena-config.sh" ]; then
  if [ -n "$(bash "$SCRIPT_DIR/bin/lib/seed-serena-config.sh")" ]; then
    log "Serena dashboard disabled (it opens a browser tab by default)"
  fi
fi

# BEGIN GENERATED: extensions
# Upstream skills are cloned rather than vendored, so each stays updatable and
# keeps the LICENSE it shipped with. add-skill.sh does the same thing by hand.
while IFS='|' read -r SK_NAME SK_URL SK_PATH SK_LICENSE SK_AUTHOR; do
  [ -n "$SK_NAME" ] || continue
  if [ -d "$GLOBAL_CLAUDE/skills/$SK_NAME" ]; then
    log "$SK_NAME already present, left alone"
    continue
  fi
  # Rows installed by their own tool (cap) carry a note, not a path.
  case "$SK_PATH" in "installed by"*) continue ;; esac
  TMP_SK="$(mktemp -d)"
  # A skill that lives in one folder of a large repo is fetched alone:
  # awesome-llm-apps is about 220MB and two skills here come from it.
  # `|| true` because setup.sh runs under set -e and one unreachable repo must
  # not stop the rest of the install.
  if [ -n "$SK_PATH" ]; then
    git clone -q --depth 1 --filter=blob:none --sparse "$SK_URL" "$TMP_SK" 2>/dev/null \
      && git -C "$TMP_SK" sparse-checkout set --no-cone "/$SK_PATH/" /LICENSE 2>/dev/null || true
  else
    git clone -q --depth 1 "$SK_URL" "$TMP_SK" 2>/dev/null || true
  fi
  SK_SRC="$TMP_SK"
  [ -n "$SK_PATH" ] && SK_SRC="$TMP_SK/$SK_PATH"
  # Judge by the SKILL.md, not by the clone: a path upstream moved still clones
  # fine and would leave an empty skill logged as installed, then skipped forever.
  if [ -f "$SK_SRC/SKILL.md" ]; then
    mkdir -p "$GLOBAL_CLAUDE/skills/$SK_NAME"
    cp -R "$SK_SRC/." "$GLOBAL_CLAUDE/skills/$SK_NAME/" 2>/dev/null || true
    rm -rf "$GLOBAL_CLAUDE/skills/$SK_NAME/.git"
    [ -f "$TMP_SK/LICENSE" ] && cp "$TMP_SK/LICENSE" "$GLOBAL_CLAUDE/skills/$SK_NAME/LICENSE" 2>/dev/null
    { printf 'source: %s\n' "$SK_URL"
      [ -n "$SK_PATH" ] && printf 'path: %s\n' "$SK_PATH"
      printf 'installed: %s\n' "$(date -u +%Y-%m-%d)"
    } > "$GLOBAL_CLAUDE/skills/$SK_NAME/.source"
    log "$SK_NAME installed ($SK_LICENSE, $SK_AUTHOR)"
  else
    warn "Could not fetch $SK_NAME from $SK_URL${SK_PATH:+ ($SK_PATH)}. See docs/reference/EXTENSIONS.md to add it later."
  fi
  rm -rf "$TMP_SK"
done <<'UPSTREAM_SKILLS'
app-growth|https://github.com/31Carlton7/skills|app-growth|MIT|31Carlton7
app-review|https://github.com/31Carlton7/skills|app-review|MIT|31Carlton7
avoid-ai-writing|https://github.com/conorbronsdon/avoid-ai-writing||MIT|conorbronsdon
cap|https://github.com/CapSoftware/Cap|installed by `cap agents install --target claude`|see upstream|CapSoftware
cap-demo|https://github.com/CapSoftware/Cap|installed by `cap agents install --target claude`|see upstream|CapSoftware
deslop|https://github.com/31Carlton7/skills|deslop|see upstream|31Carlton7
first-reader|https://github.com/Shubhamsaboo/awesome-llm-apps|agent_skills/first-reader|Apache-2.0|Shubhamsaboo
ghostwrite|https://github.com/31Carlton7/skills|ghostwrite|MIT|31Carlton7
heavy-work|https://github.com/31Carlton7/skills|heavy-work|MIT|31Carlton7
no-ai-slop|https://github.com/petergyang/no-ai-slop|skills/no-ai-slop|MIT|petergyang
ship-feature|https://github.com/31Carlton7/skills|ship-feature|MIT|31Carlton7
swiftui|https://github.com/31Carlton7/skills|swiftui|MIT|31Carlton7
thinking-out-loud|https://github.com/Shubhamsaboo/awesome-llm-apps|agent_skills/thinking-out-loud|Apache-2.0|Shubhamsaboo
youtube-transcripts|https://github.com/calebnewtonusc/claude-youtube-transcripts|skills/youtube-transcripts|MIT|calebnewtonusc
UPSTREAM_SKILLS

# `command -v claude` only proves a binary is on PATH. It does not prove
# the CLI can do anything, and on a machine where it was installed a
# minute ago and never signed in, every plugin install below fails. Two
# people testing this on 2026-09-19 watched nineteen consecutive red
# lines scroll past, which reads as a broken product rather than as one
# optional step being unavailable. Ask it one cheap question first.
PLUGINS_OK=0
if command -v claude &>/dev/null; then
  if claude plugin marketplace list </dev/null &>/dev/null; then
    PLUGINS_OK=1
  else
    warn "Claude Code is installed but not signed in yet, so plugins were skipped."
    warn "  Sign in by running: claude"
    warn "  Then install them with: chewbacca setup --only plugins"
  fi
fi

if [ "$PLUGINS_OK" -eq 1 ]; then
  for m in \
    anthropics/claude-plugins-official \
    clay-run/agent-plugins; do
    claude plugin marketplace add "$m" </dev/null &>/dev/null || true
  done
  log "Marketplaces registered"

  PLUGIN_FAILED=0
  for p in \
    playwright@claude-plugins-official \
    pyright-lsp@claude-plugins-official \
    railway@claude-plugins-official \
    security-guidance@claude-plugins-official \
    serena@claude-plugins-official \
    swift-lsp@claude-plugins-official \
    typescript-lsp@claude-plugins-official \
    vercel@claude-plugins-official; do
    if claude plugin install "$p" --scope user </dev/null &>/dev/null; then
      log "installed ${p%%@*}"
    else
      warn "could not install ${p%%@*}"
      PLUGIN_FAILED=1
    fi
  done

  if [ "$PLUGIN_FAILED" -eq 1 ]; then
    warn "Some plugins failed. Retry individually: claude plugin install <name>"
  fi
  log "Plugins needing OAuth (Vercel, Railway) stay inert until you run /mcp and authorize."
elif ! command -v claude &>/dev/null; then
  warn "Claude Code is not installed, so plugins were skipped. Add it, then re-run:"
  warn "  curl -fsSL https://claude.ai/install.sh | bash"
  warn "  chewbacca setup --only plugins"
fi

# MCP servers, curated from mcpmarket.com. See docs/reference/EXTENSIONS.md.
#
# Two tiers on purpose. The keyless ones are installed outright. The ones
# needing an account are installed only when their variables are already
# exported, because `claude mcp add` will happily register a server that
# fails on every call, and a broken tool in the list is worse than a
# missing one: the agent keeps reaching for it.
# Same probe as the plugins above: a signed-out CLI registers nothing
# and warns once per server.
if [ "$PLUGINS_OK" -eq 1 ]; then
  mcp_present() { claude mcp list 2>/dev/null | grep -q "^$1:"; }

  while IFS='|' read -r M_NAME M_CMD M_ARGS; do
    [ -n "$M_NAME" ] || continue
    if mcp_present "$M_NAME"; then
      log "$M_NAME already registered"
      continue
    fi
    # shellcheck disable=SC2086  # M_ARGS is a deliberate argument list
    if claude mcp add "$M_NAME" --scope user -- "$M_CMD" $M_ARGS &>/dev/null; then
      log "$M_NAME registered"
    else
      warn "could not register $M_NAME"
    fi
  # git was dropped 2026-10-09 with filesystem above: 26 copies across 13
  # tabs, for tools the git CLI already gives every agent.
  done <<'KEYLESS_MCP'
KEYLESS_MCP

  while IFS='|' read -r M_NAME M_CMD M_ARGS M_ENV; do
    [ -n "$M_NAME" ] || continue
    if mcp_present "$M_NAME"; then
      log "$M_NAME already registered"
      continue
    fi
    M_FLAGS=""; M_MISSING=""
    for M_VAR in $M_ENV; do
      M_VAL="$(eval "printf %s \"\${$M_VAR:-}\"")"
      if [ -n "$M_VAL" ]; then
        M_FLAGS="$M_FLAGS --env $M_VAR=$M_VAL"
      else
        M_MISSING="$M_MISSING $M_VAR"
      fi
    done
    if [ -n "$M_MISSING" ]; then
      warn "$M_NAME skipped, needs:$M_MISSING"
      continue
    fi
    # shellcheck disable=SC2086  # both are deliberate argument lists
    if claude mcp add "$M_NAME" --scope user $M_FLAGS -- "$M_CMD" $M_ARGS &>/dev/null; then
      log "$M_NAME registered"
    else
      warn "could not register $M_NAME"
    fi
  done <<'KEYED_MCP'
exa|npx|-y exa-mcp-server|EXA_API_KEY
tavily|npx|-y tavily-mcp|TAVILY_API_KEY
firecrawl|npx|-y firecrawl-mcp|FIRECRAWL_API_KEY
elevenlabs|uvx|elevenlabs-mcp|ELEVENLABS_API_KEY
browserbase|npx|-y @browserbasehq/mcp|BROWSERBASE_API_KEY BROWSERBASE_PROJECT_ID
magic|npx|-y @21st-dev/magic|TWENTY_FIRST_API_KEY
KEYED_MCP

  log "MCP servers done. Anything skipped: export its key and re-run"
  log "  ./setup.sh --only plugins"
fi
# END GENERATED: extensions
fi
if should_run plugins; then
  # The full catalog (config/mcp/catalog.json) is opt-in: every server costs
  # context in every session, and a sign-in needs a person at a browser.
  log "More MCP servers (Figma, Notion, Linear, GitHub, Stripe and 50 more):"
  log "  chewbacca mcp            then  chewbacca mcp add <name>"
fi

# ── macOS tools ───────────────────────────────────────────────────────────────
if should_run tools; then
# Screen control, Google Workspace, summarization, clipboard history, and the
# agent-scripts skill pack. Everything here is optional: a failure warns and the
# install continues.
section "Installing macOS tools"

# BEGIN GENERATED: cli
# Kit-owned helpers that sit in front of the installed tools.
#   peekaboo: forces local execution, see docs/reference/MACOS-TOOLS.md
#   chrome-js: reads and clicks a Chrome tab through JavaScript
mkdir -p "$HOME/.local/bin"
for HELPER in peekaboo chrome-js slop-check; do
  if [ -f "$SCRIPT_DIR/bin/$HELPER" ]; then
    link_tool "$HELPER"
    log "$HELPER installed to ~/.local/bin/"
  fi
done

# macOS command-line tools. Skipped without Homebrew, and skipped one by
# one if already present, so this is safe to re-run.
if command -v brew &>/dev/null; then
  if command -v Anki &>/dev/null; then
    log "Anki already installed"
  else
    brew install --cask anki &>/dev/null && log "Anki installed" || warn "could not install Anki"
  fi
  if command -v bd &>/dev/null; then
    log "bd already installed"
  else
    brew install beads &>/dev/null && log "bd installed" || warn "could not install bd"
  fi
  if [ -d "/Applications/Maccy.app" ]; then
    log "Maccy already installed"
  else
    brew install --cask maccy &>/dev/null && log "Maccy installed" || warn "could not install Maccy"
  fi
  if [ -x /opt/homebrew/bin/peekaboo ]; then
    log "peekaboo already installed"
  else
    brew install steipete/tap/peekaboo &>/dev/null && log "peekaboo installed" || warn "could not install peekaboo"
  fi
  if command -v summarize &>/dev/null; then
    log "summarize already installed"
  else
    brew install steipete/tap/summarize &>/dev/null && log "summarize installed" || warn "could not install summarize"
  fi
  # Messages from other apps land in the same people store as iMessage.
  # wacrawl copies WhatsApp Desktop's database, wacli is a linked WhatsApp
  # device (linked with `chewbacca whatsapp link`), slacrawl copies the Slack
  # desktop app's cache. Nobody types these: `people texts sync` drives them.
  for _wa in wacrawl wacli slacrawl; do
    if command -v "$_wa" &>/dev/null; then
      log "$_wa already installed"
    else
      brew install "openclaw/tap/$_wa" &>/dev/null && log "$_wa installed" || warn "could not install $_wa"
    fi
  done
  if command -v slacrawl &>/dev/null && [ ! -f "$HOME/.slacrawl/config.toml" ]; then
    slacrawl init &>/dev/null && log "slacrawl initialised" || warn "could not initialise slacrawl"
  fi
  # Keep those copies fresh between sessions. Every ten minutes, because a
  # message that arrived an hour ago and is not in the store reads as "they
  # never wrote back". launchd hands children a PATH without Homebrew, which
  # silently broke the HUD once, so the plist carries its own. The log lives in
  # the user's own Library: a fixed name in shared /tmp can be pre-created as
  # a symlink by another account and redirect these writes.
  # Run it on the stable node copy, never through `env node`: launchd jobs
  # have no .app above them, so macOS asks on behalf of node itself, and
  # Homebrew node moved to a new Cellar path on its 26.9 upgrade, losing its
  # grant. On 2026-10-09 that put "node would like to access data from other
  # apps" on screen every ten minutes. One Full Disk Access grant on the
  # copy covers this job across node upgrades.
  #
  # All three jobs below are services of chewbacca-daemon, the one Login Items
  # row Chewbacca has. Each used to be its own LaunchAgent, and Login Items
  # listed them as node, python3 and kyber-sessions. Caleb, 2026-10-11: "Chewb
  # should aim to be only 1 thing ... Most ppl will get weirded out".
  _mr_node=$("$SCRIPT_DIR/bin/chewbacca-node" 2>/dev/null || command -v node)
  _daemon() { "$_mr_node" "$SCRIPT_DIR/bin/chewbacca-daemon" "$@" >/dev/null; }
  # Services run the kit runtime (origin/main), never this checkout: a shared
  # checkout drifts behind under other tabs' edits, and on 2026-10-11 jobs ran
  # from one 87 commits behind main (docs/plans/one-supervisor.md, step 2).
  # Each run resolves kit/current afresh, and the daemon restarts on a kit move.
  _svc_root="$SCRIPT_DIR"
  [ -z "${CHEWBACCA_SUITE:-}" ] && [ -f "$HOME/.chewbacca/kit/current/bin/chewbacca-jobs" ] && _svc_root="$HOME/.chewbacca/kit/current"
  _daemon register messages-refresh --every 600 -- "$_mr_node" "$_svc_root/bin/people" texts refresh &&
    log "message refresh scheduled every 10 min" || warn "could not schedule the message refresh"

  # The machine queue's heartbeat: every 30 s `chewbacca jobs tick` admits queued work
  # when there's room, pauses heavy work when the Mac is busy, and resumes it
  # after. 2026-10-10: every tab ran its own long jobs with no shared budget,
  # the Mac swapped at load 80+, and Caleb had to force-quit Claude.
  _daemon register jobs --every 30 -- /usr/bin/python3 "$_svc_root/bin/chewbacca-jobs" tick &&
    log "machine job queue ticking every 30 s" || warn "could not schedule the job queue"

  # Orphan sweep every 5 minutes, plus an Ollama unload once swap passes 80%.
  # 2026-10-19: three tabs crawled at load 110 with swap 87% full, from twelve
  # test servers orphaned for 14 hours and 1.7 GB of idle embedding models. The
  # SessionStart hook alone never fired, because the tabs stayed open all day.
  # --min-age spares a live tab's own detached job: on a timer, ppid 1 alone
  # doesn't prove its tab is gone.
  _daemon register orphan-reap --every 300 --nice 10 -- /usr/bin/python3 "$_svc_root/bin/orphan-reap" --kill --pressure --min-age 7200 &&
    log "orphan sweep every 5 minutes" || warn "could not schedule the orphan sweep"

  # Agent alerts on the HUD: once a minute `kyber-sessions watch` toasts a tab
  # that newly waits on a permission, a run started from the glass that
  # finished, and a tab that died on a usage limit. 2026-10-10: two Desktop
  # tabs died at 2:47pm and Caleb found out an hour later from the sidebar,
  # and tab-rescue's hook only speaks when he types in some other tab, which
  # never happens when he works from the HUD.
  # Stock /usr/bin/python3, never the shebang's Homebrew 3.14: on 2026-10-11 at
  # 16:57 a run segfaulted inside 3.14's garbage collector, and as a child of the
  # Chewbacca runtime the crash put "Python quit unexpectedly" on Caleb's screen.
  _daemon register agent-watch --every 60 --nice 10 -- /usr/bin/python3 "$HOME/.local/bin/kyber-sessions" watch &&
    log "agent alerts on the HUD every minute" || warn "could not schedule agent alerts"

  # The weekly guard false-positive report (reengineer-flat-plan step 7). The
  # daemon has no weekday schedule, so it runs daily at 9 and the report acts on
  # Sundays, or on the first run a week after the last one: it ranks guards by
  # refusals the agent overrode or reran, writes ~/.chewbacca/reports/guard-fp/,
  # and files the top offender as a work-ledger task for that week.
  _daemon register guard-fp --at 09:00 --nice 10 -- /usr/bin/python3 "$_svc_root/tools/hookd_replay.py" fp --weekly &&
    log "guard false-positive report scheduled for Sundays" || warn "could not schedule the guard false-positive report"

  # The recall gate (reengineer-flat-plan step 14): once a day the shipped
  # retriever answers the sealed set, and the memory indexes stop loading whole
  # only while its recall@5 holds at the 55.4% the trade was judged on. The
  # next session start applies the answer (kit-autopull, tools/recall_gate.py).
  _daemon register recall-gate --at 06:30 --nice 10 -- /usr/bin/python3 "$_svc_root/tools/recall_gate.py" check &&
    log "recall gate checked daily" || warn "could not schedule the recall gate"

  # What got used (reinvent plan, phase 0): once a day the verdict log folds
  # into ~/.chewbacca/state/usage before lib.sh deletes parts older than eight
  # days, and on Sundays (or a week after the last one) the 30-day report lands
  # in ~/.chewbacca/reports/usage/. Without the daily fold, hook runs older than
  # eight days are gone, and the log only began on 2026-10-12.
  _daemon register usage --at 05:40 --nice 15 -- /usr/bin/python3 "$_svc_root/tools/usage_report.py" --daily &&
    log "usage report folded daily, written weekly" || warn "could not schedule the usage report"

  # A verse on the HUD every fifteen minutes that stays until he closes it.
  # Caleb, 2026-10-16: "Add hourly verses to the hud popping up", then "Make
  # them stay until I x them out, also make it every 15 min". hud-verse itself
  # stays quiet from 2am to 8am, and each run replaces the card in place.
  _daemon register verse --every 900 --nice 10 -- /usr/bin/python3 "$_svc_root/bin/hud-verse" &&
    log "a verse on the HUD every 15 min" || warn "could not schedule the verse"

  # An Electron app whose page crashed keeps its window up, blank or frozen,
  # and never recovers. 2026-10-26: Granola went blank and Slack froze in the
  # same minute after days of uptime; both needed a kill and a relaunch.
  # app-revive checks every minute and restarts one seen dead twice in a row.
  _daemon register app-revive --every 60 --nice 10 -- /usr/bin/python3 "$_svc_root/bin/app-revive" --fix &&
    log "blank app windows restart themselves" || warn "could not schedule app-revive"

  # Install the one LaunchAgent last, and fold in any per-job agent an older
  # install left behind, so Login Items ends with a single Chewbacca row.
  "$_mr_node" "$SCRIPT_DIR/bin/chewbacca-daemon" install 2>&1 | while IFS= read -r _line; do log "$_line"; done
else
  warn "Homebrew not found. macOS tools skipped: see docs/reference/MACOS-TOOLS.md"
fi

# cap: Screen recording with spring-physics zoom that follows your clicks, scriptable with --json on every command
if [ "$(uname -s)" != "Darwin" ]; then
  :
elif ! command -v brew &>/dev/null; then
  warn "Homebrew not found, skipping Cap"
else
  if [ -d /Applications/Cap.app ]; then
    log "Cap already installed"
  elif brew install --cask cap &>/dev/null; then
    log "Cap installed"
  else
    warn "could not install Cap"
  fi
  CAP_CLI=/Applications/Cap.app/Contents/MacOS/cap-cli
  if [ -x "$CAP_CLI" ]; then
    if command -v cap &>/dev/null; then
      log "cap shim already on PATH"
    elif "$CAP_CLI" desktop install-cli &>/dev/null; then
      log "cap shim installed to ~/.local/bin"
    else
      warn "could not install the cap shim"
    fi
    # skill, not all: `all` would also register the cloud-only MCP server
    # described above. This installs Cap's own routing skill plus the
    # cap-demo skill, both of which drive the local CLI.
    if [ -d "$HOME/.claude/skills/cap" ]; then
      log "Cap Claude integration already installed"
    elif "$CAP_CLI" agents install --target claude --component skill --yes &>/dev/null; then
      log "Cap skills and MCP registered for Claude"
    else
      warn "could not install the Cap Claude integration"
    fi
  fi
fi

# mac: Calendar, Reminders, Contacts, Mail, Messages, Notes, and Finder as JSON
if [ "$(uname -s)" != "Darwin" ]; then
  :
elif command -v mac &>/dev/null; then
  log "mac-cli already installed"
elif ! command -v swift &>/dev/null; then
  warn "swift not found, skipping mac-cli. Run: xcode-select --install"
else
  MC_DIR="$HOME/Projects/mac-cli"
  [ -d "$MC_DIR/.git" ] || git clone -q --depth 1 \
    https://github.com/31Carlton7/mac-cli.git "$MC_DIR" 2>/dev/null || true
  if [ -d "$MC_DIR" ]; then
    # SwiftPM caches dependencies as bare repos, which a global
    # safe.bareRepository=explicit forbids it from reading. Override the
    # setting for this one build rather than changing it machine-wide.
    if (cd "$MC_DIR" && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.bareRepository \
        GIT_CONFIG_VALUE_0=all swift build -c release &>/dev/null); then
      mkdir -p "$HOME/.local/bin"
      install "$MC_DIR/.build/release/mac" "$HOME/.local/bin/mac"
      log "mac-cli installed. Run: mac doctor  (grants are per-terminal)"
    else
      warn "mac-cli build failed. Retry: cd $MC_DIR && swift build -c release"
    fi
  else
    warn "could not clone mac-cli"
  fi
fi

# mac-use: Natural-language agent that drives any Mac app through Accessibility
if command -v mac-use &>/dev/null; then
  log "mac-use already installed"
elif ! command -v uv &>/dev/null; then
  warn "uv not found, skipping macOS-use. Install uv, then re-run:"
  warn "  ./setup.sh --only tools"
else
  MU_DIR="$HOME/code/refs/macOS-use"
  [ -d "$MU_DIR/.git" ] || git clone -q --depth 1 \
    https://github.com/browser-use/macOS-use.git "$MU_DIR" 2>/dev/null || true
  if [ -d "$MU_DIR" ]; then
    # macOS-use supplies the runtime and the venv; Chewbacca owns the
    # provider adapters and reads them out of its own bin/ via the
    # resolved symlink. The two copies that used to land in $MU_DIR were
    # writes into somebody else's checkout that nothing ever read, and
    # they overwrote any local work there. link_tool, not cp: bin/mac-use
    # walks its own symlink back to find the adapters, so a plain copy
    # points it at the wrong tree.
    link_tool mac-use
    if (cd "$MU_DIR" && uv venv --python 3.11 &>/dev/null \
        && uv pip install --python .venv/bin/python --editable . &>/dev/null); then
      log "mac-use installed"
    else
      warn "macOS-use deps failed. Retry: cd $MU_DIR && uv pip install -e ."
    fi
  else
    warn "could not clone macOS-use"
  fi
fi

# yt-transcript: Transcript of any YouTube video, channel, or playlist, read without asking
if command -v yt-transcript &>/dev/null; then
  log "yt-transcript already installed"
else
  YT_DIR="$(mktemp -d)"
  if git clone -q --depth 1 https://github.com/calebnewtonusc/claude-youtube-transcripts \
      "$YT_DIR" 2>/dev/null && [ -x "$YT_DIR/install.sh" ]; then
    if (cd "$YT_DIR" && ./install.sh &>/dev/null); then
      log "yt-transcript installed"
    else
      warn "youtube-transcripts installer failed. Run it by hand: $YT_DIR/install.sh"
    fi
  else
    warn "could not clone claude-youtube-transcripts"
  fi
  rm -rf "$YT_DIR"
fi

# peekaboo speaks MCP too. Registered at user scope so it is available in
# every project, not just this one.
if ! command -v claude &>/dev/null; then
  warn "claude CLI missing, so the peekaboo MCP server was not registered"
elif command -v peekaboo &>/dev/null; then
  if claude mcp list 2>/dev/null | grep -q "^peekaboo:"; then
    log "peekaboo MCP already registered"
  elif claude mcp add peekaboo --scope user -- peekaboo mcp serve &>/dev/null; then
    log "peekaboo MCP registered"
  else
    warn "could not register the peekaboo MCP server"
  fi
fi

# Skill pack: agent-scripts. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# Its own installer (scripts/sync-skills) repoints ~/.claude/CLAUDE.md at the
# pack's AGENTS.MD, which would replace your global instructions. Do not run
# it. The loop below does the linking and touches nothing else.
PACK_DIR="$HOME/code/refs/agent-scripts"
PACK_SKIP="codex-first frontend-design"
if [ -d "$PACK_DIR/.git" ]; then
  log "agent-scripts already cloned, left alone"
elif git clone -q --depth 1 "https://github.com/steipete/agent-scripts.git" "$PACK_DIR" 2>/dev/null; then
  log "agent-scripts cloned"
else
  warn "could not clone agent-scripts"
fi
if [ -d "$PACK_DIR/skills" ]; then
  PACK_N=0
  for SK in "$PACK_DIR"/skills/*/; do
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done
  log "agent-scripts: $PACK_N skills linked"
fi

# Skill pack: gtm-engineer-skills. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# Sent by Caleb 2026-09-23. MIT. Its scripts read SERPAPI_KEY from the
# environment when set, and fetch only Google autocomplete, SerpAPI and
# the site being audited.
PACK_DIR="$HOME/Projects/gtm-engineer-skills"
PACK_SKIP=""
if [ -d "$PACK_DIR/.git" ]; then
  log "gtm-engineer-skills already cloned, left alone"
elif git clone -q --depth 1 "https://github.com/onvoyage-ai/gtm-engineer-skills.git" "$PACK_DIR" 2>/dev/null; then
  log "gtm-engineer-skills cloned"
else
  warn "could not clone gtm-engineer-skills"
fi
if [ -d "$PACK_DIR/." ]; then
  PACK_N=0
  for SK in "$PACK_DIR"/./*/; do
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done
  log "gtm-engineer-skills: $PACK_N skills linked"
fi

# Skill pack: marketingskills. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# MIT. Markdown and JSON only, no scripts. Found through Open Design's
# catalogue (nexu-io/open-design), which points at it rather than copying it.
PACK_DIR="$HOME/Projects/marketingskills"
PACK_SKIP=""
PACK_ONLY="cold-email copywriting marketing-psychology offers pricing social"
if [ -d "$PACK_DIR/.git" ]; then
  log "marketingskills already cloned, left alone"
elif git clone -q --depth 1 "https://github.com/coreyhaines31/marketingskills.git" "$PACK_DIR" 2>/dev/null; then
  log "marketingskills cloned"
else
  warn "could not clone marketingskills"
fi
if [ -d "$PACK_DIR/skills" ]; then
  PACK_N=0
  for SK in "$PACK_DIR"/skills/*/; do
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    case " $PACK_ONLY " in *" $SK_NAME "*) ;; *) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done
  log "marketingskills: $PACK_N skills linked"
fi

# Skill pack: coldoutboundskills. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# MIT. 26 of 52 linked. Left out: cold-email-starter-kit, auto-research-public,
# zapmail-domain-setup-public and inbox-lifecycle-manager, which buy domains
# or inboxes or can start sending, and list-builder, which clashes by name.
# The shallow clone is about 1 GB (measured 2026-10-09), so it takes minutes.
PACK_DIR="$HOME/Projects/coldoutboundskills"
PACK_SKIP=""
PACK_ONLY="campaign-copywriting experiment-design spam-word-checker smartlead-spintax deliverability-incident-response cold-email-weekly-rhythm list-quality-scorecard icp-prompt-builder lead-magnet-brainstorm campaign-strategy personalization-subagent-pattern positive-reply-scoring deliverability-test-public smartlead-campaign-upload-public clay-playbooks playbook-first-name-cleaning playbook-company-name-cleaning playbook-ai-specificity playbook-creative-ideas playbook-case-study-page playbook-hiring-surge playbook-new-in-role playbook-fundraising playbook-warm-intros playbook-lookalikes perfect-company-list"
if [ -d "$PACK_DIR/.git" ]; then
  if [ "$(git -C "$PACK_DIR" rev-parse HEAD 2>/dev/null)" = "25c5d85fbb5dd3efec97b0ca457cbbc286547476" ]; then
    log "coldoutboundskills already at the vetted commit"
  else
    warn "coldoutboundskills is not at the vetted commit 25c5d85fbb5d, left alone"
  fi
elif git init -q "$PACK_DIR" \
  && git -C "$PACK_DIR" fetch -q --depth 1 "https://github.com/growthenginenowoslawski/coldoutboundskills.git" 25c5d85fbb5dd3efec97b0ca457cbbc286547476 2>/dev/null \
  && git -C "$PACK_DIR" checkout -q FETCH_HEAD 2>/dev/null; then
  log "coldoutboundskills fetched at 25c5d85fbb5d"
else
  warn "could not fetch coldoutboundskills at 25c5d85fbb5d"
fi
if [ -d "$PACK_DIR/skills" ]; then
  PACK_N=0
  while IFS= read -r SKF; do
    SK="$(dirname "$SKF")/"
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    case " $PACK_ONLY " in *" $SK_NAME "*) ;; *) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done < <(find "$PACK_DIR/skills" -mindepth 2 -maxdepth 3 -name SKILL.md | sort)
  log "coldoutboundskills: $PACK_N skills linked"
fi

# Skill pack: explorium-gtm-skills. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# MIT. 8 of 17 linked, the ones that preview before spending credits.
# Left out: abm-diy-campaign (starts LinkedIn Ads spend) and the two app
# scaffolds that write to HubSpot and Salesforce.
PACK_DIR="$HOME/Projects/explorium-gtm-skills"
PACK_SKIP=""
PACK_ONLY="account-research meeting-prep decision-makers-map account-fit-rank score-leads clean-data market-sizing personalize-email"
if [ -d "$PACK_DIR/.git" ]; then
  if [ "$(git -C "$PACK_DIR" rev-parse HEAD 2>/dev/null)" = "f0efa6beb697a5b17a3cb7851a7e9cccac57de99" ]; then
    log "explorium-gtm-skills already at the vetted commit"
  else
    warn "explorium-gtm-skills is not at the vetted commit f0efa6beb697, left alone"
  fi
elif git init -q "$PACK_DIR" \
  && git -C "$PACK_DIR" fetch -q --depth 1 "https://github.com/explorium-ai/gtm-skills.git" f0efa6beb697a5b17a3cb7851a7e9cccac57de99 2>/dev/null \
  && git -C "$PACK_DIR" checkout -q FETCH_HEAD 2>/dev/null; then
  log "explorium-gtm-skills fetched at f0efa6beb697"
else
  warn "could not fetch explorium-gtm-skills at f0efa6beb697"
fi
if [ -d "$PACK_DIR/skills" ]; then
  PACK_N=0
  for SK in "$PACK_DIR"/skills/*/; do
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    case " $PACK_ONLY " in *" $SK_NAME "*) ;; *) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done
  log "explorium-gtm-skills: $PACK_N skills linked"
fi

# Skill pack: unify-agent-plugins. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# MIT. Needs a Unify account to do anything. Left out: outreach, which
# adds prospects to sequences that send, and crm, which writes to
# Salesforce and HubSpot.
PACK_DIR="$HOME/Projects/unify-agent-plugins"
PACK_SKIP=""
PACK_ONLY="unify agent-runs discovery enrichment data-tables"
if [ -d "$PACK_DIR/.git" ]; then
  if [ "$(git -C "$PACK_DIR" rev-parse HEAD 2>/dev/null)" = "2ec253a6e67bcf6346d1949432dd68bde46e7cb2" ]; then
    log "unify-agent-plugins already at the vetted commit"
  else
    warn "unify-agent-plugins is not at the vetted commit 2ec253a6e67b, left alone"
  fi
elif git init -q "$PACK_DIR" \
  && git -C "$PACK_DIR" fetch -q --depth 1 "https://github.com/unifygtm/agent-plugins.git" 2ec253a6e67bcf6346d1949432dd68bde46e7cb2 2>/dev/null \
  && git -C "$PACK_DIR" checkout -q FETCH_HEAD 2>/dev/null; then
  log "unify-agent-plugins fetched at 2ec253a6e67b"
else
  warn "could not fetch unify-agent-plugins at 2ec253a6e67b"
fi
if [ -d "$PACK_DIR/unify/skills" ]; then
  PACK_N=0
  for SK in "$PACK_DIR"/unify/skills/*/; do
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    case " $PACK_ONLY " in *" $SK_NAME "*) ;; *) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done
  log "unify-agent-plugins: $PACK_N skills linked"
fi

# Skill pack: goose-skills. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# MIT. 6 of 295 linked. 116 of the rest spend GooseWorks credits, about 30
# spend Apify credits, one sends SMS, and watch and skill-creator collide
# with skills already here.
PACK_DIR="$HOME/Projects/goose-skills"
PACK_SKIP=""
PACK_ONLY="email-drafting sequence-performance disqualification-handling battlecard-generator messaging-ab-tester inbound-lead-qualification"
if [ -d "$PACK_DIR/.git" ]; then
  if [ "$(git -C "$PACK_DIR" rev-parse HEAD 2>/dev/null)" = "c650c6d4156af77ef2ef6bb3fffcea104c653df8" ]; then
    log "goose-skills already at the vetted commit"
  else
    warn "goose-skills is not at the vetted commit c650c6d4156a, left alone"
  fi
elif git init -q "$PACK_DIR" \
  && git -C "$PACK_DIR" fetch -q --depth 1 "https://github.com/gooseworks-ai/goose-skills.git" c650c6d4156af77ef2ef6bb3fffcea104c653df8 2>/dev/null \
  && git -C "$PACK_DIR" checkout -q FETCH_HEAD 2>/dev/null; then
  log "goose-skills fetched at c650c6d4156a"
else
  warn "could not fetch goose-skills at c650c6d4156a"
fi
if [ -d "$PACK_DIR/skills" ]; then
  PACK_N=0
  while IFS= read -r SKF; do
    SK="$(dirname "$SKF")/"
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    case " $PACK_ONLY " in *" $SK_NAME "*) ;; *) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done < <(find "$PACK_DIR/skills" -mindepth 2 -maxdepth 4 -name SKILL.md | sort)
  log "goose-skills: $PACK_N skills linked"
fi

# Skill pack: typesafe-skills. Linked per skill, not copied, so `git pull` in
# the clone updates every skill at once.
#
# MIT. Upstream guide to the API that chewbacca jev calls.
PACK_DIR="$HOME/Projects/typesafe-skills"
PACK_SKIP=""
PACK_ONLY="typesafe-ai"
if [ -d "$PACK_DIR/.git" ]; then
  if [ "$(git -C "$PACK_DIR" rev-parse HEAD 2>/dev/null)" = "65a39f393687675ce170e6094757de20370365b9" ]; then
    log "typesafe-skills already at the vetted commit"
  else
    warn "typesafe-skills is not at the vetted commit 65a39f393687, left alone"
  fi
elif git init -q "$PACK_DIR" \
  && git -C "$PACK_DIR" fetch -q --depth 1 "https://github.com/typesafe-ai/skills.git" 65a39f393687675ce170e6094757de20370365b9 2>/dev/null \
  && git -C "$PACK_DIR" checkout -q FETCH_HEAD 2>/dev/null; then
  log "typesafe-skills fetched at 65a39f393687"
else
  warn "could not fetch typesafe-skills at 65a39f393687"
fi
if [ -d "$PACK_DIR/skills" ]; then
  PACK_N=0
  for SK in "$PACK_DIR"/skills/*/; do
    SK_NAME="$(basename "$SK")"
    [ -f "$SK/SKILL.md" ] || continue
    case " $PACK_SKIP " in *" $SK_NAME "*) continue;; esac
    case " $PACK_ONLY " in *" $SK_NAME "*) ;; *) continue;; esac
    [ -e "$GLOBAL_CLAUDE/skills/$SK_NAME" ] && continue
    ln -s "$SK" "$GLOBAL_CLAUDE/skills/$SK_NAME"
    PACK_N=$((PACK_N+1))
  done
  log "typesafe-skills: $PACK_N skills linked"
fi
# END GENERATED: cli
fi

# Full control of the Mac, absorbed from calebnewtonusc/Nova. peekaboo and
# mac-use were already here and are two of the seven layers this knows about.
# This is the other five, plus the runtime that plans, executes, verifies and
# logs a multi-step task instead of improvising bash through it.
# ── Mac control ───────────────────────────────────────────────────────────────
if should_run mac; then
section "Installing Mac control"

MAC_SRC="$SCRIPT_DIR/mac"
if [ ! -d "$MAC_SRC" ]; then
  warn "mac/ not found in this checkout, skipping"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$MAC_SRC/bin/chewie" "$HOME/.local/bin/chewie"
  chmod +x "$MAC_SRC/bin/chewie" 2>/dev/null || true
  log "chewie installed to ~/.local/bin/chewie"

  # Layer 3 is the accessibility-tree driver and it is the one worth having.
  # Everything below degrades to a screenshot without it.
  if command -v npm &>/dev/null; then
    if command -v agent-desktop &>/dev/null; then
      log "agent-desktop already installed"
    elif npm install -g agent-desktop &>/dev/null; then
      log "agent-desktop installed (accessibility driver)"
    else
      warn "could not install agent-desktop: npm install -g agent-desktop"
    fi
    # Layer 6, the Chrome DevTools bridge. Only when it has not been built yet.
    if [ -d "$MAC_SRC/bridge" ] && [ ! -d "$MAC_SRC/bridge/node_modules" ]; then
      (cd "$MAC_SRC/bridge" && npm install --silent &>/dev/null) \
        && log "web bridge ready" || warn "web bridge deps failed, nova web will not work"
    fi
  else
    warn "npm missing, so the accessibility driver and web bridge are skipped"
  fi

  # site-fast: browser-use's jev-ultrafast agent, one Jev call per step. It
  # lives outside the repo because it pins its own Python environment.
  SITE_FAST_HOME="${SITE_FAST_HOME:-$HOME/dev/jev-ultrafast}"
  if command -v uv &>/dev/null; then
    if [ ! -d "$SITE_FAST_HOME/.git" ]; then
      git clone --quiet https://github.com/browser-use/jev-ultrafast "$SITE_FAST_HOME" \
        || warn "could not clone jev-ultrafast, so site-fast will not run"
    fi
    [ -d "$SITE_FAST_HOME/.git" ] && (cd "$SITE_FAST_HOME" && uv sync --quiet &>/dev/null) \
      && log "site-fast ready (jev-ultrafast in $SITE_FAST_HOME)"
  else
    warn "uv missing, so site-fast is skipped"
  fi


  # Accessibility and Screen Recording cannot be granted by any script. tccutil
  # can remove a grant and never add one, and only an MDM profile can pre-grant.
  # So this is a real handoff, not a checklist to feel bad about.
  warn "Two toggles need a human, once: System Settings > Privacy & Security >"
  warn "  Accessibility, and Screen Recording. Add whichever app runs Claude."
  warn "  Run 'chewie doctor' and it names the exact app and what is still missing."
fi
fi

# ── Plynn ─────────────────────────────────────────────────────────────────────
if should_run plynn; then
# On-device dictation by Carlton Aikins (github.com/31Carlton7/plynn, MIT).
# Hold fn, talk, release, and clean text lands wherever the cursor is. Speech
# recognition and cleanup both run on the Mac, nothing is uploaded.
#
# Deliberately outside the GENERATED regions above: this is a hand-written step
# and d1-inventory.py would overwrite it.
section "Installing Plynn (on-device dictation)"

if [ -x "$SCRIPT_DIR/bin/install-plynn.sh" ]; then
  "$SCRIPT_DIR/bin/install-plynn.sh" || warn "Plynn install returned non-zero, continuing"
else
  warn "bin/install-plynn.sh missing, skipping Plynn"
fi
fi

# ── Kit runtime timer ─────────────────────────────────────────────────────────
if should_run tools; then
# Keeps ~/.chewbacca/kit/current on origin/main between sessions, every 15
# minutes, from the runtime's own copy of kit_runtime.py. Last, so its first
# run (RunAtLoad) links the node_modules and builds the steps above produced.
if [ "${CHEWBACCA_NO_RUNTIME:-0}" != 1 ] && [ "$(uname -s)" = Darwin ] &&
   [ -f "$KIT_RUNTIME/current/tools/kit_runtime.py" ]; then
  log "$(python3 -I "$KIT_RUNTIME/current/tools/kit_runtime.py" install-timer \
          --repo "$SCRIPT_DIR" --link-bin "$HOME/.local/bin" 2>&1)"
fi
fi

# ── Verify ────────────────────────────────────────────────────────────────────
if should_run verify; then
# Claiming success without checking is how this kit shipped six months of
# silently broken hooks. Prove the install works before saying it worked.
section "Verifying the install"

if [ -x "$SCRIPT_DIR/doctor.sh" ]; then
  if "$SCRIPT_DIR/doctor.sh"; then
    log "All checks passed"
  elif [ "$FAST" -eq 1 ] || [ "$ONLY_PORTABLE" -eq 1 ] || [ -n "$SKIP_SECTIONS" ]; then
    # An install that left whole sections out on purpose is supposed to fail
    # the checks for those sections. Ending a successful install on "some
    # checks failed" tells the person their new tool is broken when it is
    # doing exactly what they asked, which is the single worst sentence to end
    # an install on. Portable skips nearly everything by design and hit this
    # too.
    log "Checks for the sections this install skipped did not pass, as expected."
    log "  Install the rest with: chewbacca setup"
  else
    warn "Some checks failed. Fix them, then re-run: ./doctor.sh"
  fi
else
  warn "doctor.sh not found or not executable, skipping verification"
fi
fi

# ── Manifest ──────────────────────────────────────────────────────────────────
if should_run manifest; then
# Nothing recorded what setup did, so uninstall was guessing and nobody could
# answer "what version is on this machine". Both are one file.
section "Recording what this install did"

STATE_DIR="$HOME/.chewbacca"
mkdir -p "$STATE_DIR"
cp "$SCRIPT_DIR/VERSION" "$STATE_DIR/version" 2>/dev/null || echo "unknown" > "$STATE_DIR/version"

MANIFEST="$STATE_DIR/install-manifest.json"
python3 - "$MANIFEST" "$GLOBAL_CLAUDE" "$SCRIPT_DIR" "$PROFILE" <<'PYEOF'
import json, os, subprocess, sys
from datetime import datetime, timezone
manifest, claude_dir, repo, profile = sys.argv[1:5]

def listing(sub, pattern=""):
    d = os.path.join(claude_dir, sub)
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        out.append({
            "name": name,
            "path": p,
            "symlink": os.path.islink(p),
            "target": os.readlink(p) if os.path.islink(p) else None,
        })
    return out

def commit():
    try:
        return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""

bins = []
local_bin = os.path.expanduser("~/.local/bin")
if os.path.isdir(local_bin):
    for name in sorted(os.listdir(local_bin)):
        p = os.path.join(local_bin, name)
        if os.path.islink(p) and repo in os.path.realpath(p):
            bins.append({"name": name, "path": p, "target": os.path.realpath(p)})

data = {
    "installed": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "version": open(os.path.join(repo, "VERSION")).read().strip()
               if os.path.isfile(os.path.join(repo, "VERSION")) else "unknown",
    "commit": commit(),
    "repo": repo,
    "profile": profile,
    "host": os.uname().nodename,
    "wrote": {
        "skills": listing("skills"),
        "commands": listing("commands"),
        "rules": listing("rules"),
        "hooks": listing("hooks"),
        "agents": listing("agents"),
        "output-styles": listing("output-styles"),
        "bin": bins,
    },
    "note": "Written by setup.sh. uninstall.sh removes exactly what is listed here.",
}
with open(manifest, "w") as f:
    json.dump(data, f, indent=2)
counts = {k: len(v) for k, v in data["wrote"].items()}
print("  manifest: " + ", ".join(f"{v} {k}" for k, v in counts.items() if v))
PYEOF
log "install manifest written to $MANIFEST"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
sep
echo -e "  ${BLD}${GRN}Setup complete.${NC}"
sep
echo ""
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo -e "  ${BLD}Not run this time:${NC}"
  for s in "${SKIPPED[@]}"; do echo "    $s"; done
  echo -e "  ${YLW}Run them later with:${NC} chewbacca setup --only <section>"
  echo ""
fi
# What someone should read at the end depends entirely on who they are. Two
# repo URLs that do not exist and three slash commands are the wrong closing
# screen for a person who came here to ask about their calendar.
if [ "$NO_GITHUB" -eq 1 ]; then
  echo -e "  ${BLD}Your second brain:${NC}"
  echo "    ${PC_DIR:-$WORKSPACE_DIR}"
  echo "    A folder on this Mac. Claude reads it and writes to it as you talk."
  echo ""
  echo -e "  ${BLD}Claude can now:${NC}"
  echo "    read your calendar and contacts, send a text, see your screen,"
  echo "    summarize a video or article, and remember what matters to you"
  echo ""
  echo -e "  ${BLD}Try asking it:${NC}"
  echo "    \"what's on my calendar tomorrow\""
  echo "    \"text someone that I'm running late\""
else
  echo -e "  ${BLD}Repos created:${NC}"
  echo -e "    ${CYN}$PERSONAL_REPO${NC}     https://github.com/$GITHUB_USER/$PERSONAL_REPO"
  echo -e "    ${CYN}claude-context${NC}   https://github.com/$GITHUB_USER/claude-context"
  echo ""
  echo -e "  ${BLD}Wired:${NC}"
  echo "    ~/.claude/settings.json   hooks, env vars, permissions"
  if [ -n "$COMPOSIO_URL" ]; then
    echo "    .mcp.json                 Composio (100+ tools)"
  else
    echo "    .mcp.json                 (add Composio URL later for 100+ integrations)"
  fi
  echo ""
  echo -e "  ${BLD}Next steps:${NC}"
  echo "    1. Fill in the rest of $PC_DIR/NOW.md, PEOPLE.md, SYSTEM.md"
  echo "    2. Open a new Claude Code session, your context loads automatically"
  echo "    3. Try: /sprint, /daily-brief, /inbox"
  if [ -z "$COMPOSIO_URL" ]; then
    echo ""
    echo "    To add Composio (GitHub, Gmail, Calendar, Todoist, Vercel):"
    echo "    → Sign up at composio.dev, get your MCP URL"
    echo "    → Add to ~/.claude/.mcp.json under mcpServers.composio"
  fi
fi

# How to undo this, said before anyone has to ask.
#
# Not a `# ── ─` section header: this is part of the closing summary and
# runs with it. check_sections.py reads that header style as a new section
# needing a should_run guard, and on 2026-09-21 this block was written with
# one and failed the suite.
#
# THE FAILURE THIS EXISTS FOR, 2026-09-20. Sam installed the kit, a browser
# tab kept reopening, and he wrote: "this seems extremely dangerous to have on
# my computer. i don't even know how to remove this agent", then "seems like
# malware". The same afternoon, without having seen that, someone else said
# "make it clear it's not anything suspicious with the permissions stuff".
#
# Neither was a missing capability. uninstall.sh already existed, the manifest
# already recorded every path it wrote, and the dashboard popping the tab was
# fixed hours later. What was missing was saying any of it HERE, on the last
# screen a new person reads, at the moment they decide whether to trust this.
#
# The screen above this one lists what Claude can now read: the calendar, the
# contacts, the screen. Ending there, with no way back, is what reads as
# malware to a careful person, and a careful person is exactly the one worth
# keeping.
# REA is offered here and never installed: it's a fast-moving third-party pin
# with 170 tools, so adding it is the person's call. The offer only shows when
# it's absent and this Mac's Node can run it.
REA_LINE="$(python3 "$SCRIPT_DIR/tools/rea_kit.py" status --line 2>/dev/null)"
case "$REA_LINE" in
  "REA: not installed (optional; \`chewbacca rea install\`"*)
    echo ""
    echo -e "  ${BLD}Optional:${NC}"
    echo "    chewbacca rea install   adds REA, so agents can trace how another app or"
    echo "                            site does one thing; its own setup asks first"
    ;;
esac
echo ""
echo -e "  ${BLD}If you want it gone:${NC}"
echo "    chewbacca uninstall --dry-run   lists every path, changes nothing"
echo "    chewbacca uninstall             removes exactly that list"
echo ""
echo "    Every path this wrote is recorded in"
echo "    ~/.chewbacca/install-manifest.json, so removal reads that file"
echo "    instead of guessing."
echo ""
# Say what actually leaves the Mac, not what sounds reassuring. An earlier
# draft of this block said "this installer sends nothing anywhere", which is
# false: the GitHub path below creates two repos and pushes to them.
echo -e "  ${BLD}What leaves this Mac:${NC}"
echo "    $(bash "$SCRIPT_DIR/bin/lib/prompts-go-to.sh")"
if [ "$NO_GITHUB" -eq 1 ]; then
  echo "    Your second brain is a folder on this disk. Nothing here pushes it."
else
  echo "    Your second brain is pushed to two repos on your own GitHub account"
  echo "    ($GITHUB_USER), created above. Nowhere else."
fi
echo "    Nothing is encrypted at rest. Treat it like any folder on your Mac."
echo ""
sep
echo ""
