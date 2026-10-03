"""Which Claude subscription to answer from, for tools that run `claude -p`.

Two subscriptions answer from this Mac, one config directory each (`claude1`
and `claude2` in ~/.zshrc). On 2026-10-02 the default one had hit its weekly
limit while the second had room, and a cue model started from the default
answered every turn with "You've hit your weekly limit".

hud-listen keeps its own copy of these three functions because its tests
patch them as module globals; the rules are the same and so is the
`~/.bob/accounts` file both read.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

ACCOUNTS_FILE = Path.home() / ".bob" / "accounts"
DEFAULT_CONFIG = Path.home() / ".claude"
LIMIT_RE = re.compile(
    r"hit your (?:weekly |session |daily |usage )?limit|usage limit reached", re.IGNORECASE)


def accounts(accounts_file: Path = ACCOUNTS_FILE, default: Path = DEFAULT_CONFIG) -> list[Path]:
    """Config directories in the order to try: `~/.bob/accounts`, else the
    default `~/.claude` and `~/.claude-2` when it exists."""
    if accounts_file.exists():
        found = [
            Path(line.strip()).expanduser()
            for line in accounts_file.read_text().splitlines()
            if line.strip() and not line.startswith("#")
        ]
        if found:
            return found
    second = Path.home() / ".claude-2"
    return [default] + ([second] if second.is_dir() else [])


def is_limit_reply(text: str) -> bool:
    return bool(LIMIT_RE.search(text or ""))


def env_for(config: Path, default: Path = DEFAULT_CONFIG) -> dict[str, str]:
    """The environment that runs Claude Code as the account in `config`.

    The default account runs with CLAUDE_CONFIG_DIR unset, never set to
    `~/.claude`: Claude Code names its Keychain entry after the variable, and
    an explicit default looks for an entry that does not exist.
    """
    env = dict(os.environ)
    if config.expanduser().resolve() == default.expanduser().resolve():
        env.pop("CLAUDE_CONFIG_DIR", None)
    else:
        env["CLAUDE_CONFIG_DIR"] = str(config)
    return env
