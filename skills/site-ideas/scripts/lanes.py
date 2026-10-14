#!/usr/bin/env python3
"""Draw, build the lane prompts and run them, for one brief.

    lanes.py RUN                      draw (once) and write RUN/prompts/*.txt
    lanes.py RUN --run                also run every prompt headless, in parallel, into RUN/out/
    lanes.py RUN --used ideas/used.txt   record draws in a file shared across runs

RUN holds brief.md. Draws land in RUN/draws/, and a rerun in the same RUN reuses
them. Every draw is recorded in the --used file (RUN/used.txt by default), so
a later run that passes the same file never repeats a stimulus, convention or
mechanism. Prompts come from
references/lanes.md: HEADER, one lane body, FORMAT. The baseline gets the same
header and card fields with no technique, which is what makes it a control.

Each lane runs from its own empty directory with --restricted, so no project
instructions, other lanes or the baseline can leak in: seeing examples first
anchors generation to them.
"""
import argparse
import concurrent.futures as cf
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import draw  # noqa: E402

LANES_MD = HERE.parent / "references" / "lanes.md"
DRAWN = {"inversion": ("conventions", 6), "stimulus": ("stimuli", 10), "mechanism": ("mechanisms", 4)}
LANES = ["inversion", "stimulus", "mechanism", "concept-fan", "subtraction", "tension"]
# On 2026-10-14 seven opus lanes run at once finished in 1.2 to 2.6 minutes
# (file times). Ten times the slowest, so only a hung call hits it.
TIMEOUT = 1560


def blocks():
    text = LANES_MD.read_text()
    return dict(re.findall(r"^## (.+?)\n.*?```\n(.*?)```", text, re.S | re.M))


def write_draws(run, used_file):
    d = run / "draws"
    d.mkdir(exist_ok=True)
    used = draw.read_used(used_file)
    if not (d / "functional.txt").exists():
        (d / "functional.txt").write_text("\n".join(draw.functional()) + "\n")
    for lane, (what, n) in DRAWN.items():
        if not (d / f"{lane}.txt").exists():
            lines, keys = draw.draw(what, n, used)
            used |= set(keys)
            draw.record_used(used_file, keys)
            (d / f"{lane}.txt").write_text("\n".join(lines) + "\n")


def write_prompts(run):
    b = blocks()
    header = (b["HEADER"].replace("{brief}", (run / "brief.md").read_text().strip())
              .replace("{functional}", (run / "draws/functional.txt").read_text().strip()))
    fmt = b["FORMAT"]
    (run / "prompts").mkdir(exist_ok=True)
    for lane in LANES:
        body = b[f"Lane: {lane}"]
        if lane in DRAWN:
            body = body.replace("{draw}", (run / f"draws/{lane}.txt").read_text().strip())
        (run / f"prompts/{lane}.txt").write_text(f"{header}\n{body}\n{fmt}")
    # Same card fields, minus the parts that only make sense with a technique.
    base = fmt.split("For each:", 1)[1].replace(" (p=<probability>)", "")
    base = base.replace("- Move: the chain from the draw to the idea, every link shown.",
                        "- Move: the thinking behind the concept.")
    base = re.sub(r'Then "## Abandoned".*?reason\.\n\n', "", base, flags=re.S)
    (run / "prompts/baseline.txt").write_text(
        f"{header}\n{b['Baseline (the control arm)'].strip()} For each:{base}")
    left = [p.name for p in (run / "prompts").glob("*.txt") if re.search(r"\{(brief|draw|functional)\}", p.read_text())]
    if left:
        sys.exit(f"lanes: unfilled placeholder in {left}")


def run_one(prompt, out, model):
    # A lane writes its .md only when it succeeds, so a failed rerun never
    # leaves last run's text looking like this run's output.
    err = out.with_suffix(".err")
    try:
        with tempfile.TemporaryDirectory() as empty:
            r = subprocess.run(["claude", "-p", "--restricted", "--model", model],
                               input=prompt.read_text(), capture_output=True, text=True,
                               cwd=empty, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        out.unlink(missing_ok=True)
        err.write_text(f"timed out after {TIMEOUT} s\n")
        return prompt.stem, "timeout", 0
    if r.returncode or not r.stdout.strip():
        out.unlink(missing_ok=True)
        err.write_text(r.stderr or "empty output\n")
        return prompt.stem, f"exit {r.returncode}", 0
    err.unlink(missing_ok=True)
    out.write_text(r.stdout)
    return prompt.stem, "ok", len(r.stdout.split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=pathlib.Path)
    ap.add_argument("--run", dest="go", action="store_true", help="run the prompts headless")
    ap.add_argument("--model", default="opus")
    ap.add_argument("--used", type=pathlib.Path, help="draw record shared across runs (default RUN/used.txt)")
    a = ap.parse_args()
    if not (a.run / "brief.md").exists():
        sys.exit(f"lanes: {a.run}/brief.md is missing; the brief comes first")
    write_draws(a.run, a.used or a.run / "used.txt")
    write_prompts(a.run)
    print(f"prompts in {a.run}/prompts")
    if not a.go:
        return
    (a.run / "out").mkdir(exist_ok=True)
    prompts = sorted((a.run / "prompts").glob("*.txt"))
    failed = []
    with cf.ThreadPoolExecutor(len(prompts)) as ex:
        for name, status, words in ex.map(lambda p: run_one(p, a.run / f"out/{p.stem}.md", a.model), prompts):
            print(f"{name:12} {status}  {words} words")
            if status != "ok":
                failed.append(name)
    if failed:
        sys.exit(f"lanes: {', '.join(failed)} failed; see out/<lane>.err and rerun with --run")


if __name__ == "__main__":
    main()
