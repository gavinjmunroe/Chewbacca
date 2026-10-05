#!/usr/bin/env bash
# The install must not reach for Claude on a machine that already has an agent.
#
# On 2026-09-19 setup.sh installed Claude Code whenever `claude` was missing,
# and start.sh's last screen said "type claude" and then exec'd it. Sam runs
# Codex. The install finished, sent him to Claude Code, and Claude Code asked
# him to buy credits. He said "how is this model agnostic? i don't want to add
# claude credits" and stopped. A second tester said the same. Neither has
# onboarded since. That is the product claim breaking on the last screen.
set -uo pipefail
ROOT="${1:?path to repo root}"
FAKE="$(mktemp -d)"
printf '#!/bin/sh\necho codex\n' > "$FAKE/codex"; chmod +x "$FAKE/codex"

fail() { echo "$1" >&2; exit 1; }

# 1. start.sh must name whatever agent is present, not Claude by name.
grep -q 'for candidate in "claude:Claude Code" "codex:Codex" "gemini:Gemini CLI"' "$ROOT/start.sh" \
  || fail "start.sh no longer detects the installed agent"
grep -q 'exec "$AGENT_CMD"' "$ROOT/start.sh" \
  || fail "start.sh execs a hardcoded agent again"
grep -qE '^\s+To start it any time: open Terminal and type \$\{B\}claude\$\{N\}' "$ROOT/start.sh" \
  && fail "start.sh tells everyone to type 'claude' again"

# 2. setup.sh must not install an agent when one is present.
grep -q 'for a in claude codex gemini; do' "$ROOT/setup.sh" \
  || fail "setup.sh no longer checks for an existing agent"

# 3. Behavioral, against setup.sh itself. Checks 3 and 4 used to run a pasted
#    copy of the detection loop, which kept passing whatever setup.sh did.
#    CHEWBACCA_CLAUDE_CODE_INSTALLER stands in for claude.ai/install.sh, so
#    nothing is downloaded: the stand-in writes ~/.local/bin/claude the way
#    the native installer does, or fails.
BASE=/usr/bin:/bin:/usr/sbin:/sbin
printf '#!/bin/sh\nmkdir -p "$HOME/.local/bin"; printf "#!/bin/sh\\necho claude\\n" > "$HOME/.local/bin/claude"; chmod +x "$HOME/.local/bin/claude"\n' > "$FAKE/works.sh"
printf '#!/bin/sh\nexit 1\n' > "$FAKE/fails.sh"
run_agent() {  # home, path, installer
  mkdir -p "$1"
  HOME="$1" PATH="$2" CHEWBACCA_CLAUDE_CODE_INSTALLER="file://$FAKE/$3" \
    bash "$ROOT/setup.sh" --only agent --profile personal --name CI 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
}

# Codex already here: used, and nothing is installed. Sam's case.
out="$(run_agent "$FAKE/h-codex" "$FAKE:$BASE" works.sh)"
echo "$out" | grep -q "using the agent already installed: codex" || fail "with codex on PATH setup.sh did not use it"
[ -e "$FAKE/h-codex/.local/bin/claude" ] && fail "installed Claude Code on a Mac that already runs Codex"

# Bare Mac: Claude Code is installed, and the plan is named before it is.
out="$(run_agent "$FAKE/h-bare" "$BASE" works.sh)"
[ -x "$FAKE/h-bare/.local/bin/claude" ] || fail "a bare Mac got no agent"
plan_at=$(echo "$out" | grep -n "needs a paid Claude plan" | head -1 | cut -d: -f1)
done_at=$(echo "$out" | grep -n "Claude Code installed" | head -1 | cut -d: -f1)
[ -n "$plan_at" ] || fail "never says Claude Code needs a paid Claude plan"
[ -n "$done_at" ] && [ "$plan_at" -lt "$done_at" ] || fail "the plan requirement is not said before the install"
echo "$out" | grep -q "free tier works" && fail "claims the free tier works, which Anthropic says it does not"

# Installer down: a warning and the one line to run later, never a dead stop.
run_agent "$FAKE/h-down" "$BASE" fails.sh > "$FAKE/down.out"; rc=${PIPESTATUS[0]}
[ "$rc" -eq 0 ] || fail "a failed Claude Code download stopped the whole install (exit $rc)"
grep -q "claude.ai/install.sh" "$FAKE/down.out" || fail "a failed download does not say how to add Claude Code later"
exit 0
