"""site-ideas rests on three mechanical claims, and each one failing is silent.

The draw comes from outside the model: a model asked for a random object picks
from its own mode, so draw.py has to hold its category and concrete/abstract
minimums on every draw, never offer a functional convention for inversion, and
never repeat a recorded draw. The baseline is a control: same header and card
fields, no technique. The blind sheet is blind: equal arms, and no Move line,
which names the draw and gives the arm away. No model is called here."""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "site-ideas" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import draw  # noqa: E402
import re  # noqa: E402


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_draws():
    for _ in range(200):
        lines, keys = draw.draw("stimuli", 10, set())
        cats = [l.split("\t")[1] for l in lines]
        kinds = [l.split("\t")[2] for l in lines]
        assert len(set(keys)) == 10, keys
        assert len(set(cats)) >= draw.MIN_CATEGORIES, cats
        assert kinds.count("concrete") >= draw.MIN_CONCRETE and kinds.count("abstract") >= draw.MIN_ABSTRACT, kinds
        assert all(a != b for a, b in zip(cats, cats[1:])), cats
        _, conv = draw.draw("conventions", 6, set())
        assert all(k.startswith("A") for k in conv), conv
    # The case random reshuffling lost on 2026-10-14: half the batch in one category.
    heavy = [{"category": "nature", "stimulus": f"n{i}"} for i in range(5)] + \
            [{"category": f"c{i}", "stimulus": f"s{i}"} for i in range(5)]
    for _ in range(200):
        cats = [r["category"] for r in draw.spread(heavy)]
        assert all(a != b for a, b in zip(cats, cats[1:])), cats
    used = set(draw.draw("stimuli", 10, set())[1])
    for _ in range(50):
        assert not used & set(draw.draw("stimuli", 10, used)[1])
    assert len(draw.functional()) >= 10 and all(f.startswith("F") for f in draw.functional())
    bad = subprocess.run([sys.executable, SCRIPTS / "draw.py", "stimuli", "2"], capture_output=True, text=True)
    assert bad.returncode and "at least 3" in bad.stderr, bad.stderr
    with tempfile.TemporaryDirectory() as t:
        used = pathlib.Path(t) / "used.txt"
        used.write_text("\n".join(r["domain"] for r in draw.rows("mechanisms")[:-2]) + "\n")
        bad = subprocess.run([sys.executable, SCRIPTS / "draw.py", "mechanisms", "4", "--used", used],
                             capture_output=True, text=True)
        assert bad.returncode and "only 2 unused" in bad.stderr, bad.stderr


def test_prompts():
    with tempfile.TemporaryDirectory() as t:
        run = pathlib.Path(t)
        # Not a speaker on purpose: the first client's speaker wording once sat in
        # the shared card format, and every brief inherited "books him here".
        (run / "brief.md").write_text("# Brief: a test bakery\n\nThe main action is ordering a cake.\n")
        subprocess.run([sys.executable, SCRIPTS / "lanes.py", run], check=True, capture_output=True)
        prompts = {p.stem: p.read_text() for p in (run / "prompts").glob("*.txt")}
        assert set(prompts) == {"baseline", "inversion", "stimulus", "mechanism", "concept-fan", "subtraction", "tension"}
        floor = (run / "draws/functional.txt").read_text().strip()
        for name, text in prompts.items():
            assert "{" not in text, f"{name} has an unfilled placeholder"
            assert floor in text and "a test bakery" in text, name
        # Read the templates, not the prompts: a drawn stimulus may say "podcast".
        for block, text in load("lanes").blocks().items():
            assert not re.search(r"\b(him|his|speaker|podcast|conference)\b", text), \
                f"lanes.md {block} carries a client's details"
        base = prompts["baseline"]
        assert "p=" not in base and "Abandoned" not in base and "tails" not in base
        assert "- First ten seconds:" in base and "- Floor risk:" in base
        used = (run / "used.txt").read_text()
        subprocess.run([sys.executable, SCRIPTS / "lanes.py", run], check=True, capture_output=True)
        assert (run / "used.txt").read_text() == used, "a rerun drew again"
        shared = run / "shared-used.txt"
        first, second = run / "first", run / "second"
        for r in (first, second):
            r.mkdir(); (r / "brief.md").write_text("# Brief: a test bakery\n")
            subprocess.run([sys.executable, SCRIPTS / "lanes.py", r, "--used", shared], check=True, capture_output=True)
        a, b = ((r / "draws/stimulus.txt").read_text().splitlines() for r in (first, second))
        assert not set(a) & set(b), "a shared used file let a second run repeat a stimulus"
        assert len(shared.read_text().splitlines()) == 40 and not (first / "used.txt").exists()


def fake_claude(tmp, body):
    bin_dir = pathlib.Path(tmp) / "bin"; bin_dir.mkdir(exist_ok=True)
    (bin_dir / "claude").write_text("#!/bin/sh\n" + body + "\n"); (bin_dir / "claude").chmod(0o755)
    return {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}


def test_lane_failures():
    with tempfile.TemporaryDirectory() as t:
        run = pathlib.Path(t) / "run"; run.mkdir()
        (run / "brief.md").write_text("# Brief: a test bakery\n")
        (run / "out").mkdir(); (run / "out/tension.md").write_text("last run's text")
        env = fake_claude(t, "cat >/dev/null; echo boom >&2; exit 3")
        r = subprocess.run([sys.executable, SCRIPTS / "lanes.py", run, "--run"], capture_output=True, text=True, env=env)
        assert r.returncode, "lanes.py exited 0 with every lane failing"
        assert not (run / "out/tension.md").exists(), "a failed lane left last run's output in place"
        assert "boom" in (run / "out/tension.err").read_text()
        env = fake_claude(t, "cat >/dev/null; echo '## A (p=0.05)'")
        r = subprocess.run([sys.executable, SCRIPTS / "lanes.py", run, "--run"], capture_output=True, text=True, env=env)
        assert r.returncode == 0 and (run / "out/tension.md").exists() and not (run / "out/tension.err").exists()


def card(name, move):
    return (f"## {name} (p=0.05)\n- **Move:** {move}\n- **First ten seconds:** sees {name}.\n"
            f"- **Booking:** a form.\n- **Refuses:** No x, no y.\n")


def test_blind():
    blind = load("blind")
    with tempfile.TemporaryDirectory() as t:
        run = pathlib.Path(t)
        (run / "out").mkdir()
        plain = "## Lane Two (p=0.05)\n- Move: field guide\n- First ten seconds: sees it.\n- Main action: a form.\n"
        (run / "out/stimulus.md").write_text(card("Lane One", "wedding suite") + plain)
        (run / "out/baseline.md").write_text("".join(card(f"Base {i}", "reasoning") for i in range(5)))
        (run / "keep.tsv").write_text("stimulus\tLane One\nstimulus\tLane Two\n")
        subprocess.run([sys.executable, SCRIPTS / "blind.py", run, "--keep", run / "keep.tsv"],
                       check=True, capture_output=True)
        key = json.loads((run / "blind/KEY.json").read_text())
        arms = [c["arm"] for c in key["cards"]]
        assert arms.count("lane") == arms.count("baseline") == 2, arms
        assert len(key["dropped_at_random"]) == 3
        prompt = (run / "blind/condense-prompt.txt").read_text()
        assert "Move" not in prompt and "wedding" not in prompt and "field guide" not in prompt
        assert "stimulus" not in prompt and "baseline" not in prompt
        # A second call keeps the letters: a second reader's picks must score against the same key.
        subprocess.run([sys.executable, SCRIPTS / "blind.py", run, "--keep", run / "keep.tsv"],
                       check=True, capture_output=True)
        assert json.loads((run / "blind/KEY.json").read_text()) == key
    assert blind.refusals("- Will not: No a, no b, no c.") == "- Will not: a; b; c."


if __name__ == "__main__":
    test_draws()
    test_prompts()
    test_blind()
    test_lane_failures()
    print("ok")
