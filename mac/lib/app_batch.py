#!/usr/bin/env python3
"""Run several appctl steps against one app in one call, stopping at the first failure.

Steps are JSON objects: {"do": "press", "label": "Add"}, {"do": "press", "i": 12},
{"do": "set", "label": "To:", "text": "..."}, {"do": "key", "combo": "tab"},
{"do": "scroll", "dy": 3}, {"do": "menu", "path": ["File", "New"]}, {"do": "see"},
{"do": "read"}, {"do": "shot", "out": "/tmp/x.png"}.

A step addressed by label takes a fresh `see` first, because a label is a
promise about what is on screen now. A step addressed by index uses the
snapshot from the previous `see`, exactly as the CLI does. A gated step (exit
4) stops the batch; "yes": true on that one step is the only way past it, and
it means the person approved that step.
"""
import json
import subprocess
import sys

VERBS = {"press", "set", "focus", "key", "scroll", "menu", "see", "read", "shot", "raise"}


def run(appctl, args):
    done = subprocess.run([appctl, *args], capture_output=True, text=True)
    out = None
    if done.stdout.strip():
        try:
            out = json.loads(done.stdout)
        except json.JSONDecodeError:
            out = done.stdout.strip()
    return done.returncode, out, done.stderr.strip()


def step_args(app, step):
    verb = step.get("do")
    if verb not in VERBS:
        raise ValueError(f"unknown step {verb!r}")
    ref = None
    if "i" in step:
        ref = str(step["i"])
    elif "label" in step:
        ref = "label:" + step["label"]
    args = [verb, app]
    if verb in ("press", "focus", "set"):
        if ref is None:
            raise ValueError(f"{verb} needs i or label")
        args.append(ref)
        if verb == "set":
            args.append(step["text"])
    elif verb == "key":
        args.append(step["combo"])
    elif verb == "scroll":
        if ref:
            args.append(ref)
        args.append(str(step.get("dy", 3)))
    elif verb == "menu":
        args.extend(step["path"])
    elif verb == "shot":
        args += ["--out", step["out"]]
        if "region" in step:
            args += ["--region", ",".join(str(v) for v in step["region"])]
    if "window" in step:
        args += ["--window", str(step["window"])]
    if step.get("yes") is True:
        args.append("--yes")
    return args, "label" in step


def main():
    if len(sys.argv) != 4:
        sys.exit("usage: app_batch.py <appctl> <app> <steps.json|->")
    appctl, app, src = sys.argv[1:]
    steps = json.load(sys.stdin if src == "-" else open(src))
    if not isinstance(steps, list) or not steps:
        sys.exit("steps must be a nonempty JSON array")
    results = []
    for n, step in enumerate(steps):
        try:
            args, by_label = step_args(app, step)
        except (ValueError, KeyError) as err:
            results.append({"step": n, "error": f"bad step: {err}"})
            print(json.dumps({"completed": n, "results": results}, indent=2))
            sys.exit(2)
        if by_label:
            code, _, err = run(appctl, ["see", app] + (["--window", str(step["window"])] if "window" in step else []))
            if code != 0:
                results.append({"step": n, "error": err})
                print(json.dumps({"completed": n, "results": results}, indent=2))
                sys.exit(code)
        code, out, err = run(appctl, args)
        results.append({"step": n, "do": step["do"], "exit": code, "out": out, **({"error": err} if err else {})})
        if code != 0:
            print(json.dumps({"completed": n, "stopped_at": n, "results": results}, indent=2))
            sys.exit(code)
    print(json.dumps({"completed": len(steps), "results": results}, indent=2))


if __name__ == "__main__":
    main()
