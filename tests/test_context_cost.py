"""context_cost: enabled plugin skills and commands count toward the always-on
total, disabled plugins do not, and folded YAML descriptions are read whole.
Fixture home only."""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

home = Path(tempfile.mkdtemp())
os.environ["HOME"] = str(home)
sys.dont_write_bytecode = True
path = Path(__file__).resolve().parent.parent / "tools" / "context_cost.py"
loader = importlib.machinery.SourceFileLoader("context_cost", str(path))
spec = importlib.util.spec_from_loader("context_cost", loader)
cc = importlib.util.module_from_spec(spec)
loader.exec_module(cc)

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


def skill(folder, desc):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "SKILL.md").write_text(f"---\nname: {folder.name}\ndescription: {desc}\n---\nbody\n")


claude = home / ".claude"
skill(claude / "skills" / "mine", "m" * 400)
(claude / "commands").mkdir(parents=True)
(claude / "commands" / "go.md").write_text("---\ndescription: " + "c" * 40 + "\n---\n")
on = home / "plug" / "on"
off = home / "plug" / "off"
skill(on / "skills" / "a", "a" * 800)
(on / "commands").mkdir()
(on / "commands" / "b.md").write_text("---\ndescription: >\n  " + "b" * 200 + "\n  " + "b" * 199 + "\n---\n")
skill(off / "skills" / "z", "z" * 4000)
(claude / "settings.json").write_text(json.dumps({"enabledPlugins": {"on@m": True, "off@m": False}}))
(claude / "plugins").mkdir()
(claude / "plugins" / "installed_plugins.json").write_text(json.dumps({"plugins": {
    "on@m": [{"installPath": str(on)}], "off@m": [{"installPath": str(off)}]}}))
synced = claude / "plugins" / "synced" / "bucket"
skill(synced / "fig~g4" / "skills" / "f", "f" * 80)
skill(synced / "fig" / "skills" / "old", "o" * 8000)
(synced / "manifest.json").write_text(json.dumps({"plugins": [{"name": "fig", "generation": 4}]}))

items = {name.strip(): tokens for name, _, tokens, _ in cc.collect()}
check("user skills and commands counted together", items.get("2 skill and command descriptions") == 110)
check("enabled and synced plugin entries counted", items.get("3 plugin skill descriptions") == 200 + 100 + 20)
check("folded description read whole", cc.description("---\ndescription: >\n  one\n  two\nname: x\n---\n") == "one two")
check("quoted description unquoted", cc.description('---\ndescription: "hi there"\n---\n') == "hi there")
check("disabled plugin never counted", all("z" * 10 not in str(r) for r in cc.plugin_roots()) and off not in cc.plugin_roots())
check("newest synced generation wins", synced / "fig~g4" in cc.plugin_roots() and synced / "fig" not in cc.plugin_roots())

sys.exit(1 if failed else 0)
