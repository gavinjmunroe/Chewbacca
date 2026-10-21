#!/bin/bash
# Perplexity Code — Full Infrastructure Setup
#
# Run this ONCE from the perplexity-code repo.
# It builds your entire Perplexity Code infrastructure.
#
# What it creates:
#   .perplexity/         Commands, rules, hooks, templates, snippets, sessions
#   PERPLEXITY.md        Master project memory and instructions
#   .env                 API keys
#
# What it wires:
#   perplexity CLI       Global terminal command
#   Ollama               Free local inference (if installed)
#   Source registry       Self-improving loop defaults
#
# Usage:
#   git clone https://github.com/calebnewtonusc/perplexity-code
#   cd perplexity-code
#   chmod +x setup.sh && ./setup.sh

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${CYAN}[info]${NC} $1"; }
good() { echo -e "${GREEN}[done]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; exit 1; }

echo
echo -e "${CYAN}Perplexity Code — Full Setup${NC}"
echo "================================================"
echo

# ── Check Python ──────────────────────────────────────────────────────────────
info "Checking Python..."
if ! command -v python3 &>/dev/null; then
  fail "Python 3 not found. Install it first."
fi
PYVER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
good "Python $PYVER"

# ── Check Ollama ──────────────────────────────────────────────────────────────
info "Checking Ollama..."
if command -v ollama &>/dev/null; then
  if curl -s http://localhost:11434/api/tags &>/dev/null; then
    MODELS=$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")
    good "Ollama running ($MODELS models installed)"
  else
    warn "Ollama installed but not running. Start with: ollama serve"
    warn "Quick and generation tasks will use paid Sonar API until Ollama starts."
  fi
else
  warn "Ollama not installed. All tasks will use paid Sonar API."
  warn "Install for free local inference: brew install ollama && ollama pull llama3.1:8b"
fi

# ── Install Perplexity Code CLI ───────────────────────────────────────────────
info "Installing perplexity CLI..."
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
python -m pip install --upgrade pip -q
pip install -e . -q

mkdir -p "$HOME/.local/bin"
ln -sf "$PWD/.venv/bin/perplexity" "$HOME/.local/bin/perplexity"

if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.zshrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
fi
good "perplexity CLI installed"

# ── Set up .env ───────────────────────────────────────────────────────────────
info "Setting up environment..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  warn ".env created from template. Add your PERPLEXITY_API_KEY."
else
  good ".env already exists"
fi

# ── Set up PERPLEXITY.md ──────────────────────────────────────────────────────
info "Setting up project memory..."
if [ ! -f "PERPLEXITY.md" ]; then
  if [ -f "PERPLEXITY.md.full" ]; then
    cp PERPLEXITY.md.full PERPLEXITY.md
    good "PERPLEXITY.md created (full 702-line config)"
  else
    cp PERPLEXITY.md.example PERPLEXITY.md
    good "PERPLEXITY.md created (minimal template)"
  fi
else
  good "PERPLEXITY.md already exists"
fi

# ── Set up hooks ──────────────────────────────────────────────────────────────
info "Setting up hooks..."
if [ ! -f "PERPLEXITY_HOOKS.json" ]; then
  cp PERPLEXITY_HOOKS.json.example PERPLEXITY_HOOKS.json
  good "PERPLEXITY_HOOKS.json created"
else
  good "PERPLEXITY_HOOKS.json already exists"
fi

# ── Initialize source registry ────────────────────────────────────────────────
info "Initializing source registry..."
python3 -c "
from perplexity_code.source_registry import init_default_sources
from pathlib import Path
count = init_default_sources(Path('.'))
print(f'  {count} default sources registered')
" 2>/dev/null || warn "Source registry init skipped (run manually with /sources init)"

# ── Verify ────────────────────────────────────────────────────────────────────
echo
echo "================================================"
echo -e "${CYAN}Verification${NC}"
echo "================================================"

check() {
  if [ -e "$1" ]; then
    good "$1"
  else
    warn "Missing: $1"
  fi
}

check ".perplexity/commands/"
check ".perplexity/rules/"
check ".perplexity/hooks/"
check ".perplexity/templates/"
check ".perplexity/snippets/"
check "PERPLEXITY.md"
check ".env"

echo
echo "================================================"
echo -e "${GREEN}Setup complete.${NC}"
echo
echo "  Open a new terminal or run: source ~/.zshrc"
echo "  Then start coding:          perplexity"
echo
echo "  Quick reference:"
echo "    /help              All commands"
echo "    /ollama            Check local inference status"
echo "    /discover <topic>  Search-native repo discovery"
echo "    /route <task>      See where a task would route (free vs paid)"
echo
echo "================================================"
