"""A skill's `triggers:` block is its routing text: both routers (skill_match
and the skill-route hook's own parser) read it in place of the short
description, and a skill without one still routes on its description.
Fixture skills only."""
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import skill_match  # noqa: E402

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


def hook_frontmatter():
    """The hook's parser, lifted out of the heredoc it lives in."""
    src = (ROOT / ".claude/hooks/skill-route.sh").read_text()
    body = re.search(r"^def frontmatter\(path\):\n(?:(?:    .*)?\n)+", src, re.M).group(0)
    scope = {"re": re}
    exec(body, scope)
    return scope["frontmatter"]


tmp = Path(tempfile.mkdtemp())
long_text = "Use when the user says alpha, bravo: charlie, or delta. Also fires on: echo, foxtrot."
with_triggers = tmp / "a.md"
with_triggers.write_text('---\nname: a\ndescription: "Short."\ntriggers: >-\n  '
                         + long_text + "\nrequires: [x]\n---\nbody\n")
plain = tmp / "b.md"
plain.write_text("---\nname: b\ndescription: Only this.\n---\n")

for label, parse in (("skill_match", skill_match.frontmatter), ("skill-route hook", hook_frontmatter())):
    check(f"{label} routes on the triggers block", parse(str(with_triggers)) == ("a", long_text))
    check(f"{label} falls back to the description", parse(str(plain)) == ("b", "Only this."))

spec = importlib.util.spec_from_file_location("frontmatter", ROOT / "tools/frontmatter.py")
fm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fm)
check("a triggers block passes the frontmatter check", fm.problems(with_triggers) == [])
over = [p.parent.name for p in (ROOT / "skills").glob("*/SKILL.md") if fm.problems(p)]
check("every kit skill keeps its listed description short", over == [])

sys.exit(1 if failed else 0)
