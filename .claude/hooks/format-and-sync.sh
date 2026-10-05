#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init format-and-sync.sh 20
# PostToolUse: format the file that was just written. Committing the context
# repos is brain-sync.sh's job, once per turn, at Stop.
#
# Why this is a script and not an inline settings.json command:
#
#   1. Hooks do not inherit an nvm-managed PATH. Prettier's shebang is
#      `#!/usr/bin/env node`, so with nvm the hook cannot find node and dies
#      silently at exit 0. You get no formatting and no error. This resolves
#      the node bin directory itself before calling out.
#
#   2. `npx prettier` re-resolves the package on every single file write, which
#      costs seconds per edit. A project-local or global binary is used first
#      and npx is the last resort.
#
# Config comes from ~/.claude/d1-config.sh, written by setup.sh.

set -uo pipefail

CONFIG="$HOME/.claude/d1-config.sh"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"

f="$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
[ -n "$f" ] || exit 0
[ -f "$f" ] || exit 0

# ── Make sure node is reachable ───────────────────────────────────────────────
ensure_node() {
  # On 2026-09-21 Homebrew's node existed but dyld aborted because its
  # llhttp library had moved. Presence did not mean it could run Prettier.
  (node --version) >/dev/null 2>&1 && return 0

  # nvm: prefer the aliased default, else the highest installed version.
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -d "$nvm_dir/versions/node" ]; then
    local alias_file="$nvm_dir/alias/default" target=""
    if [ -f "$alias_file" ]; then
      target="$(cat "$alias_file" 2>/dev/null)"
      [ -n "$target" ] && ("$nvm_dir/versions/node/$target/bin/node" --version) >/dev/null 2>&1 && {
        PATH="$nvm_dir/versions/node/$target/bin:$PATH"; export PATH; return 0
      }
    fi
    local newest
    newest="$(ls -1 "$nvm_dir/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "$newest" ] && ("$nvm_dir/versions/node/$newest/bin/node" --version) >/dev/null 2>&1 && {
      PATH="$nvm_dir/versions/node/$newest/bin:$PATH"; export PATH; return 0
    }
  fi

  local d
  for d in /opt/homebrew/bin /usr/local/bin /usr/bin; do
    if ("$d/node" --version) >/dev/null 2>&1; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  return 1
}

# ── Find prettier without paying npx resolution on every write ────────────────
find_prettier() {
  local dir
  dir="$(cd "$(dirname "$f")" 2>/dev/null && pwd)" || return 1
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -x "$dir/node_modules/.bin/prettier" ]; then
      printf '%s' "$dir/node_modules/.bin/prettier"; return 0
    fi
    dir="$(dirname "$dir")"
  done
  if command -v prettier >/dev/null 2>&1; then printf '%s' "prettier"; return 0; fi
  return 1
}

should_format() {
  # Prettier rewrites `@~/path` into `@~~/path` in markdown, which silently
  # breaks every CLAUDE.md import and makes the rules files load nothing. That
  # bug shipped once already and only a fresh-clone test caught it, because the
  # corrupted file still looks fine. Never format a file that declares imports.
  case "$(basename "$f")" in
    CLAUDE.md | CLAUDE-QUICK.md) return 1 ;;
  esac
  grep -q '^@[~./]' "$f" 2>/dev/null && return 1

  case "$f" in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.css | *.scss | *.html | *.md | *.yaml | *.yml)
      return 0
      ;;
  esac
  return 1
}

if should_format; then
  if ensure_node; then
    if PRETTIER="$(find_prettier)"; then
      if ! "$PRETTIER" --write "$f" --log-level silent; then
        echo "Prettier failed; the file was not verified as formatted." >&2
        exit 1
      fi
    fi
    # NO npx FALLBACK. Measured 2026-09-20: this hook runs in 260ms when
    # prettier resolves, and doctor caught a p95 of 4761ms on 1 run in 20.
    # The spike was `npx --yes prettier`, which re-resolves the package from
    # the registry on every write.
    #
    # Four seconds of latency on a tool call, to format a file, on a machine
    # where prettier is not installed, is a bad trade every single time. If
    # prettier is not present the file is left alone and `chewbacca doctor`
    # reports it. Skipping is cheap and visible; npx is expensive and silent.
  fi
fi

# ── Context repos ─────────────────────────────────────────────────────────────
# The commit and push that used to follow here moved to brain-sync.sh, a Stop
# hook, on 2026-10-05. One commit per write left 16 of the brain's last 40
# commits reading "chore: update <file>", and missed every Bash write. Now the
# turn's writes land as one commit named after the turn.

exit 0
