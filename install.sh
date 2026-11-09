#!/bin/bash
# Chewbacca: Quick install
# Copies CLAUDE.md + .claude/ into the current project directory.
# For full infrastructure setup (second brain, iMessage agent, MCP), run setup.sh instead.

set -e

GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="${1:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "Chewbacca: Project Install"
echo "================================="
echo ""
echo "Installing to: $PROJECT_DIR"
echo ""

# React Doctor is per project, not per machine: it scans a codebase and installs
# a skill teaching the agent the issues it found there. Only offered when this
# actually is a React project, because installing a React linter into a Python
# repo is noise. Deterministic and model-free, same as ai-scan and slop-check.
if [ -f "$PROJECT_DIR/package.json" ] &&
  grep -qE '"(react|next)"' "$PROJECT_DIR/package.json" 2>/dev/null; then
  if command -v npx >/dev/null 2>&1; then
    echo "  React project detected. Installing the react-doctor skill..."
    if (cd "$PROJECT_DIR" && npx -y react-doctor@latest install >/dev/null 2>&1); then
      echo -e "  ${GRN}✓${NC} react-doctor skill (run: npx react-doctor)"
    else
      echo -e "  ${YLW}!${NC} react-doctor install failed, skipping"
    fi
  fi
fi

# Nothing the user already has is overwritten without a copy. Break-it,
# 2026-10-19: this script replaced a project's CLAUDE.md and the user's own
# ~/.claude/rules/security.md and agents/code-reviewer.md with plain cp, and
# no copy of theirs existed anywhere afterward.
BACKUP_DIR="$HOME/.claude/backups/install-$(date +%Y%m%d-%H%M%S)"
place() {  # place <src> <dest>: back up a different existing dest, then copy
  local src="$1" dest="$2"
  if [ -e "$dest" ] && ! cmp -s "$src" "$dest"; then
    local rel="${dest#"$HOME"/}"
    [ "$rel" = "$dest" ] && rel="project/$(basename "$(dirname "$dest")")/$(basename "$dest")"
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -p "$dest" "$BACKUP_DIR/$rel"
  fi
  cp "$src" "$dest"
}
place_all() {  # place_all <dest-dir> <src files...>
  local dir="$1"; shift
  local f
  for f in "$@"; do [ -f "$f" ] && place "$f" "$dir/$(basename "$f")"; done
  return 0
}

# Copy CLAUDE.md
place "$SCRIPT_DIR/CLAUDE.md" "$PROJECT_DIR/CLAUDE.md"
echo -e "  ${GRN}✓${NC} CLAUDE.md"

# Anything settings.json points at, or CLAUDE.md imports, must sit at a fixed
# global path or it silently resolves to nothing. Only CLAUDE.md is
# project-scoped, so you can tune it per project.
mkdir -p "$HOME/.claude/hooks" "$HOME/.claude/agents" "$HOME/.claude/commands"
place_all "$HOME/.claude/hooks" "$SCRIPT_DIR/.claude/hooks/"*.sh
chmod +x "$HOME/.claude/hooks/"*.sh 2>/dev/null || true
place_all "$HOME/.claude/agents" "$SCRIPT_DIR/.claude/agents/"*.md
place_all "$HOME/.claude/commands" "$SCRIPT_DIR/.claude/commands/"*.md
echo -e "  ${GRN}✓${NC} ~/.claude/hooks ($(ls "$SCRIPT_DIR"/.claude/hooks/*.sh | wc -l | tr -d ' ') hooks)"
echo -e "  ${GRN}✓${NC} ~/.claude/agents ($(ls "$SCRIPT_DIR/.claude/agents/" | wc -l | tr -d ' ') subagents)"
echo -e "  ${GRN}✓${NC} ~/.claude/commands ($(ls "$SCRIPT_DIR/.claude/commands/" | wc -l | tr -d ' ') commands)"

# Rules go global. CLAUDE.md imports them as @~/.claude/rules/*.md, so they have
# to be at that path for the imports to resolve in any project.
mkdir -p "$HOME/.claude/rules"
place_all "$HOME/.claude/rules" "$SCRIPT_DIR/.claude/rules/"*.md
place "$SCRIPT_DIR/config/instructions/agent-neutral.md" "$HOME/.claude/rules/agent-neutral.md"
echo -e "  ${GRN}✓${NC} ~/.claude/rules ($(ls "$SCRIPT_DIR/.claude/rules/" | wc -l | tr -d ' ') always-on rules)"

# Skills load on demand, including the twelve stack-specific standards.
if [ -d "$SCRIPT_DIR/skills" ]; then
  mkdir -p "$HOME/.claude/skills"
  for sk in "$SCRIPT_DIR/skills/"*/; do
    name="$(basename "$sk")"
    if [ -d "$HOME/.claude/skills/$name" ] && ! diff -rq "$sk" "$HOME/.claude/skills/$name" >/dev/null 2>&1; then
      mkdir -p "$BACKUP_DIR/.claude/skills"
      cp -R "$HOME/.claude/skills/$name" "$BACKUP_DIR/.claude/skills/$name"
    fi
  done
  cp -R "$SCRIPT_DIR/skills/." "$HOME/.claude/skills/"
  echo -e "  ${GRN}✓${NC} ~/.claude/skills ($(ls "$SCRIPT_DIR/skills" | wc -l | tr -d ' ') skills)"
fi

# Merge settings if no global settings exist
SETTINGS_DEST="$HOME/.claude/settings.json"
if [ ! -f "$SETTINGS_DEST" ]; then
  mkdir -p "$HOME/.claude"
  cp "$SCRIPT_DIR/config/settings/settings.json" "$SETTINGS_DEST"
  # The next step tells the user to paste tokens in here.
  chmod 600 "$SETTINGS_DEST"
  echo -e "  ${GRN}✓${NC} ~/.claude/settings.json (created)"
else
  echo -e "  ${YLW}!${NC} ~/.claude/settings.json exists, merge config/settings/settings.json manually"
fi

[ -d "$BACKUP_DIR" ] && echo -e "  ${YLW}!${NC} files you had that differed are saved in $BACKUP_DIR"

echo ""
echo -e "${GRN}Done.${NC} CLAUDE.md and .claude/ are in your project."
echo ""
echo "Next steps:"
echo "  1. Add your tokens to ~/.claude/settings.json:"
echo '     "env": { "GITHUB_TOKEN": "...", "ANTHROPIC_API_KEY": "...", "TODOIST_API_TOKEN": "..." }'
echo ""
echo "For full infrastructure (second brain + iMessage agent + MCP):"
echo "  chmod +x setup.sh && ./setup.sh"
echo ""
