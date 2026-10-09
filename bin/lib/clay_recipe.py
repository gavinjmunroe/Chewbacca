"""The Clay HUD's run, as data: loads and checks
library/maps/app.clay.com/recipes/find-people-table.json.

When Clay moves a button, the recipe changes and the code does not. The checks
here are the ones that keep a recipe edit from spending a credit nobody
approved: a step that spends ends on exactly one approval action, and nothing
comes after it in that step.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "library" / "maps" / "app.clay.com" / "recipes" / "find-people-table.json"

STEP_IDS = ("check", "find", "count", "test", "read", "rest", "done")
SURFACES = {"read", "ui", "approve"}
COSTS = {"free", "spends"}
DOS = {"click", "type", "check", "open-submenu"}
EXPECTS = {"url", "text", "text_re", "css"}
MATCHES = {"exact", "prefix", "contains"}
STEP_KEYS = {"id", "title", "note", "holds", "surface", "cost", "actions"}
ACTION_KEYS = {"find", "do", "value", "enter", "expect", "timeout_s", "approve", "unverified", "measured"}
FIND_KEYS = {"css", "text", "text_re", "match", "placeholder", "section"}
APPROVALS = {"test", "rest"}

# The note's title strip holds about 16 Departure Mono caps at w=300; the
# note and its muted line are one sentence each. Guessed from the approved
# mockup (look-v2.html), never measured on the glass.
TITLE_MAX = 16
COPY_MAX = 140
DASHES = ("—", "–")


class RecipeError(ValueError):
    pass


@dataclass(frozen=True)
class Action:
    find: tuple[dict, ...]
    do: str
    value: str
    enter: bool
    expect: dict
    timeout_s: float
    approve: str


@dataclass(frozen=True)
class Step:
    id: str
    title: str
    note: str
    holds: str
    surface: str
    cost: str
    actions: tuple[Action, ...]


class _Strict(dict):
    def __missing__(self, key):
        raise KeyError(key)


def fill(text: str, values: dict) -> str:
    """`{sentence}` and `{count}` filled in; an unknown name raises KeyError
    rather than drawing a literal brace on the glass."""
    return text.format_map(_Strict(values))


def _action(step_id: str, raw: dict) -> Action:
    def fail(why: str):
        raise RecipeError(f"{step_id}: {why}")

    if not isinstance(raw, dict):
        fail("an action must be an object")
    if extra := set(raw) - ACTION_KEYS:
        fail(f"unknown action keys {sorted(extra)}")
    find = raw.get("find")
    if not isinstance(find, list) or not find:
        fail("an action needs a non-empty find list")
    for alt in find:
        if not isinstance(alt, dict) or not isinstance(alt.get("css"), str) or not alt["css"]:
            fail("every find entry needs a css selector")
        if extra := set(alt) - FIND_KEYS:
            fail(f"unknown find keys {sorted(extra)}")
        if alt.get("match", "exact") not in MATCHES:
            fail(f"match must be one of {sorted(MATCHES)}")
    do = raw.get("do")
    if do not in DOS:
        fail(f"do must be one of {sorted(DOS)}, not {do!r}")
    if do == "type" and not isinstance(raw.get("value"), str):
        fail("a type action needs a value")
    expect = raw.get("expect")
    if not isinstance(expect, dict) or len(expect) != 1 or not set(expect) <= EXPECTS:
        fail(f"expect needs exactly one of {sorted(EXPECTS)}")
    timeout = raw.get("timeout_s")
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        fail("timeout_s must be a positive number")
    approve = raw.get("approve", "")
    if approve and approve not in APPROVALS:
        fail(f"approve must be one of {sorted(APPROVALS)}")
    return Action(tuple(find), do, raw.get("value", ""), bool(raw.get("enter", False)),
                  dict(expect), float(timeout), approve)


def _step(raw: dict) -> Step:
    step_id = raw.get("id") if isinstance(raw, dict) else None

    def fail(why: str):
        raise RecipeError(f"{step_id}: {why}")

    if not isinstance(raw, dict):
        fail("a step must be an object")
    if extra := set(raw) - STEP_KEYS:
        fail(f"unknown step keys {sorted(extra)}")
    if raw.get("surface") not in SURFACES:
        fail(f"surface must be one of {sorted(SURFACES)}")
    if raw.get("cost") not in COSTS:
        fail(f"cost must be one of {sorted(COSTS)}")
    title, note, holds = raw.get("title"), raw.get("note"), raw.get("holds")
    if not isinstance(title, str) or not title or title != title.upper() or len(title) > TITLE_MAX:
        fail(f"title must be caps and at most {TITLE_MAX} characters")
    for name, text in (("note", note), ("holds", holds)):
        if not isinstance(text, str) or not text or len(text) > COPY_MAX:
            fail(f"{name} must be one sentence of at most {COPY_MAX} characters")
    for text in (title, note, holds):
        if any(dash in text for dash in DASHES):
            fail("no em or en dashes in copy")
    actions = raw.get("actions")
    if not isinstance(actions, list):
        fail("actions must be a list")
    parsed = tuple(_action(step_id, a) for a in actions)
    approvals = [i for i, a in enumerate(parsed) if a.approve]
    if raw["cost"] == "spends":
        if len(approvals) != 1 or approvals[0] != len(parsed) - 1:
            fail("a step that spends ends on exactly one approval action, with nothing after it")
    elif approvals:
        fail("only a step that spends may hold an approval")
    return Step(step_id, title, note, holds, raw["surface"], raw["cost"], parsed)


def load(path: Path = DEFAULT) -> tuple[Step, ...]:
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError) as err:
        raise RecipeError(f"recipe: cannot read {path}: {err}") from err
    steps = tuple(_step(raw) for raw in data.get("steps", []))
    if tuple(s.id for s in steps) != STEP_IDS:
        raise RecipeError(f"recipe: steps must be {', '.join(STEP_IDS)} in that order")
    return steps
