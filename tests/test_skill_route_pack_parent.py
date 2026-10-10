"""skill-route: a match inside a third-party pack routes to the kit skill that
owns it, with the recipe kept as the second line.

On 2026-10-10 tests/live/gtm-route.sh failed 4 of 10 because skills from two
packs linked on 10/9 (coldoutboundskills, marketingskills' cold-email) beat
gtm-engineering on GTM prompts. Runs the real hook on the keyword fallback,
against a scratch skill tree, so it needs no embedding model."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "skill-route.sh"
failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


def skill(root, name, desc):
    (root / name).mkdir(parents=True)
    (root / name / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {desc}\n---\nbody\n")


tmp = Path(tempfile.mkdtemp())
kit = tmp / "kit"
pack = tmp / "Projects" / "coldoutboundskills" / "skills"
links = tmp / "links"
links.mkdir()
skill(kit, "gtm-engineering", "Growth engineer for demand generation and outbound programs.")
skill(pack, "smartlead-spintax", "Write spintax variants for smartlead sequences, spintax syntax rules.")
skill(kit, "speaking", "Prep a keynote talk for a conference audience, speech structure.")
os.symlink(pack / "smartlead-spintax", links / "smartlead-spintax")

env = dict(os.environ, HOME=str(tmp / "home"), CHEWBACCA_HOME=str(tmp / "chome"),
           CHEWBACCA_SKILLS_DIR=str(kit), SKILL_ROUTE_NO_VECTOR="1",
           BOB_DECISIONS=str(tmp / "decisions.jsonl"))
(tmp / "home" / ".claude").mkdir(parents=True)
os.symlink(links, tmp / "home" / ".claude" / "skills")


def routed(prompt):
    out = subprocess.run(["bash", str(HOOK)], input=json.dumps({"prompt": prompt, "cwd": str(tmp)}),
                         capture_output=True, text=True, env=env, timeout=60).stdout.strip()
    if not out:
        return []
    ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
    return [line.split()[0] for line in ctx.splitlines() if line.startswith("  ")]


names = routed("write spintax variants for my smartlead sequences with the spintax syntax")
check("a pack skill's match routes to its owner first", names[:1] == ["gtm-engineering"])
check("the pack recipe stays as the second line", names[1:2] == ["smartlead-spintax"])
check("a skill outside any pack keeps its own route",
      routed("prep a keynote talk for a conference audience")[:1] == ["speaking"])
raise SystemExit(1 if failed else 0)
